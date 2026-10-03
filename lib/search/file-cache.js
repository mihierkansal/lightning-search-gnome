/*
 * Lightning Search Launcher, keystroke file cache
 *
 * Copyright (C) 2026 Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
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

  matches(query, limit = FILE_RESULT_LIMIT) {
    if (this._itemsByPath.size === 0) return [];
    const q = query.toLowerCase();

    return Array.from(this._itemsByPath.values())
      .map((item) => this._scoredCopy(item, q))
      .filter(Boolean)
      .sort(byScoreThenTitle)
      .slice(0, limit);
  }

  matchesIn(directoryPath, partial, limit = PATH_RESULT_LIMIT) {
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

    return rows.sort(byScoreThenTitle).slice(0, limit);
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

function directChildName(itemPath, directoryPath, prefix) {
  if (itemPath === directoryPath) return "";
  if (!itemPath.startsWith(prefix)) return null;
  const name = itemPath.slice(prefix.length);
  return name.includes("/") ? null : name;
}
