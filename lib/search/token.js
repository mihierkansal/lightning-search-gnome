/*
 * Lightning Search Launcher, search generation guard
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */
export class SearchGeneration {
  constructor() {
    this._value = 0;
  }

  get current() {
    return this._value;
  }

  invalidate() {
    this._value += 1;
  }

  begin() {
    this.invalidate();
    return new SearchToken(this, this._value);
  }
}

export class SearchToken {
  constructor(generation, value) {
    this._generation = generation;
    this._value = value;
  }

  get isStale() {
    return this._value !== this._generation.current;
  }
}
