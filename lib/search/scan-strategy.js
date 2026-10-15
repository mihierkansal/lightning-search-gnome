/*
 * Lightning Search Launcher, filesystem scan strategy
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

import GLib from "gi://GLib";

import { byScoreThenTitle } from "../compare.js";
import { fileUsageKey, frecencyBonus } from "../frecency.js";
import { scoreMatch } from "../score.js";
import { statCandidates } from "./file-system.js";
import {
  FOLDER_SCORE_BONUS,
  SCAN_ATTRIBUTES,
  SCAN_MAX_DEPTH,
  SCAN_MAX_VISITS,
  SCAN_RESULT_LIMIT,
  SCAN_TIME_BUDGET_MS,
  SCORE_CUTOFF,
} from "./constants.js";

export async function searchScan(context, query, token) {
  const { fileSystem, cache } = context;
  const lowered = query.toLowerCase();
  const resultLimit = context.resultLimit ?? SCAN_RESULT_LIMIT;
  const results = [];
  const queue = getSearchRoots().map((path) => ({ path, depth: 0 }));
  const deadline = Date.now() + SCAN_TIME_BUDGET_MS;
  let head = 0;
  let visited = 0;
  let foundExact = false;

  const budgetLeft = () =>
    visited < SCAN_MAX_VISITS &&
    !foundExact &&
    Date.now() < deadline &&
    !token.isStale;

  while (head < queue.length && budgetLeft()) {
    const { path, depth } = queue[head++];
    await fileSystem.listChildren(
      path,
      (child) => {
        visited++;
        if (!budgetLeft()) return false;
        const item = scanItem(child, lowered);
        if (item) results.push(item);
        if (child.name.toLowerCase() === lowered) {
          foundExact = true;
          return false;
        }
        if (child.isDirectory && depth < SCAN_MAX_DEPTH)
          queue.push({ path: child.path, depth: depth + 1 });
        return budgetLeft();
      },
      SCAN_ATTRIBUTES,
    );
  }

  if (token.isStale) return null;

  const ranked = results.sort(byScoreThenTitle);
  const shown = ranked.slice(0, resultLimit);
  cache.remember(ranked);

  const missing = await statCandidates(fileSystem, shown, token);
  if (token.isStale) return null;
  return shown.filter((item) => !missing.has(item.path));
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
    path: child.path,
    score:
      score +
      (child.isDirectory ? FOLDER_SCORE_BONUS : 0) +
      frecencyBonus(fileUsageKey(child.path)),
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
