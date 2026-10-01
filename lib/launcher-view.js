/*
 * Lightning Search, launcher view
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const WIDTH = 600;
const TOP_OFFSET_RATIO = 0.22;

const DEFAULT_PLACEHOLDER = "Search";
const DEFAULT_ENTRY_ICON_SIZE = 21;
const DEFAULT_SELECTION_COLOR = "rgba(0, 122, 255, 0.9)";
const DEFAULT_SELECTION_TEXT_COLOR = "white";

function entryIconStyle(size) {
  return `height: ${size}px;`;
}

const SHOW_ANIMATION_MS = 160;
const HIDE_ANIMATION_MS = 140;
const ANIMATION_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;
const HIDDEN_SCALE = 1.03;

const Event = {
  QUERY_CHANGED: "QueryChanged",
  ACTIVATION_REQUESTED: "ActivationRequested",
  SELECTION_MOVED: "SelectionMoved",
  DISMISS_REQUESTED: "DismissRequested",
};

export class LauncherView {
  /** @type {LauncherViewHandlers} */
  handlers = {};

  constructor(placeholderText = DEFAULT_PLACEHOLDER) {
    this._placeholderText = placeholderText;
    this._overlay = null;
    this._box = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._entryIconVisible = true;
    this._entryIconSize = DEFAULT_ENTRY_ICON_SIZE;
    this._results = null;
    this._destroyIdleId = 0;
    this._signals = [];
    this._isVisible = false;
    this._isHiding = false;
    this._paintedSignature = null;
    this._selectedIndex = -1;
    this._selectionColor = "";
    this._selectionTextColor = "";
  }

  get entryText() {
    return this._entry ? this._entry.get_text() : "";
  }

  get placeholderText() {
    return this._placeholderText;
  }

  set placeholderText(text) {
    this._placeholderText = text;
    if (this._entry) this._entry.set_hint_text(text);
  }

  set entryText(text) {
    if (this._entry) this._entry.set_text(text);
  }

  get entryIconVisible() {
    return this._entryIconVisible;
  }

  set entryIconVisible(visible) {
    this._entryIconVisible = !!visible;
    if (this._entryIconBox) this._entryIconBox.visible = this._entryIconVisible;
  }

  get entryIconSize() {
    return this._entryIconSize;
  }

  set entryIconSize(size) {
    this._entryIconSize = size;
    if (this._entryIcon) this._entryIcon.set_style(entryIconStyle(size));
  }

  get isVisible() {
    return this._isVisible;
  }

  get selectionColor() {
    return this._selectionColor;
  }

  set selectionColor(color) {
    this._selectionColor = color || "";
    if (this._results) this._refreshSelection(this._selectedIndex);
  }

  get selectionTextColor() {
    return this._selectionTextColor;
  }

  set selectionTextColor(color) {
    this._selectionTextColor = color || "";
    if (this._results) this._refreshSelection(this._selectedIndex);
  }

  build() {
    this._cancelDestroyIdle();
    if (this._overlay) return;

    this._buildActors();
    this._connectSignals();
    Main.layoutManager.addChrome(this._overlay, { affectsStruts: false });
  }

  destroy() {
    this._cancelDestroyIdle();
    if (this._overlay) this._removeActors();
    this._overlay = null;
    this._box = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._results = null;
    this._isVisible = false;
  }

  destroyWhenIdle() {
    this._destroyIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._destroyIdleId = 0;
      this.destroy();
      return GLib.SOURCE_REMOVE;
    });
  }

  show(monitor) {
    this.build();
    this._placeOnMonitor(monitor);
    this._resetForOpen();

    this._overlay.show();
    this._animateOpen();

    global.stage.set_key_focus(this._entry.clutter_text);
  }

  hide(onFullyHidden) {
    if (!this._overlay || this._isHiding) return;
    this._isVisible = false;
    this._isHiding = true;

    global.stage.set_key_focus(null);

    const overlay = this._overlay;
    overlay.ease({
      opacity: 0,
      duration: HIDE_ANIMATION_MS,
      mode: ANIMATION_MODE,
      onStopped: () => {
        this._isHiding = false;
        if (this._isVisible || this._overlay !== overlay) return;
        overlay.hide();
        if (onFullyHidden) onFullyHidden();
      },
    });
    this._animateBoxToHiddenScale();
  }

  renderResults(items, rowIdentities, selectedIndex, buildRowAt) {
    if (!this._results) return;

    this._results.show();
    const signature = rowIdentities.join("\u0001");
    if (signature === this._paintedSignature) {
      this._refreshSelection(selectedIndex);
      return;
    }
    this._paintedSignature = signature;

    this._results.destroy_all_children();
    items.forEach((item, index) =>
      this._results.add_child(buildRowAt(index, item)),
    );
    this._refreshSelection(selectedIndex);
  }

  setSelection(selectedIndex) {
    this._refreshSelection(selectedIndex);
  }

  clearResults() {
    this._paintedSignature = null;
    if (!this._results) return;
    this._results.destroy_all_children();
    this._results.hide();
    this._selectedIndex = -1;
    this._invalidateShadow();
  }

  _invalidateShadow() {
    if (!this._overlay) return;
    global.stage.queue_redraw();
  }

  _buildActors() {
    this._overlay = new St.Widget({
      reactive: true,
      visible: false,
      can_focus: true,
      layout_manager: new Clutter.BinLayout(),
      style_class: "lightning-overlay popup-menu",
    });

    this._box = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      reactive: true,
      can_focus: true,
      style_class: "lightning-search-box popup-menu-content",
    });

    const entryRow = new St.BoxLayout({
      orientation: Clutter.Orientation.HORIZONTAL,
      x_expand: true,
      style_class: "lightning-entry-row",
    });
    this._entryIconBox = new St.Widget({
      style_class: "lightning-entry-icon-box",
      layout_manager: new Clutter.BinLayout(),
      y_align: Clutter.ActorAlign.CENTER,
      visible: this._entryIconVisible,
      opacity: 225,
    });
    this._entryIcon = new St.Icon({
      icon_name: "system-search-symbolic",
      style_class: "lightning-entry-icon",
      style: entryIconStyle(this._entryIconSize),
    });
    this._entryIconBox.add_child(this._entryIcon);
    entryRow.add_child(this._entryIconBox);

    this._entry = new St.Entry({
      hint_text: this._placeholderText,
      can_focus: true,
      x_expand: true,
      style_class: "lightning-entry",
    });
    entryRow.add_child(this._entry);

    this._results = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: false,
      style_class: "lightning-results",
      visible: false,
    });

    this._box.add_child(entryRow);
    this._box.add_child(this._results);
    this._overlay.add_child(this._box);
  }

  _connectSignals() {
    const clutterText = this._entry.clutter_text;
    this._signals = [
      {
        actor: clutterText,
        id: clutterText.connect("text-changed", () =>
          this._emit(Event.QUERY_CHANGED),
        ),
      },
      {
        actor: clutterText,
        id: clutterText.connect("activate", () =>
          this._emit(Event.ACTIVATION_REQUESTED),
        ),
      },
      {
        actor: clutterText,
        id: clutterText.connect("key-press-event", (_actor, event) =>
          this._onEntryKeyPress(event),
        ),
      },
      {
        actor: this._overlay,
        id: this._overlay.connect("button-press-event", (_actor, event) =>
          this._onOverlayClick(event),
        ),
      },
    ];
  }

  _removeActors() {
    for (const { actor, id } of this._signals) {
      try {
        actor.disconnect(id);
      } catch (_error) {}
    }
    this._signals = [];

    try {
      Main.layoutManager.removeChrome(this._overlay);
      this._overlay.destroy();
    } catch (error) {
      console.debug(`[Lightning Search] Failed to remove overlay: ${error.message}`);
    }
  }

  _onEntryKeyPress(event) {
    const symbol = event.get_key_symbol();

    if (symbol === Clutter.KEY_Escape) {
      this._emit(Event.DISMISS_REQUESTED);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Down || symbol === Clutter.KEY_Tab) {
      this._emit(Event.SELECTION_MOVED, 1);
      return Clutter.EVENT_STOP;
    }
    if (symbol === Clutter.KEY_Up) {
      this._emit(Event.SELECTION_MOVED, -1);
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  _onOverlayClick(event) {
    const [x, y] = event.get_coords();
    const [boxX, boxY] = this._box.get_transformed_position();
    const clickIsOutsideBox =
      x < boxX ||
      x > boxX + this._box.width ||
      y < boxY ||
      y > boxY + this._box.height;
    if (clickIsOutsideBox) this._emit(Event.DISMISS_REQUESTED);
    return Clutter.EVENT_PROPAGATE;
  }

  _placeOnMonitor(monitor) {
    const workArea = Main.layoutManager.getWorkAreaForMonitor(monitor.index);
    this._overlay.set_position(workArea.x, workArea.y);
    this._overlay.set_size(workArea.width, workArea.height);

    this._box.set_width(WIDTH);
    this._box.set_x_expand(false);
    this._box.set_y_expand(false);
    this._box.set_x(Math.floor((workArea.width - WIDTH) / 2));
    this._box.set_y(Math.floor(workArea.height * TOP_OFFSET_RATIO));
  }

  _resetForOpen() {
    this._entry.set_text("");
    this.clearResults();
    this._isVisible = true;
    this._isHiding = false;
  }

  _animateOpen() {
    this._overlay.opacity = 0;
    this._overlay.ease({
      opacity: 255,
      duration: SHOW_ANIMATION_MS,
      mode: ANIMATION_MODE,
    });
    this._scaleBoxTo(HIDDEN_SCALE, HIDDEN_SCALE);
    this._box.ease({
      scale_x: 1.0,
      scale_y: 1.0,
      duration: SHOW_ANIMATION_MS,
      mode: ANIMATION_MODE,
    });
  }

  _animateBoxToHiddenScale() {
    this._scaleBoxTo(1.0, 1.0);
    this._box.ease({
      scale_x: HIDDEN_SCALE,
      scale_y: HIDDEN_SCALE,
      duration: HIDE_ANIMATION_MS,
      mode: ANIMATION_MODE,
    });
  }

  _scaleBoxTo(scaleX, scaleY) {
    this._box.set_pivot_point(0.5, 0.5);
    this._box.set_scale(scaleX, scaleY);
  }

  _refreshSelection(selectedIndex) {
    this._selectedIndex = selectedIndex;
    this._results.get_children().forEach((row, index) => {
      const isSelected = index === selectedIndex;
      row.set_style(this._selectionStyle(isSelected));
      if (isSelected) row.add_style_class_name("selected");
      else row.remove_style_class_name("selected");
    });
  }

  _selectionStyle(isSelected) {
    if (!isSelected) return null;
    const background = this._selectionColor || DEFAULT_SELECTION_COLOR;
    const color = this._selectionTextColor || DEFAULT_SELECTION_TEXT_COLOR;
    return `background-color: ${background}; color: ${color};`;
  }

  _cancelDestroyIdle() {
    if (!this._destroyIdleId) return;
    GLib.Source.remove(this._destroyIdleId);
    this._destroyIdleId = 0;
  }

  _emit(event, ...args) {
    if (!this._isVisible) return;

    const handler = this.handlers[`on${event}`];
    if (handler) handler(...args);
  }
}
