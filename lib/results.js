/*
 * Spotlight Launcher for GNOME, result items
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";

import { calculate, isCalcQuery } from "./calc.js";
import { byScoreThenTitle } from "./compare.js";
import { scoreMatch } from "./score.js";
import { getUrl } from "./search/url-query.js";

const APP_SCORE_CUTOFF = 150;
const APP_RESULT_LIMIT = 8;

const CALC_SCORE = 600;
const WEB_SCORE = 50;
const URL_SCORE = 900;
const MAX_RESULTS = 12;

const DEFAULT_SEARCH_ENGINE_URL = "https://duckduckgo.com/?q=%s";

/**
 * Don't cache apps so uninstalled apps don't keep showing up.
 */
export function loadApps(appSystem) {
  return appSystem
    .get_installed()
    .filter((info) => !info.get_nodisplay())
    .map((info) => makeAppData(appSystem, info))
    .filter((app) => app.name !== "")
    .sort((a, b) => a.name.localeCompare(b.name));
}

function makeAppData(appSystem, desktopInfo) {
  const id = desktopInfo.get_id() || "";
  return {
    shellApp: appSystem.lookup_app(id),
    desktopInfo,
    name: desktopInfo.get_name() || "",
    description: desktopInfo.get_description() || "",
    id,
  };
}

export function makeAppItems(apps, query) {
  const q = query.toLowerCase();
  return apps
    .map((app) => ({
      type: "app",
      appData: app,
      title: app.name,
      subtitle: app.description || "Application",
      score: scoreMatch(q, {
        primary: app.name.toLowerCase(),
        secondary: app.description.toLowerCase(),
      }),
    }))
    .filter((item) => item.score > APP_SCORE_CUTOFF)
    .sort(byScoreThenTitle)
    .slice(0, APP_RESULT_LIMIT);
}

export function makeCalcItem(query) {
  if (!isCalcQuery(query)) return null;
  const result = calculate(query);
  if (result === null) return null;
  return {
    type: "calc",
    title: `= ${result}`,
    subtitle: "Enter to copy",
    copyText: result,
    score: CALC_SCORE,
  };
}

export function makeWebItem(query, engineName) {
  return {
    type: "web",
    title: `Search web for "${query}"`,
    subtitle: engineName,
    query,
    score: WEB_SCORE,
  };
}

export function makeUrlItem(query) {
  const urlObtained = getUrl(query);
  if (!urlObtained) return;
  return {
    type: "url",
    title: urlObtained,
    subtitle: "Open in browser",
    query: urlObtained,
    score: URL_SCORE,
  };
}

export function engineNameFromUrl(url) {
  const match = /^https?:\/\/([^/?#]+)/.exec(url || "");
  return match ? match[1].replace(/^www\./, "") : "Web search";
}

export function updateResultItems(sources, previousItems) {
  const tail = sources.web;
  const head = [
    ...sources.url,
    ...sources.calculator,
    ...sources.apps,
    ...sources.files,
  ].slice(0, Math.max(0, MAX_RESULTS - tail.length));
  const items = [...head, ...tail];

  return { items, changed: signature(items) !== signature(previousItems) };
}

export function activateItem(item, context) {
  const activate = ACTIVATORS[item.type];
  if (activate) activate(item, context);
}

const ACTIVATORS = {
  app: (item) => launchApp(item.appData),
  web: (item, context) => openUri(webSearchUrl(context.settings, item.query)),
  url: (item) => openUri(item.query),
  calc: (item, context) => pasteCalcResult(item, context),
  file: openItemPath,
  folder: openItemPath,
};

function launchApp(appData) {
  if (appData.shellApp) {
    appData.shellApp.activate();
    return;
  }
  appData.desktopInfo.launch([], null);
}

function webSearchUrl(settings, query) {
  const template =
    settings.get_string("search-engine-url") || DEFAULT_SEARCH_ENGINE_URL;
  return template.replace("%s", encodeURIComponent(query));
}

function openUri(uri) {
  Gio.AppInfo.launch_default_for_uri(uri, null);
}

function openItemPath(item) {
  openUri(GLib.filename_to_uri(item.path, null));
}

function pasteCalcResult(item, { setEntryText }) {
  if (!item.copyText) return;
  const clipboard = St.Clipboard.get_default();
  const ct = String(item.copyText);
  setEntryText(ct);
  clipboard.set_text(St.ClipboardType.CLIPBOARD, ct);
}

export function rowIdentity(item) {
  return `${item.type}:${item.path || item.title}`;
}

function signature(items) {
  return items.map(rowIdentity).join("\u0001");
}
