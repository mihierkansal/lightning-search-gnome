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

const SHOW_ANIMATION_MS = 160;
const HIDE_ANIMATION_MS = 140;
const ANIMATION_MODE = Clutter.AnimationMode.EASE_OUT_QUAD;
const HIDDEN_SCALE = 1.03;

const SCROLLBAR_THUMB_WIDTH = 4;
const SCROLLBAR_THUMB_WIDTH_HOVER = 8;
const SCROLLBAR_MIN_THUMB_HEIGHT = 24;
const SCROLLBAR_VERTICAL_INSET = 6;

const SCROLL_ROW_MARGIN = 6;
const MAX_SCROLL_RETRIES = 20;

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
    this._scrollTrack = null;
    this._scrollThumb = null;
    this._scrollbarHovered = false;
    this._resultsScrollable = null;
    this._draggingThumb = false;
    this._dragStartY = 0;
    this._dragStartValue = 0;
    this._dragMetrics = null;
    this._signals = [];
    this._pendingScrollRow = null;
    this._pendingRowGeometry = null;
    this._pendingRowHook = null;
    this._scrollRetryId = 0;
    this._scrollApplied = false;
    this._scrollRangeFresh = false;
    this._scrollRetryTimeoutId = 0;
    this._scrollRetryCount = 0;
    this._thumbUpdateId = 0;
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
    this._resultsArea = null;
    this._resultsWrapper = null;
    this._scrollTrack = null;
    this._scrollThumb = null;
    this._pendingScrollRow = null;
    this._pendingRowGeometry = null;
    this._pendingRowHook = null;
    this._scrollRetryId = 0;
    if (this._scrollRetryTimeoutId) {
      try {
        GLib.source_remove(this._scrollRetryTimeoutId);
      } catch (_error) {}
      this._scrollRetryTimeoutId = 0;
    }
    if (this._thumbUpdateId) {
      try {
        GLib.source_remove(this._thumbUpdateId);
      } catch (_error) {}
      this._thumbUpdateId = 0;
    }
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
    if (items.length === 0) {
      this.clearResults();
      return;
    }

    const signature = rowIdentities.join("\u0001");
    if (signature !== this._paintedSignature) {
      this._paintedSignature = signature;
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
    this._clearPendingScroll();
    this._draggingThumb = false;
    this._dragMetrics = null;
    if (!this._results) return;
    this._results.destroy_all_children();
    this._scroll.hide();
    if (this._resultsWrapper) this._resultsWrapper.set_height(-1);
    this._scroll.set_height(-1);
    if (this._resultsArea) {
      this._resultsArea.set_height(-1);
      this._resultsArea.hide();
    }
    if (this._scrollTrack) {
      this._scrollTrack.hide();
      this._scrollTrack.remove_style_class_name("hovered");
    }
    this._setResultsScrollable(false);
    this._scrollbarHovered = false;
    this._invalidateShadow();
  }

  _showResults() {
    if (this._resultsArea) this._resultsArea.show();
    if (this._scroll) this._scroll.show();
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
    });
    this._entryIcon = new St.Icon({
      icon_name: "system-search-symbolic",
      style_class: "lightning-entry-icon",
      icon_size: 30,
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

    this._scrollTrack = new St.Widget({
      reactive: true,
      track_hover: true,
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.FILL,
      style_class: "lightning-scroll-track",
      style: "width: 12px;",
    });
    this._scrollThumb = new St.Widget({
      style_class: "lightning-scroll-thumb",
    });
    this._scrollTrack.add_child(this._scrollThumb);
    this._resultsArea.add_child(this._scrollTrack);

    this._box.add_child(entryRow);
    this._box.add_child(this._resultsArea);
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
      ...this._scrollbarSignals(),
      ...this._adjustmentSignals(),
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
  _scrollbarSignals() {
    if (!this._scrollTrack || !this._overlay) return [];
    return [
      {
        actor: this._scrollTrack,
        id: this._scrollTrack.connect("enter-event", () => {
          if (this._draggingThumb) return Clutter.EVENT_PROPAGATE;
          this._setScrollbarHovered(true);
          this._updateScrollThumb();
          return Clutter.EVENT_PROPAGATE;
        }),
      },
      {
        actor: this._scrollTrack,
        id: this._scrollTrack.connect("leave-event", () => {
          if (this._draggingThumb) return Clutter.EVENT_PROPAGATE;
          this._setScrollbarHovered(false);
          this._updateScrollThumb();
          return Clutter.EVENT_PROPAGATE;
        }),
      },
      {
        actor: this._scrollTrack,
        id: this._scrollTrack.connect("button-press-event", (_actor, event) =>
          this._onScrollbarPress(event),
        ),
      },
      {
        actor: global.stage,
        id: global.stage.connect("captured-event", (_actor, event) =>
          this._onCapturedEvent(event),
        ),
      },
    ];
  }

  _adjustmentSignals() {
    if (!this._scroll) return [];
    const adjustment = this._scroll.get_vadjustment();
    if (!adjustment) return [];

    const update = () => this._scheduleThumbUpdate();
    const relayout = () => {
      this._scheduleThumbUpdate();
      this._reschedulePendingRowScroll();
    };
    const signals = [
      { actor: adjustment, id: adjustment.connect("notify::value", update) },
      { actor: adjustment, id: adjustment.connect("notify::upper", relayout) },
      {
        actor: adjustment,
        id: adjustment.connect("notify::page-size", relayout),
      },
      {
        actor: this._scroll,
        id: this._scroll.connect("notify::height", update),
      },
      {
        actor: this._scroll,
        id: this._scroll.connect("notify::allocation", update),
      },
    ];
    if (this._resultsWrapper) {
      signals.push({
        actor: this._resultsWrapper,
        id: this._resultsWrapper.connect("notify::allocation", update),
      });
    }
    if (this._resultsArea) {
      signals.push({
        actor: this._resultsArea,
        id: this._resultsArea.connect("notify::height", update),
      });
      signals.push({
        actor: this._resultsArea,
        id: this._resultsArea.connect("notify::allocation", update),
      });
    }
    if (this._scrollTrack) {
      signals.push({
        actor: this._scrollTrack,
        id: this._scrollTrack.connect("notify::height", update),
      });
      signals.push({
        actor: this._scrollTrack,
        id: this._scrollTrack.connect("notify::width", update),
      });
    }
    return signals;
  }

  _onScrollbarPress(event) {
    if (event.get_button() !== 1 || !this._scroll)
      return Clutter.EVENT_PROPAGATE;
    if (this._scrollTrack.get_height() <= 0) return Clutter.EVENT_PROPAGATE;

    const [, y] = event.get_coords();
    const adjustment = this._scroll.get_vadjustment();
    this._draggingThumb = true;
    this._dragStartY = y;
    this._dragStartValue = adjustment.get_value();
    const { inset, usable } = this._scrollbarMetrics();
    const thumbHeight = this._scrollThumb.get_height();
    this._dragMetrics = {
      inset,
      maxThumbY: Math.max(0, usable - thumbHeight),
      maxValue: Math.max(
        0,
        adjustment.get_upper() - adjustment.get_page_size(),
      ),
      thumbWidth: SCROLLBAR_THUMB_WIDTH_HOVER,
    };
    return Clutter.EVENT_STOP;
  }

  _onCapturedEvent(event) {
    if (!this._draggingThumb) return Clutter.EVENT_PROPAGATE;

    const type = event.type();
    if (type === Clutter.EventType.MOTION) {
      this._onPointerMotion(event);
    } else if (type === Clutter.EventType.BUTTON_RELEASE) {
      this._draggingThumb = false;
      this._dragMetrics = null;
      const [x, y] = event.get_coords();
      this._setScrollbarHovered(this._isPointerOverTrack(x, y));
      this._updateScrollThumb();
    }
    return Clutter.EVENT_PROPAGATE;
  }

  _isPointerOverTrack(x, y) {
    if (!this._scrollTrack) return false;
    const [trackX, trackY] = this._scrollTrack.get_transformed_position();
    return (
      x >= trackX &&
      x <= trackX + this._scrollTrack.get_width() &&
      y >= trackY &&
      y <= trackY + this._scrollTrack.get_height()
    );
  }

  _setScrollbarHovered(hovered) {
    if (this._scrollbarHovered === hovered) return;
    this._scrollbarHovered = hovered;
    if (!this._scrollTrack) return;
    if (hovered) this._scrollTrack.add_style_class_name("hovered");
    else this._scrollTrack.remove_style_class_name("hovered");
  }

  _onPointerMotion(event) {
    if (!this._scroll || !this._dragMetrics) return;

    const { maxThumbY, maxValue } = this._dragMetrics;
    if (maxThumbY <= 0 || maxValue <= 0) return;

    const [, y] = event.get_coords();
    const value =
      this._dragStartValue + ((y - this._dragStartY) / maxThumbY) * maxValue;
    const clamped = Math.min(maxValue, Math.max(0, value));
    this._scroll.get_vadjustment().set_value(clamped);
    this._positionThumbDuringDrag(clamped);
  }

  _positionThumbDuringDrag(value) {
    const metrics = this._dragMetrics;
    if (!metrics || metrics.maxThumbY <= 0) return;
    const trackWidth = this._scrollTrack.get_width() || 12;
    const fraction = Math.min(
      1,
      Math.max(0, value / Math.max(1, metrics.maxValue)),
    );
    this._scrollThumb.set_position(
      Math.round((trackWidth - metrics.thumbWidth) / 2),
      Math.round(metrics.inset + metrics.maxThumbY * fraction),
    );
  }

  _scrollbarMetrics() {
    const trackHeight = this._scrollTrack
      ? this._scrollTrack.get_height() || this._resultsArea.get_height()
      : 0;
    const inset = SCROLLBAR_VERTICAL_INSET;
    return { inset, usable: Math.max(0, trackHeight - inset * 2) };
  }

  _scheduleThumbUpdate() {
    if (this._thumbUpdateId) return;
    this._thumbUpdateId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
      this._thumbUpdateId = 0;
      this._updateScrollThumb();
      return GLib.SOURCE_REMOVE;
    });
  }
  _updateScrollThumb() {
    if (!this._scrollTrack || !this._scrollThumb || !this._scroll) return;

    const adjustment = this._scroll.get_vadjustment();
    if (!adjustment) return;
    if (this._draggingThumb) {
      this._positionThumbDuringDrag(adjustment.get_value());
      return;
    }

    const { inset, usable } = this._scrollbarMetrics();
    if (usable <= 0) return;
    const trackWidth = this._scrollTrack.get_width() || 12;

    const upper = adjustment.get_upper();
    const pageSize = adjustment.get_page_size();
    if (upper <= pageSize + 0.5) {
      this._scrollTrack.hide();
      this._setResultsScrollable(false);
      return;
    }
    this._scrollTrack.show();
    this._setResultsScrollable(true);

    const thumbWidth = this._scrollbarHovered
      ? SCROLLBAR_THUMB_WIDTH_HOVER
      : SCROLLBAR_THUMB_WIDTH;
    const thumbHeight = Math.min(
      usable,
      Math.max(
        SCROLLBAR_MIN_THUMB_HEIGHT,
        Math.round(usable * Math.min(1, pageSize / upper)),
      ),
    );
    const maxThumbY = Math.max(0, usable - thumbHeight);
    const maxValue = Math.max(1, upper - pageSize);
    const fraction = Math.min(
      1,
      Math.max(0, adjustment.get_value() / maxValue),
    );

    this._scrollThumb.set_position(
      Math.round((trackWidth - thumbWidth) / 2),
      Math.round(inset + maxThumbY * fraction),
    );
    this._scrollThumb.set_size(thumbWidth, thumbHeight);
  }
  _setResultsScrollable(scrollable) {
    if (!this._results) return;
    if (this._resultsScrollable === scrollable) return;
    this._resultsScrollable = scrollable;
    if (scrollable)
      this._results.add_style_class_name("lightning-results-scrollable");
    else this._results.remove_style_class_name("lightning-results-scrollable");
  }

  _removeActors() {
    this._clearPendingScroll();
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
    this._scroll.set_height(-1);
    if (this._resultsWrapper) this._resultsWrapper.set_height(-1);
    if (this._resultsArea) this._resultsArea.set_height(-1);
    if (!this._results.get_n_children()) {
      this._scheduleThumbUpdate();
      return;
    }

    const [, natural] = this._scroll.get_preferred_height(this._boxWidth);
    const max = this._maxResultsHeight();
    if (natural > max) this._scroll.set_height(max);
    this._scheduleThumbUpdate();
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
      if (index === selectedIndex) {
        const geometry = row.has_allocation()
          ? { top: row.get_y(), height: row.get_height() }
          : null;
        row.set_style(this._selectionStyle(true));
        row.add_style_class_name("selected");
        this._scrollRowIntoView(row, geometry);
      } else if (row.has_style_class_name("selected")) {
        row.set_style(this._selectionStyle(false));
        row.remove_style_class_name("selected");
      }
    });
  }

  _scrollRowIntoView(row, geometry) {
    if (!this._scroll || !row) return;

    if (this._pendingScrollRow !== row) {
      this._clearPendingScroll();
      this._pendingScrollRow = row;
      this._pendingRowGeometry = geometry || null;
      this._scrollRetryCount = 0;
      try {
        this._pendingRowHook = [
          row,
          row.connect("notify::allocation", () => this._scheduleRowScroll(row)),
        ];
      } catch (_error) {
        this._pendingRowHook = null;
      }
    }

    this._scheduleRowScroll(row);
  }

  _scheduleRowScroll(row) {
    if (this._scrollRetryId || row !== this._pendingScrollRow) return;
    this._scrollRetryId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._scrollRetryId = 0;
      if (!this._applyRowScroll(row)) this._scheduleRowScrollRetry(row);
      return GLib.SOURCE_REMOVE;
    });
  }

  _scheduleRowScrollRetry(row) {
    if (this._scrollRetryTimeoutId || row !== this._pendingScrollRow) return;
    if (this._scrollRetryCount >= MAX_SCROLL_RETRIES) return;
    this._scrollRetryCount++;
    this._scrollRetryTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      16,
      () => {
        this._scrollRetryTimeoutId = 0;
        this._scheduleRowScroll(row);
        return GLib.SOURCE_REMOVE;
      },
    );
  }
  _reschedulePendingRowScroll() {
    if (!this._pendingScrollRow) return;
    this._scrollRangeFresh = true;
    this._scheduleRowScroll(this._pendingScrollRow);
  }

  _disconnectPendingRowHook() {
    if (!this._pendingRowHook) return;
    const [actor, id] = this._pendingRowHook;
    this._pendingRowHook = null;
    try {
      actor.disconnect(id);
    } catch (_error) {}
  }

  _clearPendingScroll() {
    this._pendingScrollRow = null;
    this._pendingRowGeometry = null;
    this._scrollApplied = false;
    this._scrollRangeFresh = false;
    this._scrollRetryCount = 0;
    this._disconnectPendingRowHook();
    if (this._scrollRetryId) {
      try {
        GLib.source_remove(this._scrollRetryId);
      } catch (_error) {}
      this._scrollRetryId = 0;
    }
    if (this._scrollRetryTimeoutId) {
      try {
        GLib.source_remove(this._scrollRetryTimeoutId);
      } catch (_error) {}
      this._scrollRetryTimeoutId = 0;
    }
  }

  _applyRowScroll(row) {
    if (!row || row !== this._pendingScrollRow || !row.get_parent())
      return true;
    if (!this._scroll) return true;

    const adjustment = this._scroll.get_vadjustment();
    const pageSize = adjustment ? adjustment.get_page_size() : 0;
    if (!adjustment || pageSize <= 0) return false;

    let rowTop;
    let rowHeight;
    if (this._pendingRowGeometry) {
      ({ top: rowTop, height: rowHeight } = this._pendingRowGeometry);
    } else {
      if (!row.has_allocation()) return false;
      rowTop = row.get_y();
      rowHeight = row.get_height();
    }
    if (rowHeight <= 0) return false;

    const value = adjustment.get_value();
    const rowBottom = rowTop + rowHeight;
    const maxValue = Math.max(0, adjustment.get_upper() - pageSize);

    let target = value;
    if (rowTop - SCROLL_ROW_MARGIN < value) {
      target = rowTop - SCROLL_ROW_MARGIN;
    } else if (rowBottom + SCROLL_ROW_MARGIN > value + pageSize) {
      target = rowBottom + SCROLL_ROW_MARGIN - pageSize;
    }

    const clamped = Math.min(maxValue, Math.max(0, target));
    if (Math.abs(clamped - value) > 0.5) {
      this._scrollApplied = true;
      adjustment.set_value(clamped);
      this._scheduleRowScrollRetry(row);
      return true;
    }

    if (this._scrollApplied || this._scrollRangeFresh)
      this._clearPendingScroll();
    return true;
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
