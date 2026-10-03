/*
 * Lightning Search Launcher, selected row scrolling
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import GLib from "gi://GLib";

const SCROLL_ROW_MARGIN = 6;
const MAX_SCROLL_RETRIES = 20;
const RETRY_DELAY_MS = 16;

export class RowScroller {
  constructor(scrollView) {
    this._scroll = scrollView;
    this._pendingRow = null;
    this._pendingGeometry = null;
    this._pendingHook = null;
    this._retryId = 0;
    this._retryTimeoutId = 0;
    this._applied = false;
    this._rangeFresh = false;
    this._retryCount = 0;
  }

  scrollIntoView(row, geometry) {
    if (!this._scroll || !row) return;

    if (this._pendingRow !== row) {
      this.clear();
      this._pendingRow = row;
      this._pendingGeometry = geometry || null;
      this._retryCount = 0;
      try {
        this._pendingHook = [
          row,
          row.connect("notify::allocation", () => this._schedule(row)),
        ];
      } catch (_error) {
        this._pendingHook = null;
      }
    }

    this._schedule(row);
  }

  reschedule() {
    if (!this._pendingRow) return;
    this._rangeFresh = true;
    this._schedule(this._pendingRow);
  }

  clear() {
    const hook = this._pendingHook;
    if (hook) {
      this._pendingHook = null;
      try {
        hook[0].disconnect(hook[1]);
      } catch (_error) {}
    }
    this._pendingRow = null;
    this._pendingGeometry = null;
    this._applied = false;
    this._rangeFresh = false;
    this._retryCount = 0;
    this._removeSource("_retryId");
    this._removeSource("_retryTimeoutId");
  }

  destroy() {
    this.clear();
  }

  _schedule(row) {
    if (this._retryId || row !== this._pendingRow) return;
    this._retryId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
      this._retryId = 0;
      if (!this._apply(row)) this._scheduleRetry(row);
      return GLib.SOURCE_REMOVE;
    });
  }

  _scheduleRetry(row) {
    if (this._retryTimeoutId || row !== this._pendingRow) return;
    if (this._retryCount >= MAX_SCROLL_RETRIES) return;
    this._retryCount++;
    this._retryTimeoutId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RETRY_DELAY_MS,
      () => {
        this._retryTimeoutId = 0;
        this._schedule(row);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _apply(row) {
    if (!row || row !== this._pendingRow || !row.get_parent()) return true;
    if (!this._scroll) return true;

    const adjustment = this._scroll.get_vadjustment();
    const pageSize = adjustment ? adjustment.get_page_size() : 0;
    if (!adjustment || pageSize <= 0) return false;

    let rowTop;
    let rowHeight;
    if (this._pendingGeometry) {
      ({ top: rowTop, height: rowHeight } = this._pendingGeometry);
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
      this._applied = true;
      adjustment.set_value(clamped);
      this._scheduleRetry(row);
      return true;
    }

    if (this._applied || this._rangeFresh) this.clear();
    return true;
  }

  _removeSource(field) {
    if (!this[field]) return;
    try {
      GLib.source_remove(this[field]);
    } catch (_error) {}
    this[field] = 0;
  }
}
