/*
 * Lightning Search Launcher, search session controller
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import GLib from "gi://GLib";
import Shell from "gi://Shell";

import { makeCommandItem } from "./commands.js";
import {
  activateItem,
  engineNameFromUrl,
  loadApps,
  makeAppItems,
  makeCalcItem,
  makeConversionItem,
  makeUrlItem,
  makeWebItem,
  rowIdentity,
  updateResultItems,
} from "./results.js";
import { buildRow } from "./ui.js";
import { FileSearch } from "./search/file-search.js";

const SEARCH_DEBOUNCE_MS = 40;
const FILE_QUERY_MIN_LENGTH = 2;
const FILE_QUERY_MAX_APP_ITEMS = 4;

export class SearchController {
  constructor({ view, settings, gettext, displayName, onHide }) {
    this._view = view;
    this._settings = settings;
    this._gettext = gettext;
    this._displayName = displayName;
    this._onHide = onHide;

    this._files = new FileSearch();
    this._files.resultLimit = settings.get_int("file-result-limit");
    this._appResultLimit = settings.get_int("app-result-limit");

    this._debounceId = 0;
    this._selectedIndex = 0;
    this._items = [];
  }

  setAppResultLimit(limit) {
    this._appResultLimit = limit;
  }

  setFileResultLimit(limit) {
    if (this._files) this._files.resultLimit = limit;
  }

  refresh() {
    if (this._view.isVisible) this.schedule();
  }

  queryChanged() {
    if (!this._view.isVisible) return;
    this.schedule();
  }

  reset() {
    this._selectedIndex = 0;
    this._items = [];
  }

  cancel() {
    this.cancelDebounce();
    if (this._files) this._files.cancel();
  }

  dispose() {
    this.cancelDebounce();
    if (!this._files) return;
    this._files.dispose();
    this._files = null;
  }

  moveSelection(step) {
    const count = this._items.length;
    if (count === 0) return;
    this._selectedIndex = (this._selectedIndex + step + count) % count;
    this._view.setSelection(this._selectedIndex);
  }

  activateSelected(mode = "background") {
    if (!this._view?.isVisible) return;

    const item = this._items[this._selectedIndex];
    if (!item) return;

    try {
      activateItem(item, {
        mode,
        settings: this._settings,
        setEntryText: (text) => {
          this._view.entryText = text;
        },
      });
    } catch (error) {
      console.error(
        `[${this._displayName}] ${this._gettext("Failed to activate")}: ${error}`,
      );
    }

    this._onHide();
  }

  schedule() {
    this.cancelDebounce();
    this._debounceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      SEARCH_DEBOUNCE_MS,
      () => {
        this._debounceId = 0;
        this.runSearch();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  cancelDebounce() {
    if (!this._debounceId) return;
    GLib.Source.remove(this._debounceId);
    this._debounceId = 0;
  }

  runSearch() {
    if (!this._view.isVisible || !this._files) return;

    const query = this._view.entryText.trim();
    if (query === "") {
      this._files.cancel();
      this._items = [];
      this._view.clearResults();
      return;
    }

    const token = this._files.beginSearch();
    this._selectedIndex = 0;

    const sources = this._collectSources(query);
    const wantsFiles = this._shouldSearchFiles(query, sources.apps.length);
    if (wantsFiles) sources.files = this._files.interimMatches(query);

    this._render(sources);
    if (wantsFiles) this._searchFiles(query, token, sources);
  }

  _collectSources(query) {
    const _ = this._gettext;
    const apps = makeAppItems(
      loadApps(Shell.AppSystem.get_default()),
      query,
      _,
      this._appResultLimit,
    );
    const calculator = [
      makeCalcItem(query, _),
      makeConversionItem(query, _),
    ].filter(Boolean);
    const commands = this._settings.get_boolean("enable-command-runner")
      ? [makeCommandItem(query, _)].filter(Boolean)
      : [];
    const url = [makeUrlItem(query, _)].filter(Boolean);
    const web = url.length ? [] : [makeWebItem(query, this._engineName(), _)];
    return { apps, calculator, commands, url, web, files: [] };
  }

  _engineName() {
    try {
      return engineNameFromUrl(
        this._settings.get_string("search-engine-url"),
        this._gettext,
      );
    } catch (_error) {
      return this._gettext("Web search");
    }
  }

  _searchFiles(query, token, sources) {
    this._files
      .search(query, token)
      .then((items) => {
        if (items === null) return;
        sources.files = items;
        this._render(sources);
      })
      .catch((error) =>
        console.error(
          `[${this._displayName}] ${this._gettext("File search failed")}: ${error.message}`,
        ),
      );
  }

  _shouldSearchFiles(query, appCount) {
    return (
      appCount <= FILE_QUERY_MAX_APP_ITEMS &&
      query.length >= FILE_QUERY_MIN_LENGTH
    );
  }

  _render(sources) {
    if (!this._view) return;

    const { items, changed } = updateResultItems(sources, this._items);
    this._items = items;

    if (this._selectedIndex >= items.length)
      this._selectedIndex = Math.max(0, items.length - 1);

    if (!changed) {
      this._view.setSelection(this._selectedIndex);
      return;
    }

    this._view.renderResults(
      items,
      items.map(rowIdentity),
      this._selectedIndex,
      (index, item) =>
        buildRow(item, {
          selected: index === this._selectedIndex,
          onActivate: () => {
            this._selectedIndex = index;
            this.activateSelected();
          },
        }),
    );
  }
}
