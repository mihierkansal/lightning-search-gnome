/*
 * Lightning Search, keystroke file cache
 *
 * Copyright (C) 2026 Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 * Candidates collected by finished searches, scored against the whole path so
 * a query extension can show its matching subset while the next index query
 * is still running. Its cutoffs are the search's own, so a cached row is never
 * held to a different standard than a fresh one.
 */

import { byScoreThenTitle } from "../compare.js";
import { scoreMatch } from "../score.js";
import {
  FILE_RESULT_LIMIT,
  PATH_RESULT_LIMIT,
  SCORE_CUTOFF,
} from "./constants.js";

const CACHE_LIMIT = 1000;

export class FileCache {
  constructor() {
    this._itemsByPath = new Map();
  }

  get size() {
    return this._itemsByPath.size;
  }

  clear() {
    this._itemsByPath.clear();
  }

  forget(path) {
    this._itemsByPath.delete(path);
  }

  remember(items) {
    for (const item of items) {
      if (!item || !item.path) continue;
      this._itemsByPath.delete(item.path);
      this._itemsByPath.set(item.path, { ...item });
    }
    this._evictBeyondLimit();
  }

  matches(query) {
    if (this._itemsByPath.size === 0) return [];
    const q = query.toLowerCase();

    return Array.from(this._itemsByPath.values())
      .map((item) => this._scoredCopy(item, q))
      .filter(Boolean)
      .sort(byScoreThenTitle)
      .slice(0, FILE_RESULT_LIMIT);
  }

  matchesIn(directoryPath, partial) {
    const prefix = directoryPath === "/" ? "/" : `${directoryPath}/`;
    const wanted = partial.toLowerCase();
    const rows = [];

    for (const item of this._itemsByPath.values()) {
      const name = directChildName(item.path, directoryPath, prefix);
      if (name === null) continue;
      if (name !== "" && wanted && !name.toLowerCase().startsWith(wanted))
        continue;
      rows.push({ ...item });
    }

    return rows.sort(byScoreThenTitle).slice(0, PATH_RESULT_LIMIT);
  }

  _scoredCopy(item, query) {
    const score = scoreMatch(query, {
      primary: item.title.toLowerCase(),
      secondary: item.path.toLowerCase(),
    });
    return score > SCORE_CUTOFF ? { ...item, score } : null;
  }

  _evictBeyondLimit() {
    while (this._itemsByPath.size > CACHE_LIMIT) {
      const oldestPath = this._itemsByPath.keys().next().value;
      this._itemsByPath.delete(oldestPath);
    }
  }
}

/**
 * Name `itemPath` carries when it is `directoryPath` itself ("") or one of its
 * direct children; null when it lives somewhere else entirely.
 */
function directChildName(itemPath, directoryPath, prefix) {
  if (itemPath === directoryPath) return "";
  if (!itemPath.startsWith(prefix)) return null;
  const name = itemPath.slice(prefix.length);
  return name.includes("/") ? null : name;
}
