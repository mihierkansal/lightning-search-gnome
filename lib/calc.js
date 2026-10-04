/*
 * Lightning Search Launcher, calculator
 *
 * Copyright (C) 2026 Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

const RESULT_PRECISION = 15;
const RAD_PER_DEG = Math.PI / 180;

const ALLOWED_CHARS_RE = /^[\dA-Za-z\s+\-*/().%^!,]+$/;
const TRAILING_EQUALS_RE = /=\s*$/;
const NAME_RE = /[A-Za-z][A-Za-z0-9]*/y;
const NUMBER_RE = /(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/y;
const OPERAND_START_RE = /\s*[\d.(A-Za-z]/y;

const CONSTANTS = {
  pi: Math.PI,
  e: Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};

const BINARY_OPERATORS = {
  "+": (a, b) => a + b,
  "-": (a, b) => a - b,
  "*": (a, b) => a * b,
  "/": (a, b) => a / b,
  "%": (a, b) => a % b,
};

const toRadians = (x) => x * RAD_PER_DEG;
const toDegrees = (x) => x / RAD_PER_DEG;

// Non-integer factorial (Not my code - standard implementation from Stack Overflow)
function gamma(x) {
  const g = 7;
  const p = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];

  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));

  x -= 1;
  const t = x + g + 0.5;
  let sum = p[0];
  for (let i = 1; i < g + 2; i++) sum += p[i] / (x + i);
  return Math.sqrt(2 * Math.PI) * t ** (x + 0.5) * Math.exp(-t) * sum;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) return gamma(n + 1);
  let result = 1;
  for (let i = 2; i <= n; i++) result *= i;
  return result;
}

