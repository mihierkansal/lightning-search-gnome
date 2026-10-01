/*
 * Lightning Search Launcher, keybinding configuration
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

export const FALLBACK_SHORTCUT = "<Control><Super>space";

export function preferredShortcut(settings) {
  const shortcuts = settings.get_strv("shortcut-key");
  const first = shortcuts.length > 0 ? shortcuts[0] : "";
  return first !== "" ? first : FALLBACK_SHORTCUT;
}
