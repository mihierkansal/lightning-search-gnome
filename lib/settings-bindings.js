/*
 * Lightning Search Launcher, settings change bindings
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

export class SettingsBindings {
  constructor(settings) {
    this._settings = settings;
    this._ids = [];
  }

  add(key, handler) {
    this._ids.push(this._settings.connect(`changed::${key}`, handler));
  }

  disconnectAll() {
    for (const id of this._ids) this._settings.disconnect(id);
    this._ids = [];
  }
}
