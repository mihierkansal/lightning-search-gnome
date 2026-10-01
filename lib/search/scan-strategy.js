/*
 * Lightning Search, filesystem scan strategy
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

import GLib from "gi://GLib";

import { byScoreThenTitle } from "../compare.js";
import { scoreMatch } from "../score.js";
import {
  FOLDER_SCORE_BONUS,
  SCAN_COLLECT_LIMIT,
  SCAN_MAX_DEPTH,
  SCAN_MAX_VISITS,
  SCAN_RESULT_LIMIT,
  SCAN_TIME_BUDGET_MS,
  SCORE_CUTOFF,
} from "./constants.js";

export async function searchScan(context, query, token) {
  const { fileSystem, cache } = context;
  const lowered = query.toLowerCase();
  const results = [];
  const queue = getSearchRoots().map((path) => ({ path, depth: 0 }));
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
  let head = 0;
  let visited = 0;

  const budgetLeft = () =>
    visited < SCAN_MAX_VISITS &&
    results.length < SCAN_COLLECT_LIMIT &&
    Date.now() < deadline &&
    !token.isStale;

  while (head < queue.length && budgetLeft()) {
    const { path, depth } = queue[head++];
    await fileSystem.listChildren(path, (child) => {
      visited++;
      if (!budgetLeft()) return false;
      const item = scanItem(child, lowered);
      if (item) results.push(item);
      if (child.isDirectory && depth < SCAN_MAX_DEPTH)
        queue.push({ path: child.path, depth: depth + 1 });
      return budgetLeft();
    });
  }

  if (token.isStale) return null;
  cache.remember(results);
  return results.sort(byScoreThenTitle).slice(0, SCAN_RESULT_LIMIT);
}

function scanItem(child, query) {
  const score = scoreMatch(query, {
    primary: child.name.toLowerCase(),
    secondary: child.path.toLowerCase(),
  });
  if (score <= SCORE_CUTOFF) return null;
  return {
    type: child.isDirectory ? "folder" : "file",
    title: child.name,
    subtitle: child.path,
    gicon: child.gicon,
    path: child.path,
    score: child.isDirectory ? score + FOLDER_SCORE_BONUS : score,
  };
}

function getSearchRoots() {
  const home = GLib.get_home_dir();
  const specials = [
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DESKTOP),
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOCUMENTS),
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD),
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES),
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_MUSIC),
    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_VIDEOS),
  ].filter(Boolean);

  return [
    home,
    ...new Set(specials.filter((path) => !path.startsWith(`${home}/`))),
  ];
}
