/*
 * Spotlight Launcher for GNOME, calculator
 *
 * Copyright (C) 2026 Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

const CALC_QUERY_RE = /^[\d\s+\-*/().%^]+$/;

const RESULT_PRECISION = 15;

function cleanResult(value) {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(RESULT_PRECISION));
}

export function isCalcQuery(q) {
  return CALC_QUERY_RE.test(q) && /[\d)]/.test(q) && /[+\-*/%^]/.test(q);
}

export function calculate(q) {
  try {
    const value = new Parser(q).parse();
    return Number.isNaN(value) ? null : String(cleanResult(value));
  } catch (_error) {
    return null;
  }
}

class Parser {
  constructor(input) {
    this.input = input;
    this.pos = 0;
  }

  parse() {
    const value = this.parseExpression();
    this.skipSpaces();
    if (this.pos !== this.input.length)
      throw new SyntaxError(`unexpected "${this.input.slice(this.pos)}"`);
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();
    for (;;) {
      const op = this.takeOperator("+-");
      if (!op) return value;
      const right = this.parseTerm();
      value = op === "+" ? value + right : value - right;
    }
  }

  parseTerm() {
    let value = this.parseUnary();
    for (;;) {
      const op = this.takeOperator("*/%");
      if (!op) return value;
      const right = this.parseUnary();
      if (op === "*") value *= right;
      else if (op === "/") value /= right;
      else value %= right;
    }
  }

  parseUnary() {
    const op = this.takeOperator("+-");
    if (!op) return this.parsePower();
    const value = this.parseUnary();
    return op === "-" ? -value : value;
  }

  parsePower() {
    const base = this.parsePrimary();
    if (!this.consume("^")) return base;
    return base ** this.parseUnary();
  }

  parsePrimary() {
    this.skipSpaces();
    if (this.consume("(")) {
      const value = this.parseExpression();
      if (!this.consume(")")) throw new SyntaxError('missing ")"');
      return value;
    }

    const rest = this.input.slice(this.pos);
    const match = /^(?:\d+\.\d*|\.\d+|\d+)/.exec(rest);
    if (!match) throw new SyntaxError(`expected a number at "${rest}"`);
    this.pos += match[0].length;
    return Number(match[0]);
  }

  takeOperator(chars) {
    this.skipSpaces();
    const ch = this.input[this.pos];
    if (ch && chars.includes(ch)) {
      this.pos++;
      return ch;
    }
    return null;
  }

  consume(ch) {
    this.skipSpaces();
    if (this.input[this.pos] !== ch) return false;
    this.pos++;
    return true;
  }

  skipSpaces() {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos]))
      this.pos++;
  }
}
