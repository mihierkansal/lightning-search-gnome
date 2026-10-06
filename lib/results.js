/*
 * Lightning Search Launcher, result items
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
import { runCommand } from "./commands.js";
import { convert } from "./units.js";
import { byScoreThenTitle } from "./compare.js";
import { scoreMatch } from "./score.js";
import { getUrl } from "./search/url-query.js";

const APP_SCORE_CUTOFF = 150;
const APP_RESULT_LIMIT = 8;

const CALC_SCORE = 600;
const WEB_SCORE = 50;
const URL_SCORE = 900;

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

export function makeAppItems(
  apps,
  query,
  { gettext = (text) => text, limit = APP_RESULT_LIMIT } = {},
) {
  const q = query.toLowerCase();
  return apps
    .map((app) => ({
      type: "app",
      appData: app,
      title: app.name,
      subtitle: app.description || gettext("Application"),
      score: scoreMatch(q, {
        primary: app.name.toLowerCase(),
        secondary: app.description.toLowerCase(),
      }),
    }))
    .filter((item) => item.score > APP_SCORE_CUTOFF)
    .sort(byScoreThenTitle)
    .slice(0, limit);
}

export function makeCalcItem(query, _ = (text) => text) {
  if (!isCalcQuery(query)) return null;
  const result = calculate(query);
  if (result === null) return null;
  return {
    type: "calc",
    title: `= ${result}`,
    subtitle: _("Enter to copy"),
    copyText: result,
    score: CALC_SCORE,
  };
}

export function makeConversionItem(query, _ = (text) => text) {
  const conversion = convert(query);
  if (!conversion) return null;
  return {
    type: "calc",
    title: `= ${conversion.text}`,
    subtitle: _("Enter to copy"),
    copyText: conversion.text,
    score: CALC_SCORE,
  };
}

export function makeWebItem(query, engineName, _ = (text) => text) {
  return {
    type: "web",
    title: _('Search web for "%s"').replace("%s", () => query),
    subtitle: engineName,
    query,
    score: WEB_SCORE,
  };
}

export function makeUrlItem(query, _ = (text) => text) {
  const urlObtained = getUrl(query);
  if (!urlObtained) return;
  return {
    type: "url",
    title: urlObtained,
    subtitle: _("Open in browser"),
    query: urlObtained,
    score: URL_SCORE,
  };
}

export function engineNameFromUrl(url, _ = (text) => text) {
  const match = /^https?:\/\/([^/?#]+)/.exec(url || "");
  return match ? match[1].replace(/^www\./, "") : _("Web search");
}

export function updateResultItems(sources, previousItems) {
  const items = [
    ...sources.url,
    ...sources.calculator,
    ...sources.apps,
    ...(sources.commands || []),
    ...sources.files,
    ...sources.web,
  ];

  return { items, changed: signature(items) !== signature(previousItems) };
}

export function activateItem(item, context) {
  const actions = ACTIVATORS[item.type];
  if (!actions) return;

  const mode = context.mode || "default";
  const activate = actions[mode];
  if (activate) activate(item, context);
}

const PATH_ACTIONS = {
  default: openItemPath,
  secondary: openContainingFolder,
  properties: showItemProperties,
  copy: copyItemToClipboard,
};

const ACTIVATORS = {
  app: { default: (item) => launchApp(item.appData) },
  web: {
    default: (item, context) =>
      openUri(webSearchUrl(context.settings, item.query)),
  },
  url: { default: (item) => openUri(item.query) },
  calc: { default: (item, context) => pasteCalcResult(item, context) },
  command: {
    default: (item) => runCommand(item, "background"),
    secondary: (item) => runCommand(item, "terminal"),
  },
  file: PATH_ACTIONS,
  folder: PATH_ACTIONS,
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
  openUri(pathToUri(item.path));
}

const FILE_MANAGER_BUS_NAME = "org.freedesktop.FileManager1";
const FILE_MANAGER_OBJECT_PATH = "/org/freedesktop/FileManager1";
const FILE_MANAGER_INTERFACE = "org.freedesktop.FileManager1";

const URI_LIST_MIMETYPE = "text/uri-list";

function openContainingFolder(item) {
  if (!item.path) return;
  const directory = GLib.path_get_dirname(item.path);
  callFileManager("ShowItems", item, () => openUri(pathToUri(directory)));
}

function showItemProperties(item) {
  callFileManager("ShowItemProperties", item, null);
}

function copyItemToClipboard(item) {
  if (!item.path) return;
  const uriList = `${pathToUri(item.path)}\r\n`;
  St.Clipboard.get_default().set_content(
    St.ClipboardType.CLIPBOARD,
    URI_LIST_MIMETYPE,
    new GLib.Bytes(uriList),
  );
}

function callFileManager(method, item, onFailure) {
  if (!item.path) return;
  try {
    Gio.DBus.session.call(
      FILE_MANAGER_BUS_NAME,
      FILE_MANAGER_OBJECT_PATH,
      FILE_MANAGER_INTERFACE,
      method,
      new GLib.Variant("(ass)", [[pathToUri(item.path)], ""]),
      null,
      Gio.DBusCallFlags.NONE,
      -1,
      null,
      (connection, result) => {
        try {
          connection.call_finish(result);
        } catch (_error) {
          if (onFailure) onFailure(item);
        }
      },
    );
  } catch (_error) {
    if (onFailure) onFailure(item);
  }
}

function pathToUri(path) {
  return GLib.filename_to_uri(path, null);
}

function pasteCalcResult(item, { setEntryText }) {
  if (!item.copyText) return;
  const clipboard = St.Clipboard.get_default();
  const ct = String(item.copyText);
  setEntryText(ct);
  clipboard.set_text(St.ClipboardType.CLIPBOARD, ct);
}

export function rowIdentity(item) {
  const base = `${item.type}:${item.path || item.title}`;
  return item.snippet ? `${base}\u0002${item.snippet}` : base;
}

function signature(items) {
  return items.map(rowIdentity).join("\u0001");
}
