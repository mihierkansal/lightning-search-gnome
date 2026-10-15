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
import GLib from "gi://GLib";

import { byScoreThenTitle } from "../compare.js";
import { fileUsageKey, frecencyBonus } from "../frecency.js";
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
  const terms = buildTerms(context, query);
  if (!terms) return [];

  const collector = new MatchCollector(context, terms, token);
  const drained = await collector.drain(sparqlForName(terms.escaped));
  if (drained === null || collector.stale) return null;
  return finalize(context, collector.items, token);
}

export async function searchIndexContent(context, query, token) {
  const terms = buildTerms(context, query);
  if (!terms) return [];

  const collector = new MatchCollector(context, terms, token);
  let drained = await collector.drain(
    sparqlForContentWithSnippet(terms.escaped),
    {
      withSnippet: true,
    },
  );
  if (drained === null && !collector.stale)
    drained = await collector.drain(sparqlForContent(terms.escaped));
  if (collector.stale) return null;
  if (drained === null && collector.items.length === 0) return null;
  return finalize(context, collector.items, token);
}

function buildTerms(context, query) {
  const tracker = context.tracker;
  if (!tracker) return null;

  const match = ftsExpression(query);
  if (!match) return null;

  return {
    escaped: tracker.escapeString(match),
    lowered: query.toLowerCase(),
    tokens: matchTokens(match),
  };
}

/**
 * Drop rows whose file disappeared between indexing and now, and remember what
 * survived so the next keystroke does not have to ask the index again.
 */
async function finalize(context, items, token) {
  const missing = await statCandidates(context.fileSystem, items, token);
  if (token.isStale) return null;

  for (const path of missing) context.cache.forget(path);
  const live = items.filter((item) => !missing.has(item.path));
  context.cache.remember(live);
  return live.sort(byScoreThenTitle);
}

class MatchCollector {
  constructor(context, terms, token) {
    this._tracker = context.tracker;
    this._cancellable = context.cancellable ?? null;
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
      cursor = await sparqlQueryAsync(
        this._tracker.connection,
        sparql,
        this._cancellable,
      );

      while (!this.full) {
        if (this.stale) return null;
        if (!(await sparqlNextAsync(cursor, this._cancellable))) break;
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
    if (!uri) return null;

    const path = Gio.File.new_for_uri(uri).get_path();
    if (!path || this._seen.has(path)) return null;

    const name = GLib.path_get_basename(path);
    if (!name || name === "/") return null;

    const base = { type: "file", title: name, path };
    const boost = frecencyBonus(fileUsageKey(path));
    const score = scoreMatch(this._terms.lowered, {
      primary: name.toLowerCase(),
      secondary: path.toLowerCase(),
    });
    if (score > SCORE_CUTOFF)
      return {
        ...base,
        subtitle: path,
        score: score + boost,
        matchSource: "name",
      };

    const snippet = withSnippet
      ? matchLine(cursorString(cursor, 1), this._terms.tokens)
      : "";
    if (!snippet) return null;
    return {
      ...base,
      subtitle: snippet,
      snippet,
      score: CONTENT_MATCH_SCORE + boost,
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
  return `SELECT ?url WHERE {
    ?f nie:url ?url .
    ?f fts:match "${escapedMatch}"
  } LIMIT ${INDEX_MATCH_LIMIT}`;
}

function sparqlForContent(escapedMatch) {
  return contentQuery(escapedMatch, "?url", "");
}

function sparqlForContentWithSnippet(escapedMatch) {
  const snippet = `\n    BIND(fts:snippet(?doc, '', '', '...', ${CONTENT_SNIPPET_WORDS}) AS ?snippet)`;
  return contentQuery(escapedMatch, "?url ?snippet", snippet);
}

function contentQuery(escapedMatch, projection, snippet) {
  return `SELECT ${projection} WHERE {
    ?doc fts:match "${escapedMatch}" .
    ?fd nie:interpretedAs ?doc ;
        nie:url ?url .${snippet}
  } ORDER BY DESC(fts:rank(?doc)) LIMIT ${INDEX_MATCH_LIMIT}`;
}
