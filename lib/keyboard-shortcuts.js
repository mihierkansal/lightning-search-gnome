/*
 * Spotlight Launcher for GNOME, global keyboard shortcuts
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Meta from "gi://Meta";
import Shell from "gi://Shell";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class KeyboardShortcuts {
  constructor() {
    this._grabbers = new Map();
    this._acceleratorActivatedId = 0;
  }

  enable() {
    if (this._acceleratorActivatedId) return;
    this._acceleratorActivatedId = global.display.connect(
      "accelerator-activated",
      (_display, action) => this._onAcceleratorActivated(action),
    );
  }

  disable() {
    this.unlisten();
    if (!this._acceleratorActivatedId) return;
    global.display.disconnect(this._acceleratorActivatedId);
    this._acceleratorActivatedId = 0;
  }

  listenFor(accelerator, callback) {
    const action = global.display.grab_accelerator(accelerator, 0);
    if (action === Meta.KeyBindingAction.NONE) return false;

    const name = Meta.external_binding_name_for_action(action);
    Main.wm.allowKeybinding(name, Shell.ActionMode.ALL);
    this._grabbers.set(action, { accelerator, callback });
    return true;
  }

  unlisten() {
    for (const action of this._grabbers.keys())
      global.display.ungrab_accelerator(action);
    this._grabbers.clear();
  }

  _onAcceleratorActivated(action) {
    const grabber = this._grabbers.get(action);
    if (grabber) grabber.callback();
  }
}
