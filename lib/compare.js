/*
 * Spotlight Launcher for GNOME, comparators
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

export function byScoreThenTitle(a, b) {
  return b.score - a.score || a.title.localeCompare(b.title);
}
