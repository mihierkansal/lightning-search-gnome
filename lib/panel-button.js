/*
 * Lightning Search Launcher, panel button
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import GObject from "gi://GObject";
import St from "gi://St";

import * as PanelMenu from "resource:///org/gnome/shell/ui/panelMenu.js";

const ICON_NAME = "system-search-symbolic";
const ACCESSIBLE_NAME = "Lightning Search Launcher";

let PanelButtonClass = null;

export function getPanelButton() {
  if (!PanelButtonClass) {
    PanelButtonClass = GObject.registerClass(
      { GTypeName: "LightningSearchPanelButton" },
      class PanelButton extends PanelMenu.Button {
        constructor(onActivate) {
          super(0.0, ACCESSIBLE_NAME, true);
          this._onActivate = onActivate;
          this.add_style_class_name("lightning-panel-button");
          this.add_child(
            new St.Icon({
              icon_name: ICON_NAME,
              style_class: "system-status-icon",
            }),
          );
        }

        vfunc_event(event) {
          const type = event.type();
          if (
            type === Clutter.EventType.BUTTON_PRESS ||
            type === Clutter.EventType.TOUCH_BEGIN
          ) {
            this._onActivate();
            return Clutter.EVENT_STOP;
          }
          return Clutter.EVENT_PROPAGATE;
        }
      },
    );
  }
  return PanelButtonClass;
}
