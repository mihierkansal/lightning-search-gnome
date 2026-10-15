/*
 * Lightning Search Launcher, file search
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { FileCache } from "./file-cache.js";
import { GioFileSystem, statCandidates } from "./file-system.js";
import { searchIndex, searchIndexContent } from "./index-strategy.js";
import { mergeResults } from "./merge.js";
import { looksLikePath, resolvePathQuery } from "./path-query.js";
import { searchPath } from "./path-strategy.js";
import { searchScan } from "./scan-strategy.js";
import { SearchGeneration } from "./token.js";
import {
  FILE_RESULT_LIMIT,
  TRACKER_BUS_NAME,
  TRACKER_OBJECT_PATH,
} from "./constants.js";
import { trackerBusNewAsync } from "../promise-adapters.js";

export class FileSearch {
  /** @param {GioFileSystem} [fileSystem] overridable, for tests */
  constructor(fileSystem = new GioFileSystem()) {
    this._fileSystem = fileSystem;
    this._generation = new SearchGeneration();
    this._cache = new FileCache();
    this._resultLimit = FILE_RESULT_LIMIT;
    this._disposed = false;
    this._tracker = null;
    this._cancellable = null;
    this._modulePromise = null;
    this._trackerPromise = null;
  }

  warmup() {
    if (this._disposed) return;
    this._connect().catch(() => {});
  }

  _connect() {
    if (this._tracker || this._disposed) return Promise.resolve();

    if (!this._trackerPromise) {
      this._trackerPromise = this._openTracker().finally(() => {
        this._trackerPromise = null;
      });
    }
    return this._trackerPromise;
  }

  async _openTracker() {
    const module = await this._loadTrackerModule();
    if (!module || this._disposed) return;

    const Tracker = module.default ?? module;
    let connection;
    try {
      connection = await trackerBusNewAsync(
        Tracker,
        TRACKER_BUS_NAME,
        TRACKER_OBJECT_PATH,
      );
    } catch (_error) {
      return;
    }

    if (this._disposed) {
      connection.close();
      return;
    }
    this._tracker = {
      connection,
      escapeString: (value) => Tracker.sparql_escape_string(value),
    };
  }

  _loadTrackerModule() {
    if (!this._modulePromise) {
      this._modulePromise = import("gi://Tracker").catch(() => null);
    }
    return this._modulePromise;
  }

  get resultLimit() {
    return this._resultLimit;
  }

  set resultLimit(limit) {
    const value = Math.round(Number(limit));
    this._resultLimit =
      Number.isFinite(value) && value > 0 ? value : FILE_RESULT_LIMIT;
  }

  beginSearch() {
    this._cancellable?.cancel();
    this._cancellable = new Gio.Cancellable();
    return this._generation.begin();
  }

  cancel() {
    this._generation.invalidate();
    this._cancellable?.cancel();
    this._cancellable = null;
  }

  async search(query, token = this.beginSearch(), options = {}) {
    const items = await this._resolve(query, token, options);
    return token.isStale ? null : items;
  }

  interimMatches(query) {
    if (looksLikePath(query)) {
      const { path, partial } = resolvePathQuery(query, GLib.get_home_dir());
      return this._cache.matchesIn(path, partial, this._resultLimit);
    }
    return this._cache.matches(query, this._resultLimit);
  }

  dispose() {
    this._disposed = true;
    this.cancel();
    this._closeConnection();
    this._cache.clear();
  }

  /**
   * @param {{ scan?: boolean, content?: boolean }} [options] `scan` runs the
   *   filesystem walk, `content` the full-text search of indexed file contents.
   *   Both are skipped when the quick answer is not empty. They are separate so
   *   the caller can hold back the slow content search until the query settles
   *   without walking the filesystem a second time.
   */
  async _resolve(query, token, options = {}) {
    if (looksLikePath(query)) return searchPath(this._context(), query, token);

    const { scan = true, content = false } = options;

    await this._connect();
    const context = this._context();

    const cached = await this._liveCachedMatches(query, token);
    if (token.isStale) return null;

    const indexed = await searchIndex(context, query, token);
    if (token.isStale) return null;

    const known = mergeResults(cached, indexed ?? [], this._resultLimit);

    if (known.length > 0 || (!scan && !content)) return known;

    const [contentItems, scanned] = await Promise.all([
      content ? searchIndexContent(context, query, token) : [],
      scan ? searchScan(context, query, token) : [],
    ]);
    if (token.isStale) return null;

    return mergeResults(
      known,
      [...(contentItems ?? []), ...(scanned ?? [])],
      this._resultLimit,
    );
  }

  async _liveCachedMatches(query, token) {
    const cached = this._cache.matches(query, this._resultLimit);
    if (cached.length === 0) return cached;

    const missing = await statCandidates(this._fileSystem, cached, token);
    if (token.isStale) return [];

    for (const path of missing) this._cache.forget(path);
    return cached.filter((item) => !missing.has(item.path));
  }

  _context() {
    return {
      fileSystem: this._fileSystem,
      cache: this._cache,
      tracker: this._tracker,
      cancellable: this._cancellable,
      home: GLib.get_home_dir(),
      resultLimit: this._resultLimit,
    };
  }

  _closeConnection() {
    const connection = this._tracker ? this._tracker.connection : null;
    this._tracker = null;
    if (!connection) return;
    try {
      if (typeof connection.close === "function") connection.close();
    } catch (_error) {}
  }
}
