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
import { looksLikePath } from "./path-query.js";
import { searchPath } from "./path-strategy.js";
import { searchScan } from "./scan-strategy.js";
import { SearchGeneration } from "./token.js";
import {
  FILE_RESULT_LIMIT,
  TRACKER_BUS_NAME,
  TRACKER_OBJECT_PATH,
} from "./constants.js";
import { trackerBusNewAsync } from "../promise-adapters.js";

const SEARCH_DEADLINE_MS = 1500;

const INDEX_RETRY_MS = 15000;

const TRACKER_CONNECT_TIMEOUT_MS = 500;

const TIMED_OUT = Symbol("timed-out");

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
    this._indexStalledUntil = 0;
  }

  warmup() {
    if (this._disposed) return;
    this._connect().catch(() => {});
  }

  _connect() {
    if (this._tracker || this._disposed) return Promise.resolve();

    if (!this._trackerPromise) {
      const attempt = this._openTracker().finally(() => {
        if (this._trackerPromise === attempt) this._trackerPromise = null;
      });
      this._trackerPromise = attempt;
    }
    return this._trackerPromise;
  }

  async _openTracker() {
    const module = await this._loadTrackerModule();
    if (!module || this._disposed) return;

    const Tracker = module.default ?? module;
    const pending = trackerBusNewAsync(
      Tracker,
      TRACKER_BUS_NAME,
      TRACKER_OBJECT_PATH,
    );
    const connection = await withDeadline(pending, TRACKER_CONNECT_TIMEOUT_MS);
    if (connection === TIMED_OUT || connection === null) {
      if (connection === TIMED_OUT)
        pending.then(
          (late) => closeQuietly(late),
          () => {},
        );
      this._indexStalledUntil = Date.now() + INDEX_RETRY_MS;
      return;
    }

    if (this._disposed) {
      closeQuietly(connection);
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

  async _indexStage(load, token) {
    if (token.isStale) return [];
    if (Date.now() < this._indexStalledUntil) return [];

    const rows = await withDeadline(load(), SEARCH_DEADLINE_MS);
    if (rows === TIMED_OUT) {
      this._indexStalledUntil = Date.now() + INDEX_RETRY_MS;
      return [];
    }
    if (rows === null) {
      if (!token.isStale) this._resetTracker();
      return [];
    }

    this._indexStalledUntil = 0;
    return rows;
  }

  dispose() {
    this._disposed = true;
    this.cancel();
    this._closeConnection();
    this._cache.clear();
  }

  async _resolve(query, token, options = {}) {
    if (looksLikePath(query)) return searchPath(this._context(), query, token);

    const { scan = true, content = false } = options;

    if (Date.now() >= this._indexStalledUntil) await this._connect();
    const context = this._context();

    const cached = await this._liveCachedMatches(query, token);
    if (token.isStale) return null;

    const indexed = await this._indexStage(
      () => searchIndex(context, query, token),
      token,
    );
    if (token.isStale) return null;

    const known = mergeResults(cached, indexed, this._resultLimit);

    if (known.length > 0 || (!scan && !content)) return known;

    const [contentItems, scanned] = await Promise.all([
      content
        ? this._indexStage(
            () => searchIndexContent(context, query, token),
            token,
          )
        : [],
      scan ? searchScan(context, query, token) : [],
    ]);
    if (token.isStale) return null;

    return mergeResults(
      known,
      [...contentItems, ...(scanned ?? [])],
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

  _resetTracker() {
    if (this._disposed) return;
    this._closeConnection();
    this._trackerPromise = null;
  }
}

function withDeadline(promise, ms) {
  return new Promise((resolve) => {
    let timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
      timeoutId = 0;
      resolve(TIMED_OUT);
      return GLib.SOURCE_REMOVE;
    });

    const settle = (value) => {
      if (timeoutId) GLib.Source.remove(timeoutId);
      timeoutId = 0;
      resolve(value);
    };
    promise.then(settle, () => settle(null));
  });
}

function closeQuietly(connection) {
  try {
    if (connection && typeof connection.close === "function")
      connection.close();
  } catch (_error) {}
}
