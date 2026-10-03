/*
 * Lightning Search Launcher, file result merging
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

import { byScoreThenTitle } from "../compare.js";
import { FILE_RESULT_LIMIT } from "./constants.js";

export function mergeResults(current, incoming, limit = FILE_RESULT_LIMIT) {
  const byPath = new Map();
  for (const item of [...current, ...incoming]) {
    if (!item || !item.path) continue;
    const known = byPath.get(item.path);
    if (!known || item.score >= known.score) byPath.set(item.path, item);
  }
  return Array.from(byPath.values())
    .sort(byScoreThenTitle)
    .slice(0, limit);
}
