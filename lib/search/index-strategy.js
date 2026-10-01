/*
 * Lightning Search, indexed search strategy
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 * Queries LocalSearch (Tracker 3) for files whose name or contents match.
 * Uses `fts:match` rather than `FILTER(CONTAINS(...))`: the latter performs a
 * full index scan and takes ~1 s per call on a real desktop, which is what
 * used to freeze the shell.
 *
 * Returns null when the index is unusable *or* the token went stale; the
 * orchestrator tells those apart with the token rather than the return value.
 */

import Gio from "gi://Gio";

import { byScoreThenTitle } from "../compare.js";
import { ftsExpression, scoreMatch } from "../score.js";
import {
  closeCursor,
  cursorString,
  sparqlNextAsync,
  sparqlQueryAsync,
} from "../promise-adapters.js";
import {
  INDEX_MATCH_LIMIT,
  INDEX_ROW_LIMIT,
  SCORE_CUTOFF,
} from "./constants.js";
import { statCandidates } from "./file-system.js";

export async function searchIndex(context, query, token) {
  const tracker = context.tracker;
  if (!tracker) return null;

  const match = ftsExpression(query);
  if (!match) return [];

  const lowered = query.toLowerCase();
  const seen = new Set();
  const candidates = [];
  let cursor = null;
  try {
    const sparql = sparqlForMatch(tracker.escapeString(match));
    cursor = await sparqlQueryAsync(tracker.connection, sparql);

    while (candidates.length < INDEX_ROW_LIMIT) {
      if (token.isStale) return null;
      if (!(await sparqlNextAsync(cursor))) break;
      const candidate = indexedItem(cursor, lowered, seen);
      if (candidate) candidates.push(candidate);
    }
  } catch (_error) {
    return null;
  } finally {
    closeCursor(cursor);
  }

  if (token.isStale) return null;

  const missing = await statCandidates(context.fileSystem, candidates, token);
  if (token.isStale) return null;

  for (const path of missing) context.cache.forget(path);
  const live = candidates.filter((item) => !missing.has(item.path));
  context.cache.remember(live);
  return live.sort(byScoreThenTitle);
}

function indexedItem(cursor, query, seen) {
  const uri = cursorString(cursor, 0);
  const name = cursorString(cursor, 1);
  if (!uri || !name) return null;

  const path = Gio.File.new_for_uri(uri).get_path();
  if (!path || seen.has(path)) return null;
  seen.add(path);

  const score = scoreMatch(query, {
    primary: name.toLowerCase(),
    secondary: path.toLowerCase(),
  });
  if (score <= SCORE_CUTOFF) return null;
  return { type: "file", title: name, subtitle: path, path, score };
}

function sparqlForMatch(escapedMatch) {
  return `SELECT ?url ?name WHERE {
    ?f nie:url ?url ;
       nfo:fileName ?name .
    ?f fts:match "${escapedMatch}"
  } LIMIT ${INDEX_MATCH_LIMIT}`;
}
