/*
 * Lightning Search Launcher, usage-based ranking
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 * How often something was opened before is kept in a local JSON file and added
 * to the text score as a bonus. It is deliberately small relative to the text
 * scores in score.js: a name substring match (800) always outranks a merely
 * habitual one, so ranking by habit breaks ties and reorders similar matches
 * instead of burying a clearly better one. Everything stays on this machine.
 */

import GLib from "gi://GLib";

const BONUS_PER_USE = 15;
const MAX_BONUS = 400;

const HALF_LIFE_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_ENTRIES = 500;

const SAVE_DEBOUNCE_MS = 3000;

const STORE_VERSION = 1;

let entries = null;
let saveTimerId = 0;
let dirty = false;

export function appUsageKey(desktopId) {
  return desktopId ? `app:${desktopId}` : null;
}

export function fileUsageKey(path) {
  return path ? `file:${path}` : null;
}

export function warmupUsage() {
  load();
}

export function frecencyBonus(key) {
  if (!key) return 0;

  const entry = load().get(key);
  if (!entry) return 0;

  const ageDays = Math.max(0, (Date.now() - entry.last) / DAY_MS);
  const decay = 0.5 ** (ageDays / HALF_LIFE_DAYS);
  return Math.min(MAX_BONUS, entry.count * BONUS_PER_USE) * decay;
}

export function recordUsage(key) {
  if (!key) return;

  const store = load();
  const entry = store.get(key) ?? { count: 0 };
  entry.count += 1;
  entry.last = Date.now();

  store.delete(key);
  store.set(key, entry);
  evictBeyondLimit(store);

  dirty = true;
  scheduleSave();
}

export function flushUsage() {
  if (saveTimerId) {
    GLib.Source.remove(saveTimerId);
    saveTimerId = 0;
  }
  save();
}

function usageFilePath() {
  const stateHome =
    GLib.getenv("XDG_STATE_HOME") || `${GLib.get_home_dir()}/.local/state`;
  return `${stateHome}/lightning-search/usage.json`;
}

function load() {
  if (entries) return entries;
  entries = new Map();

  try {
    const [ok, contents] = GLib.file_get_contents(usageFilePath());
    if (ok)
      readEntries(entries, JSON.parse(new TextDecoder().decode(contents)));
  } catch (_error) {}
  return entries;
}

function readEntries(store, parsed) {
  const saved = parsed?.entries;
  if (!saved || typeof saved !== "object") return;

  for (const [key, value] of Object.entries(saved)) {
    const count = Number(value?.count);
    const last = Number(value?.last);
    if (typeof key === "string" && key !== "" && count > 0 && last > 0)
      store.set(key, { count, last });
  }
}

function scheduleSave() {
  if (saveTimerId) return;
  saveTimerId = GLib.timeout_add(
    GLib.PRIORITY_DEFAULT,
    SAVE_DEBOUNCE_MS,
    () => {
      saveTimerId = 0;
      save();
      return GLib.SOURCE_REMOVE;
    },
  );
}

function save() {
  if (!dirty || !entries) return;
  dirty = false;

  const target = usageFilePath();
  try {
    GLib.mkdir_with_parents(GLib.path_get_dirname(target), 0o700);
    GLib.file_set_contents(
      target,
      JSON.stringify({
        version: STORE_VERSION,
        entries: Object.fromEntries(entries),
      }),
    );
  } catch (error) {
    console.error(
      `[Lightning Search Launcher] Could not save usage data: ${error.message}`,
    );
  }
}

function evictBeyondLimit(store) {
  while (store.size > MAX_ENTRIES) store.delete(store.keys().next().value);
}
