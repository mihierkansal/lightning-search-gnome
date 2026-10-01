/*
 * Lightning Search Launcher, result scoring
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

const EXACT_MATCH_SCORE = 2000;

const NAME_PREFIX_BASE = 1200;
const NAME_PREFIX_PER_CHAR = 5;
const CONTEXT_PREFIX_BASE = 800;
const CONTEXT_PREFIX_PER_CHAR = 4;
const NAME_SUBSTRING_BASE = 800;
const NAME_SUBSTRING_PER_CHAR = 4;
const CONTEXT_SUBSTRING_BASE = 500;
const CONTEXT_SUBSTRING_PER_CHAR = 3;

const FUZZY_CONTEXT_PENALTY = 50;

/**
 * Scores how well a candidate matches a query.
 *
 * `primary` is the thing the user is looking for (file or application name),
 * `secondary` is supporting info (path or description).
 *
 * Returns 0 when nothing matches.
 */
export function scoreMatch(query, { primary, secondary }) {
  if (query === "") return 0;
  if (primary === query) return EXACT_MATCH_SCORE;
  if (primary.startsWith(query))
    return NAME_PREFIX_BASE + query.length * NAME_PREFIX_PER_CHAR;
  if (secondary.startsWith(query))
    return CONTEXT_PREFIX_BASE + query.length * CONTEXT_PREFIX_PER_CHAR;
  if (primary.includes(query))
    return NAME_SUBSTRING_BASE + query.length * NAME_SUBSTRING_PER_CHAR;
  if (secondary.includes(query))
    return CONTEXT_SUBSTRING_BASE + query.length * CONTEXT_SUBSTRING_PER_CHAR;

  return Math.max(
    fuzzyScore(query, primary),
    fuzzyScore(query, secondary) - FUZZY_CONTEXT_PENALTY,
  );
}

export function setFuzzyLevel(level) {
  if (!Object.prototype.hasOwnProperty.call(FUZZY_PROFILES, level))
    level = DEFAULT_FUZZY_LEVEL;
  fuzzyProfile = FUZZY_PROFILES[level];
}

export function fuzzyScore(query, text) {
  const profile = fuzzyProfile;
  if (!profile) return 0;
  if (query.length < profile.minQueryLength) return 0;
  const matcher = new SubsequenceMatcher(query, text, profile);
  return matcher.score();
}

class SubsequenceMatcher {
  constructor(query, text, profile) {
    this._query = query;
    this._text = text;
    this._profile = profile;
    this._score = 0;
    this._run = 0;
    this._firstMatchIndex = -1;
    this._lastMatchIndex = -1;
  }

  score() {
    if (!this._matchAll()) return 0;

    const densityFactor = DENSITY_FLOOR + DENSITY_WEIGHT * this._density();
    const lengthPenalty =
      (this._text.length - this._query.length) * LENGTH_PENALTY;
    return Math.max(
      0,
      BASE_SCORE + this._score * densityFactor - lengthPenalty,
    );
  }

  _matchAll() {
    const profile = this._profile;
    const first = this._boundaryIndex(this._query[0], 0);
    if (first === -1) return false;

    this._firstMatchIndex = first;
    this._lastMatchIndex = first;
    this._score += BOUNDARY_START_BONUS;

    let searchFrom = first + 1;
    let wordJumps = 0;
    for (let qi = 1; qi < this._query.length; qi++) {
      const character = this._query[qi];
      let index = this._indexOf(character, searchFrom);
      if (index === -1) return false;

      if (index - this._lastMatchIndex - 1 > profile.maxGap) {
        const boundary = this._boundaryIndex(character, index);
        if (boundary === -1 || wordJumps >= profile.maxWordJumps) return false;
        index = boundary;
        wordJumps += 1;
      }

      this._score += this._continuationScore(index);
      this._lastMatchIndex = index;
      searchFrom = index + 1;
    }

    const span = this._lastMatchIndex - this._firstMatchIndex + 1;
    return span <= this._query.length * profile.maxSpanPerChar;
  }

  _boundaryIndex(character, from) {
    for (let i = from; i < this._text.length; i++)
      if (this._text[i] === character && isWordBoundary(this._text, i))
        return i;
    return -1;
  }

  _continuationScore(index) {
    const gap = index - this._lastMatchIndex - 1;
    if (gap === 0) {
      this._run += 1;
      return RUN_SCORE + this._run * RUN_GROWTH;
    }
    this._run = 0;
    const boundary = isWordBoundary(this._text, index)
      ? BOUNDARY_RESUME_BONUS
      : MID_WORD_RESUME_SCORE;
    return boundary - Math.min(gap * GAP_PENALTY, GAP_PENALTY_CAP);
  }

  _indexOf(character, from) {
    for (let i = from; i < this._text.length; i++)
      if (this._text[i] === character) return i;
    return -1;
  }

  _density() {
    const span = this._lastMatchIndex - this._firstMatchIndex + 1;
    return this._query.length / span;
  }
}

const BASE_SCORE = 400;
const DENSITY_FLOOR = 0.4;
const DENSITY_WEIGHT = 0.6;
const LENGTH_PENALTY = 0.5;
const BOUNDARY_START_BONUS = 20;
const RUN_SCORE = 8;
const RUN_GROWTH = 2;
const BOUNDARY_RESUME_BONUS = 10;
const MID_WORD_RESUME_SCORE = 2;
const GAP_PENALTY = 3;
const GAP_PENALTY_CAP = 30;

const FUZZY_PROFILES = {
  off: null,
  balanced: {
    minQueryLength: 3,
    maxGap: 4,
    maxSpanPerChar: 3,
    maxWordJumps: 0,
  },
  loose: {
    minQueryLength: 2,
    maxGap: 4,
    maxSpanPerChar: 6,
    maxWordJumps: 3,
  },
};

const DEFAULT_FUZZY_LEVEL = "balanced";
let fuzzyProfile = FUZZY_PROFILES[DEFAULT_FUZZY_LEVEL];

function isWordBoundary(text, index) {
  const previous = text[index - 1];
  if (
    index === 0 ||
    previous === "-" ||
    previous === "_" ||
    previous === " " ||
    previous === "/"
  )
    return true;
  return isLower(previous) && isUpper(text[index]);
}

function isLower(character) {
  return character >= "a" && character <= "z";
}

function isUpper(character) {
  return character >= "A" && character <= "Z";
}

export function ftsExpression(query) {
  const tokens = tokenize(query);
  if (tokens.length === 0) return null;
  tokens[tokens.length - 1] += "*";
  return tokens.join(" ");
}

function tokenize(query) {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}