function rint(x) {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

function cleanResult(value) {
  return Number.isFinite(value)
    ? Number(value.toPrecision(RESULT_PRECISION))
    : value;
}

const unary = (fn) => ({ arity: 1, fn });
const binary = (fn) => ({ arity: 2, fn });

const trig = (fn) => ({
  ...unary(fn),
  degFn: (x) => fn(toRadians(x)),
});

const inverseTrig = (fn) => ({
  ...unary(fn),
  degFn: (x) => toDegrees(fn(x)),
});

const FUNCTIONS = {
  sqrt: unary(Math.sqrt),
  cbrt: unary(Math.cbrt),
  abs: unary(Math.abs),
  exp: unary(Math.exp),
  ln: unary(Math.log),
  log: unary(Math.log10),
  log10: unary(Math.log10),
  log2: unary(Math.log2),
  pow: binary(Math.pow),

  round: unary(Math.round),
  rint: unary(rint),
  floor: unary(Math.floor),
  ceil: unary(Math.ceil),

  fact: unary(factorial),
  fmod: binary((a, b) => a % b),
  hypot: binary(Math.hypot),
  min: binary(Math.min),
  max: binary(Math.max),

  rad: unary(toRadians),
  deg: unary(toDegrees),

  sin: trig(Math.sin),
  cos: trig(Math.cos),
  tan: trig(Math.tan),
  asin: inverseTrig(Math.asin),
  acos: inverseTrig(Math.acos),
  atan: inverseTrig(Math.atan),

  sinh: unary(Math.sinh),
  cosh: unary(Math.cosh),
  tanh: unary(Math.tanh),
  asinh: unary(Math.asinh),
  acosh: unary(Math.acosh),
  atanh: unary(Math.atanh),
};

function resolveFunction(name) {
  if (!!FUNCTIONS[name]) {
    const { arity, fn } = FUNCTIONS[name];
    return { arity, call: fn };
  }

  if (name.length > 1 && name.endsWith("d")) {
    const base = name.slice(0, -1);
    if (FUNCTIONS[base]?.degFn) {
      return { arity: FUNCTIONS[base].arity, call: FUNCTIONS[base].degFn };
    }
  }

  return null;
}

class Parser {
  constructor(input) {
    this._input = input;
    this._pos = 0;
  }

  parse() {
    const value = this._parseExpression();
    if (this._peek() !== "")
      throw new SyntaxError(`unexpected "${this._input.slice(this._pos)}"`);
    return value;
  }

  _parseExpression() {
    let value = this._parseTerm();
    for (;;) {
      const op = this._eatAny("+-");
      if (!op) return value;
      value = BINARY_OPERATORS[op](value, this._parseTerm());
    }
  }

  _parseTerm() {
    let value = this._parseUnary();
    for (;;) {
      let op = this._eatWord("mod") ? "%" : this._eatAny("*/%");
      if (!op && this._operandFollows(this._pos)) op = "*";
      if (!op) return value;
      value = BINARY_OPERATORS[op](value, this._parseUnary());
    }
  }

  _parseUnary() {
    const sign = this._eatAny("+-");
    if (!sign) return this._parsePower();
    const value = this._parseUnary();
    return sign === "-" ? -value : value;
  }

  _parsePower() {
    const base = this._parsePostfix();
    return this._eat("^") ? base ** this._parseUnary() : base;
  }

  _parsePostfix() {
    let value = this._parsePrimary();
    for (;;) {
      const ch = this._peek();
      if (ch === "!") {
        this._pos++;
        value = factorial(value);
      } else if (ch === "%" && !this._operandFollows(this._pos + 1)) {
        // "50%" is a percentage but "7 % 3" is modulo
        this._pos++;
        value /= 100;
      } else {
        return value;
      }
    }
  }

  _parsePrimary() {
    if (this._eat("(")) {
      const value = this._parseExpression();
      this._expect(")");
      return value;
    }

    const name = this._matchAt(NAME_RE);
    if (name) {
      this._pos += name[0].length;
      return this._parseNamed(name[0]);
    }

    const number = this._matchAt(NUMBER_RE);
    if (!number)
      throw new SyntaxError(
        `expected a number at "${this._input.slice(this._pos)}"`,
      );
    this._pos += number[0].length;
    return Number(number[0]);
  }

  _parseNamed(name) {
    const key = name.toLowerCase();
    if (CONSTANTS[key] !== undefined) return CONSTANTS[key];

    const fn = resolveFunction(key);
    if (!fn) throw new SyntaxError(`unknown function "${name}"`);

    const args = this._parseArguments(fn.arity);
    return fn.call(...args);
  }

  _parseArguments(arity) {
    const args = this._eat("(")
      ? this._parseArgumentList()
      : [this._parseUnary()];
    if (args.length !== arity)
      throw new SyntaxError(`expected ${arity} argument(s)`);
    return args;
  }

  _parseArgumentList() {
    const args = [];
    if (this._peek() !== ")") {
      do args.push(this._parseExpression());
      while (this._eat(","));
    }
    this._expect(")");
    return args;
  }

  _skipSpaces() {
    while (this._pos < this._input.length && /\s/.test(this._input[this._pos]))
      this._pos++;
  }

  _peek() {
    this._skipSpaces();
    return this._input[this._pos] || "";
  }

  _eat(ch) {
    if (this._peek() !== ch) return false;
    this._pos++;
    return true;
  }

  _eatAny(chars) {
    const ch = this._peek();
    if (ch === "" || !chars.includes(ch)) return null;
    this._pos++;
    return ch;
  }

  _eatWord(word) {
    this._skipSpaces();
    const end = this._pos + word.length;
    if (this._input.slice(this._pos, end).toLowerCase() !== word) return false;
    if (/[A-Za-z]/.test(this._input[end] || "")) return false;
    this._pos = end;
    return true;
  }

  _expect(ch) {
    if (!this._eat(ch)) throw new SyntaxError(`missing "${ch}"`);
  }

  _matchAt(re) {
    this._skipSpaces();
    re.lastIndex = this._pos;
    return re.exec(this._input);
  }

  _operandFollows(pos) {
    OPERAND_START_RE.lastIndex = pos;
    return OPERAND_START_RE.test(this._input);
  }
}

function stripTrailingEquals(q) {
  return q.replace(TRAILING_EQUALS_RE, "").trim();
}

function parses(expr) {
  try {
    new Parser(expr).parse();
    return true;
  } catch (_error) {
    return false;
  }
}

function looksLikeMath(expr) {
  return /\d/.test(expr) && /[+\-*/%^!()A-Za-z]/.test(expr);
}

export function isCalcQuery(q) {
  if (typeof q !== "string") return false;

  const expr = stripTrailingEquals(q);
  if (expr === "" || !ALLOWED_CHARS_RE.test(expr)) return false;

  const explicit = TRAILING_EQUALS_RE.test(q);
  if (!explicit && !looksLikeMath(expr)) return false;

  return parses(expr);
}

export function calculate(q) {
  const expr = stripTrailingEquals(q);
  if (expr === "") return null;

  try {
    const value = new Parser(expr).parse();
    return Number.isNaN(value) ? null : String(cleanResult(value));
  } catch (_error) {
    return null;
  }
}
