/*
 * Lightning Search Launcher, default browser icon
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Gio from "gi://Gio";

const BROWSER_SCHEMES = ["https", "http"];

let cachedIcon = null;
let cached = false;

export function defaultBrowserIcon() {
  if (cached) return cachedIcon;

  cached = true;
  for (const scheme of BROWSER_SCHEMES) {
    cachedIcon = handlerIcon(scheme);
    if (cachedIcon) break;
  }
  return cachedIcon;
}

export function clearBrowserIconCache() {
  cached = false;
  cachedIcon = null;
}

function handlerIcon(scheme) {
  let appInfo = null;
  try {
    appInfo = Gio.AppInfo.get_default_for_uri_scheme(scheme);
  } catch (_error) {
    return null;
  }
  if (!appInfo) return null;

  try {
    return appInfo.get_icon() ?? null;
  } catch (_error) {
    return null;
  }
}
