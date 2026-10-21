/*
 * Lightning Search Launcher, results scrollbar
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import St from "gi://St";

const TRACK_WIDTH = 12;
const THUMB_WIDTH = 4;
const THUMB_WIDTH_HOVER = 8;
const MIN_THUMB_HEIGHT = 24;
const VERTICAL_INSET = 6;
const OVERFLOW_TOLERANCE = 1;
const SCROLLABLE_CLASS = "lightning-results-scrollable";

export class Scrollbar {
  /**
   * @param {St.ScrollView} scrollView the scrolled results view
   * @param {St.Widget} host container the track is added to (the results area)
   * @param {St.Widget} resultsWrapper scrolled content wrapper
   * @param {St.Widget} [results] rows container kept clear of the track
   * @param {() => number} [contentHeight] settled height of the results content
   * @param {() => number} [targetHeight] height the launcher asked the viewport to take
   * @param {() => void} onLayoutChanged called when the scroll range changes
   */
  constructor({
    scrollView,
    host,
    resultsWrapper,
    results,
    contentHeight,
    targetHeight,
    onLayoutChanged,
  }) {
    this._scroll = scrollView;
    this._host = host;
    this._resultsWrapper = resultsWrapper;
    this._results = results;
    this._contentHeight = contentHeight;
    this._targetHeight = targetHeight;
    this._onLayoutChanged = onLayoutChanged;

    this._track = null;
    this._thumb = null;
    this._visible = false;
    this._hovered = false;
    this._dragging = false;
    this._dragStartY = 0;
    this._dragStartValue = 0;
    this._dragMetrics = null;
    this._updateId = 0;
  }

  build() {
    this._track = new St.Widget({
      reactive: true,
      track_hover: true,
      visible: false,
      x_expand: true,
      y_expand: true,
      x_align: Clutter.ActorAlign.END,
      y_align: Clutter.ActorAlign.FILL,
      style_class: "lightning-scroll-track",
      style: `width: ${TRACK_WIDTH}px;`,
    });
    this._thumb = new St.Widget({
      style_class: "lightning-scroll-thumb",
    });
    this._track.add_child(this._thumb);
    this._host.add_child(this._track);
  }

  signals() {
    return [...this._trackSignals(), ...this._adjustmentSignals()];
  }

  clear() {
    this._dragging = false;
    this._dragMetrics = null;
    this._hovered = false;
    this._setTrackVisible(false);
    if (!this._track) return;
    this._track.remove_style_class_name("hovered");
  }

  destroy() {
    if (this._updateId) {
      try {
        GLib.source_remove(this._updateId);
      } catch (_error) {}
      this._updateId = 0;
    }
    // The results actors may already be gone; only touch the track here.
    this._visible = false;
    this._results = null;
    if (this._track) this._track.hide();
    this._track = null;
    this._thumb = null;
    this._dragMetrics = null;
  }

  scheduleUpdate() {
    if (this._updateId) return;
    this._updateId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
      this._updateId = 0;
      this.update();
      return GLib.SOURCE_REMOVE;
    });
  }

  update() {
    if (!this._track || !this._thumb || !this._scroll) return;

    if (!this._scroll.is_visible() || this._scroll.get_height() <= 0) {
      this._setTrackVisible(false);
      return;
    }

    const adjustment = this._scroll.get_vadjustment();
    if (!adjustment) return;
    if (this._dragging) {
      this._positionThumbDuringDrag(adjustment.get_value());
      return;
    }

    const { upper, pageSize } = this._scrollRange(adjustment);
    const contentHeight = this._contentHeight?.() ?? upper;
    const targetHeight = this._targetHeight?.() ?? pageSize;
    if (contentHeight <= targetHeight + OVERFLOW_TOLERANCE) {
      this._setTrackVisible(false);
      return;
    }

    const { inset, usable } = this._metrics();
    if (usable <= 0) return;
    const trackWidth = this._track.get_width() || TRACK_WIDTH;
    this._setTrackVisible(true);

    const thumbWidth = this._hovered ? THUMB_WIDTH_HOVER : THUMB_WIDTH;
    const thumbHeight = Math.min(
      usable,
      Math.max(
        MIN_THUMB_HEIGHT,
        Math.round(
          usable * Math.min(1, targetHeight / Math.max(1, contentHeight)),
        ),
      ),
    );
    const maxThumbY = Math.max(0, usable - thumbHeight);
    const maxValue = Math.max(0, upper - pageSize);
    const fraction =
      maxValue > 0
        ? Math.min(1, Math.max(0, adjustment.get_value() / maxValue))
        : 0;

    this._thumb.set_position(
      Math.round((trackWidth - thumbWidth) / 2),
      Math.round(inset + maxThumbY * fraction),
    );
    this._thumb.set_size(thumbWidth, thumbHeight);
  }

  _setTrackVisible(visible) {
    if (this._visible === visible) return;
    this._visible = visible;
    if (this._track) {
      if (visible) this._track.show();
      else this._track.hide();
    }
    if (!this._results) return;
    if (visible) this._results.add_style_class_name(SCROLLABLE_CLASS);
    else this._results.remove_style_class_name(SCROLLABLE_CLASS);
  }

  _scrollRange(adjustment) {
    return {
      upper: adjustment.get_upper(),
      pageSize: adjustment.get_page_size(),
    };
  }

  _trackSignals() {
    if (!this._track) return [];
    return [
      {
        actor: this._track,
        id: this._track.connect("enter-event", () => {
          if (this._dragging) return Clutter.EVENT_PROPAGATE;
          this._setHovered(true);
          this.update();
          return Clutter.EVENT_PROPAGATE;
        }),
      },
      {
        actor: this._track,
        id: this._track.connect("leave-event", () => {
          if (this._dragging) return Clutter.EVENT_PROPAGATE;
          this._setHovered(false);
          this.update();
          return Clutter.EVENT_PROPAGATE;
        }),
      },
      {
        actor: this._track,
        id: this._track.connect("button-press-event", (_actor, event) =>
          this._onTrackPress(event),
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

    const update = () => this.scheduleUpdate();
    const relayout = () => {
      this.scheduleUpdate();
      if (this._onLayoutChanged) this._onLayoutChanged();
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
    if (this._host) {
      signals.push({
        actor: this._host,
        id: this._host.connect("notify::height", update),
      });
      signals.push({
        actor: this._host,
        id: this._host.connect("notify::allocation", update),
      });
    }
    if (this._track) {
      signals.push({
        actor: this._track,
        id: this._track.connect("notify::height", update),
      });
      signals.push({
        actor: this._track,
        id: this._track.connect("notify::width", update),
      });
    }
    return signals;
  }

  _onTrackPress(event) {
    if (event.get_button() !== 1 || !this._scroll)
      return Clutter.EVENT_PROPAGATE;
    if (this._track.get_height() <= 0) return Clutter.EVENT_PROPAGATE;

    const [, y] = event.get_coords();
    const adjustment = this._scroll.get_vadjustment();
    this._dragging = true;
    this._dragStartY = y;
    this._dragStartValue = adjustment.get_value();
    const { inset, usable } = this._metrics();
    const thumbHeight = this._thumb.get_height();
    const { upper, pageSize } = this._scrollRange(adjustment);
    this._dragMetrics = {
      inset,
      maxThumbY: Math.max(0, usable - thumbHeight),
      maxValue: Math.max(0, upper - pageSize),
      thumbWidth: THUMB_WIDTH_HOVER,
    };
    return Clutter.EVENT_STOP;
  }

  _onCapturedEvent(event) {
    if (!this._dragging) return Clutter.EVENT_PROPAGATE;

    const type = event.type();
    if (type === Clutter.EventType.MOTION) {
      this._onPointerMotion(event);
    } else if (type === Clutter.EventType.BUTTON_RELEASE) {
      this._dragging = false;
      this._dragMetrics = null;
      const [x, y] = event.get_coords();
      this._setHovered(this._isPointerOverTrack(x, y));
      this.update();
    }
    return Clutter.EVENT_PROPAGATE;
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
    const trackWidth = this._track.get_width() || TRACK_WIDTH;
    const fraction = Math.min(
      1,
      Math.max(0, value / Math.max(1, metrics.maxValue)),
    );
    this._thumb.set_position(
      Math.round((trackWidth - metrics.thumbWidth) / 2),
      Math.round(metrics.inset + metrics.maxThumbY * fraction),
    );
  }

  _metrics() {
    const viewport = this._scroll?.get_height() ?? 0;
    const trackHeight = viewport > 0 ? viewport : this._host?.get_height() || 0;
    const inset = VERTICAL_INSET;
    return { inset, usable: Math.max(0, trackHeight - inset * 2) };
  }

  _isPointerOverTrack(x, y) {
    if (!this._track) return false;
    const [trackX, trackY] = this._track.get_transformed_position();
    return (
      x >= trackX &&
      x <= trackX + this._track.get_width() &&
      y >= trackY &&
      y <= trackY + this._track.get_height()
    );
  }

  _setHovered(hovered) {
    if (this._hovered === hovered) return;
    this._hovered = hovered;
    if (!this._track) return;
    if (hovered) this._track.add_style_class_name("hovered");
    else this._track.remove_style_class_name("hovered");
  }
}
