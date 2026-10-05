/*
 * Lightning Search Launcher, indexed search strategy
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
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
  CONTENT_MATCH_SCORE,
  CONTENT_SNIPPET_WORDS,
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

  const terms = {
    match,
    lowered: query.toLowerCase(),
    tokens: matchTokens(match),
  };
  const candidates = await collectMatches(tracker, terms, token);
  if (candidates === null) return null;

  const missing = await statCandidates(context.fileSystem, candidates, token);
  if (token.isStale) return null;

  for (const path of missing) context.cache.forget(path);
  const live = candidates.filter((item) => !missing.has(item.path));
  context.cache.remember(live);
  return live.sort(byScoreThenTitle);
}

async function collectMatches(tracker, terms, token) {
  const escaped = tracker.escapeString(terms.match);
  const collector = new MatchCollector({ tracker, terms, token });

  const nameResult = await collector.drain(sparqlForName(escaped));
  if (nameResult === null) return null;

  let contentResult = await collector.drain(
    sparqlForContentWithSnippet(escaped),
    { withSnippet: true },
  );
  if (contentResult === null && !collector.stale) {
    contentResult = await collector.drain(sparqlForContent(escaped));
  }
  if (collector.stale) return null;

  return contentResult === null && collector.items.length === 0
    ? null
    : collector.items;
}

class MatchCollector {
  constructor({ tracker, terms, token }) {
    this._tracker = tracker;
    this._terms = terms;
    this._token = token;
    this._seen = new Set();
    this.items = [];
  }

  get stale() {
    return this._token.isStale;
  }

  get full() {
    return this.items.length >= INDEX_ROW_LIMIT;
  }

  async drain(sparql, { withSnippet = false } = {}) {
    let cursor = null;
    try {
      cursor = await sparqlQueryAsync(this._tracker.connection, sparql);

      while (!this.full) {
        if (this.stale) return null;
        if (!(await sparqlNextAsync(cursor))) break;
        const item = this._item(cursor, withSnippet);
        if (!item) continue;
        this._seen.add(item.path);
        this.items.push(item);
      }
    } catch (_error) {
      return null;
    } finally {
      closeCursor(cursor);
    }

    return this.stale ? null : true;
  }

  _item(cursor, withSnippet) {
    const uri = cursorString(cursor, 0);
    const name = cursorString(cursor, 1);
    if (!uri || !name) return null;

    const path = Gio.File.new_for_uri(uri).get_path();
    if (!path || this._seen.has(path)) return null;

    const base = { type: "file", title: name, path };
    const score = scoreMatch(this._terms.lowered, {
      primary: name.toLowerCase(),
      secondary: path.toLowerCase(),
    });
    if (score > SCORE_CUTOFF)
      return { ...base, subtitle: path, score, matchSource: "name" };

    const snippet = withSnippet
      ? matchLine(cursorString(cursor, 2), this._terms.tokens)
      : "";
    if (!snippet) return null;
    return {
      ...base,
      subtitle: snippet,
      snippet,
      score: CONTENT_MATCH_SCORE,
      matchSource: "content",
    };
  }
}

function matchTokens(match) {
  return match.split(/\s+/).map((part) => part.replace(/\*$/, ""));
}

function matchLine(snippet, tokens) {
  if (!snippet) return "";
  let best = null;
  let bestHits = 0;
  for (const line of snippet.split(/\r?\n/)) {
    const hits = lineHits(line, tokens);
    if (hits > bestHits) {
      bestHits = hits;
      best = line;
    }
  }
  return collapseWhitespace(best ?? snippet);
}

function lineHits(line, tokens) {
  const lowered = line.toLowerCase();
  let hits = 0;
  for (const token of tokens) {
    if (token === "" || !lowered.includes(token)) continue;
    hits += isWholeWord(lowered, token) ? 2 : 1;
  }
  return hits;
}

function isWholeWord(text, token) {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const boundary = `(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`;
  return new RegExp(boundary, "u").test(text);
}

function collapseWhitespace(text) {
  return text ? text.replace(/\s+/g, " ").trim() : "";
}

function sparqlForName(escapedMatch) {
  return `SELECT ?url ?name WHERE {
    ?f nie:url ?url ;
       nfo:fileName ?name .
    ?f fts:match "${escapedMatch}"
  } ORDER BY DESC(fts:rank(?f)) LIMIT ${INDEX_MATCH_LIMIT}`;
}

function sparqlForContent(escapedMatch) {
  return contentQuery(escapedMatch, "?url ?name", "");
}

function sparqlForContentWithSnippet(escapedMatch) {
  const snippet = `\n    BIND(fts:snippet(?doc, '', '', '...', ${CONTENT_SNIPPET_WORDS}) AS ?snippet)`;
  return contentQuery(escapedMatch, "?url ?name ?snippet", snippet);
}

function contentQuery(escapedMatch, projection, snippet) {
  return `SELECT ${projection} WHERE {
    ?doc fts:match "${escapedMatch}" .
    ?fd nie:interpretedAs ?doc ;
        nie:url ?url ;
        nfo:fileName ?name .${snippet}
  } ORDER BY DESC(fts:rank(?doc)) LIMIT ${INDEX_MATCH_LIMIT}`;
}
