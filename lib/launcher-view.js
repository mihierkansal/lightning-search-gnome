/*
 * Lightning Search, launcher view
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

const WIDTH = 600;
const MIN_WIDTH = 320;
const TOP_OFFSET_RATIO = 0.26;
const SIDE_MARGIN = 16;
const BOTTOM_MARGIN = 24;
const MIN_RESULTS_HEIGHT = 120;

const DEFAULT_PLACEHOLDER = "Search";
const DEFAULT_ENTRY_ICON_SIZE = 21;
const DEFAULT_SELECTION_COLOR = "rgba(0, 122, 255, 0.9)";
const DEFAULT_SELECTION_TEXT_COLOR = "white";

function entryIconStyle(size) {
  return `height: ${size}px;`;
}

const SHOW_ANIMATION_MS = 160;
const HIDE_ANIMATION_MS = 140;
const SCROLLBAR_FADE_IN_MS = 120;
const SCROLLBAR_FADE_OUT_MS = 250;
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
    this._entryRow = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._entryIconVisible = true;
    this._entryIconSize = DEFAULT_ENTRY_ICON_SIZE;
    this._results = null;
    this._scroll = null;
    this._vscrollbar = null;
    this._signals = [];
    this._workArea = null;
    this._boxWidth = WIDTH;
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
    if (this._overlay) return;

    this._buildActors();
    this._connectSignals();
    Main.layoutManager.addTopChrome(this._overlay, { affectsStruts: false });
  }

  destroy() {
    if (this._overlay) this._removeActors();
    this._overlay = null;
    this._box = null;
    this._entryRow = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._results = null;
    this._scroll = null;
    this._vscrollbar = null;
    this._workArea = null;
    this._isVisible = false;
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

    this._scroll.show();
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
    this._updateResultsHeight();
  }

  setSelection(selectedIndex) {
    this._refreshSelection(selectedIndex);
  }

  clearResults() {
    this._paintedSignature = null;
    if (!this._results) return;
    this._results.destroy_all_children();
    this._scroll.hide();
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
    this._entryRow = entryRow;

    this._results = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      y_expand: false,
      style_class: "lightning-results",
    });
    this._scroll = new St.ScrollView({
      x_expand: true,
      y_expand: false,
      reactive: true,
      style_class: "lightning-results-scroll",
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      overlay_scrollbars: true,
      visible: false,
    });
    this._scroll.add_child(this._results);

    this._vscrollbar = this._findVerticalScrollbar();
    if (this._vscrollbar) this._vscrollbar.opacity = 0;

    this._box.add_child(entryRow);
    this._box.add_child(this._scroll);
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
          this._emit(Event.ACTIVATION_REQUESTED, "background"),
        ),
      },
      {
        actor: clutterText,
        id: clutterText.connect("key-press-event", (_actor, event) =>
          this._onEntryKeyPress(event),
        ),
      },
      {
        actor: this._scroll,
        id: this._scroll.connect("enter-event", () =>
          this._onResultsHover(true),
        ),
      },
      {
        actor: this._scroll,
        id: this._scroll.connect("leave-event", () =>
          this._onResultsHover(false),
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
  _findVerticalScrollbar() {
    const [vscrollbar] = this._scroll
      .get_children()
      .filter((child) => child instanceof St.ScrollBar)
      .filter(
        (scrollbar) => scrollbar.orientation === Clutter.Orientation.VERTICAL,
      );
    return vscrollbar || null;
  }

  _onResultsHover(hovered) {
    this._revealScrollbar(hovered);
    return Clutter.EVENT_PROPAGATE;
  }

  _revealScrollbar(revealed) {
    if (!this._vscrollbar) return;
    this._vscrollbar.ease({
      opacity: revealed ? 255 : 0,
      duration: revealed ? SCROLLBAR_FADE_IN_MS : SCROLLBAR_FADE_OUT_MS,
      mode: ANIMATION_MODE,
    });
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
      console.error(
        `[Lightning Search] Failed to remove overlay: ${error.message}`,
      );
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
    if (
      (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) &&
      event.get_state() & Clutter.ModifierType.SHIFT_MASK
    ) {
      this._emit(Event.ACTIVATION_REQUESTED, "terminal");
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
    this._workArea = workArea;
    this._overlay.set_position(workArea.x, workArea.y);
    this._overlay.set_size(workArea.width, workArea.height);

    this._boxWidth = Math.max(
      MIN_WIDTH,
      Math.min(WIDTH, workArea.width - SIDE_MARGIN * 2),
    );
    this._box.set_width(this._boxWidth);
    this._box.set_x_expand(false);
    this._box.set_y_expand(false);
    this._box.set_x(Math.floor((workArea.width - this._boxWidth) / 2));
    this._box.set_y(this._clampBoxTop(workArea));
  }

  _clampBoxTop(workArea) {
    const desired = Math.floor(workArea.height * TOP_OFFSET_RATIO);
    const reserved = this._entryHeight() + MIN_RESULTS_HEIGHT + BOTTOM_MARGIN;
    const latest = workArea.height - reserved;
    return Math.max(0, Math.min(desired, latest));
  }

  _entryHeight() {
    if (!this._entryRow) return 0;
    const [, natural] = this._entryRow.get_preferred_height(this._boxWidth);
    return natural;
  }

  _maxResultsHeight() {
    if (!this._workArea) return Infinity;
    const available =
      this._workArea.height - this._box.y - this._entryHeight() - BOTTOM_MARGIN;
    return Math.max(0, available);
  }

  _updateResultsHeight() {
    if (!this._scroll || !this._results) return;
    if (!this._results.get_n_children()) return;
    this._scroll.set_height(-1);
    const [, natural] = this._scroll.get_preferred_height(this._boxWidth);
    const max = this._maxResultsHeight();
    this._scroll.set_height(natural > max ? max : -1);
  }

  _resetForOpen() {
    this._entry.set_text("");
    this.clearResults();
    if (this._vscrollbar) this._vscrollbar.opacity = 0;
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
      if (isSelected) {
        row.add_style_class_name("selected");
        this._scrollRowIntoView(row);
      } else {
        row.remove_style_class_name("selected");
      }
    });
  }

  /* The results are clipped by the scroll view, so a row reached with the
   * keyboard may be outside the visible window. */
  _scrollRowIntoView(row) {
    const rowHeight = row.get_height();
    if (!this._scroll || rowHeight <= 0) return;

    const vadjustment = this._scroll.get_vadjustment();
    const pageSize = vadjustment.get_page_size();
    if (pageSize <= 0) return;

    const value = vadjustment.get_value();
    const rowTop = row.get_y();
    const rowBottom = rowTop + rowHeight;
    if (rowTop < value) vadjustment.set_value(rowTop);
    else if (rowBottom > value + pageSize)
      vadjustment.set_value(rowBottom - pageSize);
  }

  _selectionStyle(isSelected) {
    if (!isSelected) return null;
    const background = this._selectionColor || DEFAULT_SELECTION_COLOR;
    const color = this._selectionTextColor || DEFAULT_SELECTION_TEXT_COLOR;
    return `background-color: ${background}; color: ${color};`;
  }

  _emit(event, ...args) {
    if (!this._isVisible) return;

    const handler = this.handlers[`on${event}`];
    if (handler) handler(...args);
  }
}
