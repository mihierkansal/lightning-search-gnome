/*
 * Lightning Search Launcher, launcher view
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

import { clearBrowserIconCache } from "./browser-icon.js";
import { RowScroller } from "./row-scroll.js";
import { Scrollbar } from "./scrollbar.js";
import { addRowIcons, rowIconItems } from "./ui.js";

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

/** How many row icons at a time to ask the texture cache for while warming up. */
const ICON_WARMUP_CHUNK = 12;
/** How often to look for the warmed icons that have arrived. */
const ICON_READY_TICK_MS = 120;
/** Give up waiting on icons that are not coming after this long. */
const ICON_READY_TIMEOUT_MS = 2500;
const ANIMATION_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;
const HIDDEN_SCALE = 1.02;

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
    this._iconWarmupId = 0;
    this._iconReadyId = 0;
    this._iconHolders = null;
    this._iconWarmed = false;
    this._selectionColor = "";
    this._selectionTextColor = "";
    this._resultsHeight = 0;
    this._contentHeight = 0;
    this._measuredSignature = null;
    this._measuredContentWidth = 0;
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
    this._clearIconTimers();
    this._iconHolders = null;
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

  renderResults(items, rowIdentities, { selectedIndex, buildRow }) {
    if (!this._results) return;
    if (items.length === 0) {
      this.clearResults();
      return;
    }

    const signature = rowIdentities.join("\u0001");
    if (signature !== this._paintedSignature) {
      this._paintedSignature = signature;
      this._repaintRows(items, rowIdentities, buildRow);
    }

    this._showResults();
    this._updateResultsHeight();
    this._refreshSelection(selectedIndex);
  }

  _repaintRows(items, rowIdentities, buildRow) {
    this._rowScroller?.clear();

    const children = this._results.get_children();
    items.forEach((item, index) => {
      const existing = children[index];
      if (existing && existing.updateItem?.(item)) {
        existing._rowIdentity = rowIdentities[index];
        return;
      }

      const row = buildRow(item);
      row._rowIdentity = rowIdentities[index];
      if (existing) {
        this._results.remove_child(existing);
        existing.destroy();
      }
      this._results.insert_child_at_index(row, index);
    });

    for (let index = items.length; index < children.length; index++)
      children[index].destroy();
  }

  warmIcons(apps) {
    if (this._iconWarmed || !this._overlay || !this._isVisible) return;
    this._iconWarmed = true;

    const colors = [
      null,
      this._selectionTextColor || DEFAULT_SELECTION_TEXT_COLOR,
    ];
    this._iconHolders = colors.map((color) => {
      const holder = new St.Widget({
        opacity: 0, // mapped, so the icons load; never painted
        x_expand: false,
        y_expand: false,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
      });
      if (color) holder.set_style(`color: ${color};`);
      this._overlay.add_child(holder);
      return holder;
    });

    const items = rowIconItems(apps);
    let next = 0;
    this._iconWarmupId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
      const chunk = items.slice(next, next + ICON_WARMUP_CHUNK);
      next += chunk.length;
      for (const holder of this._iconHolders ?? []) addRowIcons(holder, chunk);
      if (next < items.length) return GLib.SOURCE_CONTINUE;
      this._iconWarmupId = 0;
      this._releaseIconsWhenLoaded();
      return GLib.SOURCE_REMOVE;
    });
  }

  _releaseIconsWhenLoaded() {
    const deadline = Date.now() + ICON_READY_TIMEOUT_MS;
    this._iconReadyId = GLib.timeout_add(
      GLib.PRIORITY_LOW,
      ICON_READY_TICK_MS,
      () => {
        const holders = this._iconHolders ?? [];
        const waiting = holders.some((holder) =>
          holder.get_children().some((icon) => icon.get_n_children() === 0),
        );
        if (waiting && Date.now() < deadline) return GLib.SOURCE_CONTINUE;

        if (holders.some((holder) => !holder.is_mapped()))
          this._iconWarmed = false;

        this._iconReadyId = 0;
        for (const holder of holders) holder.destroy();
        this._iconHolders = null;
        return GLib.SOURCE_REMOVE;
      },
    );
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
    this._resultsHeight = 0;
    this._contentHeight = 0;
    this._measuredSignature = null;
    this._measuredContentWidth = 0;
    this._scroll.set_height(0);
    if (this._resultsArea) {
      this._resultsArea.set_height(0);
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
      style_class:
        "lightning-search-box popup-menu-content bms-redraw-blur-instant",
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
      contentHeight: () => this._contentHeight,
      targetHeight: () => this._resultsHeight,
      onLayoutChanged: () => this._rowScroller?.reschedule(),
    });
    this._scrollbar.build();

    this._rowScroller = new RowScroller(this._scroll, {
      requestedHeight: () => this._resultsHeight,
    });

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

    if (!this._results.get_n_children()) {
      this._resultsHeight = 0;
      this._contentHeight = 0;
      this._scroll.set_height(0);
      this._resultsArea?.set_height(0);
      this._scrollbar?.scheduleUpdate();
      return;
    }

    const contentWidth = this._resultsContentWidth();
    if (
      this._measuredSignature === this._paintedSignature &&
      this._measuredContentWidth === contentWidth
    )
      return;

    const [, natural] = this._resultsWrapper.get_preferred_height(contentWidth);
    this._contentHeight = natural;
    this._measuredSignature = this._paintedSignature;
    this._measuredContentWidth = contentWidth;
    const max = this._maxResultsHeight();
    const height = Math.min(natural, max);

    let areaHeight = height;
    if (this._resultsArea) {
      const themeNode = this._resultsArea.get_theme_node();
      areaHeight +=
        themeNode.get_vertical_padding() +
        themeNode.get_border_width(St.Side.TOP) +
        themeNode.get_border_width(St.Side.BOTTOM);
    }

    this._applyResultsHeight(height, areaHeight);
  }

  _applyResultsHeight(height, areaHeight) {
    const scrollHeight = Math.round(height);
    const areaHeightPx = Math.round(areaHeight);
    this._resultsHeight = scrollHeight;

    if (
      this._scroll.get_height() === scrollHeight &&
      (this._resultsArea?.get_height() ?? 0) === areaHeightPx
    )
      return;

    this._scroll.set_height(scrollHeight);
    this._resultsArea?.set_height(areaHeightPx);
    this._scrollbar?.update();
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

  _resultsContentWidth() {
    const themeNode = this._box?.get_theme_node();
    if (!themeNode) return this._boxWidth;
    const horizontal =
      themeNode.get_horizontal_padding() +
      themeNode.get_border_width(St.Side.LEFT) +
      themeNode.get_border_width(St.Side.RIGHT);
    return Math.max(1, this._boxWidth - horizontal);
  }

  _maxResultsHeight() {
    if (!this._workArea) return Infinity;
    const available =
      this._workArea.height - this._box.y - this._entryHeight() - BOTTOM_MARGIN;
    return Math.max(0, available);
  }

  _resetForOpen() {
    clearBrowserIconCache();
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

  _clearIconTimers() {
    for (const field of ["_iconWarmupId", "_iconReadyId"]) {
      if (!this[field]) continue;
      GLib.Source.remove(this[field]);
      this[field] = 0;
    }
  }

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
