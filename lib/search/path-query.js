/*
 * Spotlight Launcher for GNOME, path query parsing
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

export function looksLikePath(query) {
  return query.startsWith("~") || query.includes("/");
}

/**
 *
 * @param {string} query raw text from the entry
 * @param {string} home absolute path of the home directory
 * @returns {{ path: string, partial: string }} `partial` is lowercase, "" when
 *   every child should be listed
 */
export function resolvePathQuery(query, home) {
  const expanded = query.startsWith("~") ? home + query.slice(1) : query;
  const absolute = expanded.startsWith("/") ? expanded : `${home}/${expanded}`;

  if (absolute === home || absolute === `${home}/`)
    return { path: home, partial: "" };

  const endedWithSlash = absolute.endsWith("/");
  const trimmed = absolute.replace(/\/+$/, "") || "/";
  const lastSlash = trimmed.lastIndexOf("/");
  return {
    path: endedWithSlash ? trimmed : trimmed.slice(0, lastSlash) || "/",
    partial: endedWithSlash ? "" : trimmed.slice(lastSlash + 1).toLowerCase(),
  };
}
