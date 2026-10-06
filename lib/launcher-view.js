/*
 * Lightning Search Launcher, launcher view
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";

import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { RowScroller } from "./row-scroll.js";
import { Scrollbar } from "./scrollbar.js";

const WIDTH = 540;
const MIN_WIDTH = 320;
const TOP_OFFSET_RATIO = 0.3;
const SIDE_MARGIN = 16;
const BOTTOM_MARGIN = 24;
const MIN_RESULTS_HEIGHT = 120;

const DEFAULT_PLACEHOLDER = "Search";
const DEFAULT_ENTRY_ICON_SIZE = 21;
const DEFAULT_SELECTION_COLOR = "rgba(0, 122, 255, 0.9)";
const DEFAULT_SELECTION_TEXT_COLOR = "white";

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
    this._entryRow = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._entryIconVisible = true;
    this._entryIconSize = DEFAULT_ENTRY_ICON_SIZE;
    this._results = null;
    this._scroll = null;
    this._resultsArea = null;
    this._resultsWrapper = null;
    this._scrollbar = null;
    this._rowScroller = null;
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
    if (!this._entryIcon) return;
    this._entryIcon.set_style(
      `height: ${this._entryIconSize}px; width: ${this._entryIconSize}px;`,
    );
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

    this._buildOverlay();
    this._buildEntryRow();
    this._buildResultsArea();
    this._connectSignals();
    Main.layoutManager.addTopChrome(this._overlay, { affectsStruts: false });
  }

  destroy() {
    if (this._overlay) this._removeActors();
    this._scrollbar?.destroy();
    this._rowScroller?.destroy();
    this._overlay = null;
    this._box = null;
    this._entryRow = null;
    this._entry = null;
    this._entryIcon = null;
    this._entryIconBox = null;
    this._results = null;
    this._scroll = null;
    this._resultsArea = null;
    this._resultsWrapper = null;
    this._scrollbar = null;
    this._rowScroller = null;
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

  renderResults(items, rowIdentities, { selectedIndex, buildRowAt }) {
    if (!this._results) return;
    if (items.length === 0) {
      this.clearResults();
      return;
    }

    const signature = rowIdentities.join("\u0001");
    if (signature !== this._paintedSignature) {
      this._paintedSignature = signature;
      this._rowScroller?.clear();
      this._results.destroy_all_children();
      items.forEach((item, index) =>
        this._results.add_child(buildRowAt(index, item)),
      );
    }

    this._showResults();
    this._updateResultsHeight();
    this._refreshSelection(selectedIndex);
  }

  setSelection(selectedIndex) {
    this._refreshSelection(selectedIndex);
  }

  clearResults() {
    this._paintedSignature = null;
    this._selectedIndex = -1;
    this._rowScroller?.clear();
    if (!this._results) return;
    this._results.destroy_all_children();
    this._scroll.hide();
    if (this._resultsWrapper) this._resultsWrapper.set_height(-1);
    this._scroll.set_height(-1);
    if (this._resultsArea) {
      this._resultsArea.set_height(-1);
      this._resultsArea.hide();
    }
    this._scrollbar?.clear();
    this._invalidateShadow();
  }

  _buildOverlay() {
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

    this._overlay.add_child(this._box);
  }

  _buildEntryRow() {
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
    });
    this._entryIcon = new St.Icon({
      icon_name: "system-search-symbolic",
      style_class: "lightning-entry-icon",
      icon_size: 30,
      opacity: 199,
      style: `height: ${this._entryIconSize}px; width: ${this._entryIconSize}px;`,
    });
    this._entryIconBox.add_child(this._entryIcon);
    entryRow.add_child(this._entryIconBox);

    this._entry = new St.Entry({
      hint_text: this._placeholderText,
      can_focus: true,
      x_expand: true,
      y_expand: true,
      style_class: "lightning-entry",
    });
    entryRow.add_child(this._entry);
    this._entryRow = entryRow;

    this._box.add_child(entryRow);
  }

  _buildResultsArea() {
    this._results = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      style_class: "lightning-results",
    });
    this._resultsWrapper = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      x_expand: true,
      y_align: Clutter.ActorAlign.START,
      style_class: "lightning-results-wrapper",
    });
    this._resultsWrapper.add_child(this._results);

    this._scroll = new St.ScrollView({
      x_expand: true,
      y_expand: false,
      y_align: Clutter.ActorAlign.START,
      reactive: true,
      style_class: "lightning-results-scroll",
      hscrollbar_policy: St.PolicyType.NEVER,
      vscrollbar_policy: St.PolicyType.AUTOMATIC,
      overlay_scrollbars: true,
      visible: false,
    });
    this._scroll.add_child(this._resultsWrapper);
    const nativeScrollbar = this._findVerticalScrollbar();
    if (nativeScrollbar) nativeScrollbar.hide();

    this._resultsArea = new St.Widget({
      x_expand: true,
      y_expand: false,
      visible: false,
      layout_manager: new Clutter.BinLayout(),
      style_class: "lightning-results-area",
    });
    this._resultsArea.add_child(this._scroll);

    this._scrollbar = new Scrollbar({
      scrollView: this._scroll,
      host: this._resultsArea,
      resultsWrapper: this._resultsWrapper,
      results: this._results,
      onLayoutChanged: () => this._rowScroller?.reschedule(),
    });
    this._scrollbar.build();

    this._rowScroller = new RowScroller(this._scroll);

    this._box.add_child(this._resultsArea);
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
          this._emit(Event.ACTIVATION_REQUESTED, "default"),
        ),
      },
      {
        actor: clutterText,
        id: clutterText.connect("key-press-event", (_actor, event) =>
          this._onEntryKeyPress(event),
        ),
      },
      ...this._scrollbar.signals(),
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

  // --- results presentation ----------------------------------------------

  _showResults() {
    if (this._resultsArea) this._resultsArea.show();
    if (this._scroll) this._scroll.show();
  }

  _invalidateShadow() {
    if (!this._overlay) return;
    global.stage.queue_redraw();
  }

  _updateResultsHeight() {
    if (!this._scroll || !this._results) return;
    this._scroll.set_height(-1);
    if (this._resultsWrapper) this._resultsWrapper.set_height(-1);
    if (this._resultsArea) this._resultsArea.set_height(-1);
    if (!this._results.get_n_children()) {
      this._scrollbar?.scheduleUpdate();
      return;
    }

    const [, natural] = this._scroll.get_preferred_height(this._boxWidth);
    const max = this._maxResultsHeight();
    const height = Math.min(natural, max);
    this._scroll.set_height(height);
    // Give the area an explicit height too. Measuring its preferred size here
    // is unreliable while it is hidden: the cached value can be reused for a
    // frame, flashing the previous (larger) results height when a new query is
    // typed. Deriving it from the scroll height plus the area's own
    // border/padding keeps the first layout correct.
    if (this._resultsArea) {
      const themeNode = this._resultsArea.get_theme_node();
      const borderAndPadding =
        themeNode.get_vertical_padding() +
        themeNode.get_border_width(St.Side.TOP) +
        themeNode.get_border_width(St.Side.BOTTOM);
      this._resultsArea.set_height(height + borderAndPadding);
    }
    this._scrollbar?.scheduleUpdate();
  }

  _refreshSelection(selectedIndex) {
    this._selectedIndex = selectedIndex;
    this._results.get_children().forEach((row, index) => {
      if (index === selectedIndex) {
        const geometry = row.has_allocation()
          ? { top: row.get_y(), height: row.get_height() }
          : null;
        row.set_style(this._selectionStyle(true));
        row.add_style_class_name("selected");
        this._rowScroller?.scrollIntoView(row, geometry);
      } else if (row.has_style_class_name("selected")) {
        row.set_style(this._selectionStyle(false));
        row.remove_style_class_name("selected");
      }
    });
  }

  _selectionStyle(isSelected) {
    if (!isSelected) return null;
    const background = this._selectionColor || DEFAULT_SELECTION_COLOR;
    const color = this._selectionTextColor || DEFAULT_SELECTION_TEXT_COLOR;
    return `background-color: ${background}; color: ${color};`;
  }

  // --- placement and animation -------------------------------------------

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

  // --- input --------------------------------------------------------------

  _removeActors() {
    this._rowScroller?.clear();
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
        `[Lightning Search Launcher] Failed to remove overlay: ${error.message}`,
      );
    }
  }

  _onEntryKeyPress(event) {
    const symbol = event.get_key_symbol();
    const state = event.get_state();

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
    if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
      if (state & Clutter.ModifierType.CONTROL_MASK) {
        this._emit(Event.ACTIVATION_REQUESTED, "secondary");
        return Clutter.EVENT_STOP;
      }
      if (state & Clutter.ModifierType.MOD1_MASK) {
        this._emit(Event.ACTIVATION_REQUESTED, "properties");
        return Clutter.EVENT_STOP;
      }
    }
    if (
      symbol === Clutter.KEY_c &&
      state & Clutter.ModifierType.CONTROL_MASK &&
      !(
        state &
        (Clutter.ModifierType.MOD1_MASK | Clutter.ModifierType.SHIFT_MASK)
      ) &&
      !this._entryHasSelection()
    ) {
      this._emit(Event.ACTIVATION_REQUESTED, "copy");
      return Clutter.EVENT_STOP;
    }
    return Clutter.EVENT_PROPAGATE;
  }

  _entryHasSelection() {
    try {
      return (this._entry.clutter_text.get_selection() || "").length > 0;
    } catch (_error) {
      return false;
    }
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

  _emit(event, ...args) {
    if (!this._isVisible) return;

    const handler = this.handlers[`on${event}`];
    if (handler) handler(...args);
  }
}
