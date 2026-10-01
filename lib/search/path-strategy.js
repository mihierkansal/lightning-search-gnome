/*
 * Lightning Search, path listing strategy
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 * Path-style query: offer the target folder itself, then the children that
 * complete what the user has typed. One authoritative directory listing — the
 * listing on disk is the answer, but it is also remembered so the next
 * keystroke can paint its cached subset while this listing is re-read. Returns
 * null when the token went stale.
 */

import Gio from "gi://Gio";

import { byScoreThenTitle } from "../compare.js";
import {
  FOLDER_HEAD_SCORE,
  FOLDER_SCORE_BONUS,
  LISTED_CHILD_SCORE,
  PATH_COLLECT_LIMIT,
  PATH_RESULT_LIMIT,
} from "./constants.js";
import { resolvePathQuery } from "./path-query.js";

export async function searchPath(context, query, token) {
  const { fileSystem, home } = context;
  const { path, partial } = resolvePathQuery(query, home);
  if (!(await fileSystem.exists(path))) return [];
  if (token.isStale) return null;

  const items = [await directoryItem(fileSystem, path)];
  const seen = new Set([path]);

  await fileSystem.listChildren(path, (child) => {
    if (token.isStale || items.length >= PATH_COLLECT_LIMIT) return false;
    if (partial && !child.name.toLowerCase().startsWith(partial)) return true;
    if (seen.has(child.path)) return true;
    seen.add(child.path);
    items.push(listedChildItem(child));
    return true;
  });

  if (token.isStale) return null;
  const ranked = items.sort(byScoreThenTitle).slice(0, PATH_RESULT_LIMIT);
  context.cache.remember(ranked);
  return ranked;
}

async function directoryItem(fileSystem, path) {
  const info = await fileSystem.stat(path);
  return {
    type: "folder",
    title: Gio.File.new_for_path(path).get_basename() || path,
    subtitle: path,
    path,
    gicon: info ? info.gicon : null,
    score: FOLDER_HEAD_SCORE,
  };
}

function listedChildItem(child) {
  return {
    type: child.isDirectory ? "folder" : "file",
    title: child.name,
    subtitle: child.path,
    gicon: child.gicon,
    path: child.path,
    score: LISTED_CHILD_SCORE + (child.isDirectory ? FOLDER_SCORE_BONUS : 0),
  };
}
