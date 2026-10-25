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
import { looksLikePath } from "./search/path-query.js";

const CONTENT_SEARCH_SETTLE_MS = 350;

const RESULTS_PAINT_HOLD_MS = 50;

const WALK_SETTLE_MS = 350;

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
    this._files.warmup();
    this._appResultLimit = settings.get_int("app-result-limit");
    this._contentSearchEnabled = settings.get_boolean("enable-content-search");

    this._settleId = 0;
    this._settleResolve = null;
    this._pendingRenderId = 0;
    this._pendingSources = null;
    this._rowIconsWarmed = false;
    this._sessionSeq = 0;
    this._selectedIndex = 0;
    this._items = [];
    this._clearShownFiles();
  }

  setAppResultLimit(limit) {
    this._appResultLimit = limit;
  }

  setFileResultLimit(limit) {
    if (this._files) this._files.resultLimit = limit;
  }

  setContentSearchEnabled(enabled) {
    this._contentSearchEnabled = !!enabled;
    if (this._contentSearchEnabled) return;
    this.cancelSettles();
    if (this._files) this._files.cancel();
  }

  refresh() {
    if (this._view.isVisible) this.schedule();
  }

  queryChanged() {
    if (!this._view.isVisible) return;
    this.schedule();
  }

  reset() {
    this.cancelSettles();
    this._cancelPendingRender();
    this._abandonSearches();
    this._selectedIndex = 0;
    this._items = [];
    this._clearShownFiles();
    this._warmRowIcons();
  }

  _warmRowIcons() {
    if (this._rowIconsWarmed || !this._view.warmIcons) return;
    this._rowIconsWarmed = true;
    this._view.warmIcons(loadApps(Shell.AppSystem.get_default()));
  }

  cancel() {
    this.cancelSettles();
    this._cancelPendingRender();
    this._abandonSearches();
    if (this._files) this._files.cancel();
  }

  dispose() {
    this.cancelSettles();
    this._cancelPendingRender();
    this._abandonSearches();
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

  activateSelected(mode = "default") {
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
    this.cancelSettles();
    this.runSearch();
  }

  runSearch() {
    if (!this._view.isVisible || !this._files) return;

    const query = this._view.entryText.trim();
    if (query === "") {
      this._files.cancel();
      this._cancelPendingRender();
      this._items = [];
      this._clearShownFiles();
      this._view.clearResults();
      return;
    }

    this._selectedIndex = 0;

    const sources = this._collectSources(query);
    const wantsFiles = this._shouldSearchFiles(query, sources.apps.length);
    sources.files =
      wantsFiles && this._shownFilesQuery === query ? this._shownFiles : [];
    if (!wantsFiles) this._clearShownFiles();

    if (wantsFiles) {
      this._scheduleRender(sources);
    } else {
      this._cancelPendingRender();
      this._render(sources);
    }

    if (!wantsFiles) return;

    this._searchFiles(query, sources);
  }

  _clearShownFiles() {
    this._shownFiles = [];
    this._shownFilesQuery = "";
  }

  _scheduleRender(sources) {
    this._pendingSources = sources;
    if (this._pendingRenderId) return;
    this._pendingRenderId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      RESULTS_PAINT_HOLD_MS,
      () => {
        this._pendingRenderId = 0;
        const pending = this._pendingSources;
        this._pendingSources = null;
        if (pending) this._render(pending);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _cancelPendingRender() {
    this._pendingSources = null;
    if (!this._pendingRenderId) return;
    GLib.Source.remove(this._pendingRenderId);
    this._pendingRenderId = 0;
  }

  _collectSources(query) {
    const _ = this._gettext;
    const apps = makeAppItems(loadApps(Shell.AppSystem.get_default()), query, {
      gettext: _,
      limit: this._appResultLimit,
    });
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

  async _searchFiles(query, sources) {
    const session = this._sessionSeq;
    const files = this._files;
    const token = files.beginSearch();
    const current = () =>
      session === this._sessionSeq &&
      !token.isStale &&
      this._queryStillCurrent(query);

    try {
      let items = await files.search(query, token, {
        scan: false,
        content: false,
      });
      if (!current()) return;

      if (
        items !== null &&
        items.length === 0 &&
        this._worthWalking(query, sources, items)
      ) {
        if (!(await this._settle(WALK_SETTLE_MS, query))) return;
        items = await files.search(query, token, {
          scan: true,
          content: false,
        });
        if (!current()) return;

        if (
          items !== null &&
          items.length === 0 &&
          this._contentSearchEnabled
        ) {
          if (!(await this._settle(CONTENT_SEARCH_SETTLE_MS, query))) return;
          items = await files.search(query, token, {
            scan: false,
            content: true,
          });
          if (!current()) return;
        }
      }

      sources.files = items ?? [];
      this._shownFiles = sources.files;
      this._shownFilesQuery = query;
      this._cancelPendingRender();
      this._render(sources);
    } catch (error) {
      if (current()) this._showWithoutFiles(sources);
      console.error(
        `[${this._displayName}] ${this._gettext("File search failed")}: ${error.message}`,
      );
    }
  }

  _settle(ms, query) {
    this.cancelSettles();
    return new Promise((resolve) => {
      this._settleResolve = resolve;
      this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
        this._settleId = 0;
        this._settleResolve = null;
        resolve(this._view?.isVisible && this._queryStillCurrent(query));
        return GLib.SOURCE_REMOVE;
      });
    });
  }

  cancelSettles() {
    if (this._settleId) {
      GLib.Source.remove(this._settleId);
      this._settleId = 0;
    }
    const resolve = this._settleResolve;
    this._settleResolve = null;
    if (resolve) resolve(false);
  }

  _queryStillCurrent(query) {
    return !!this._view && this._view.entryText.trim() === query;
  }

  _abandonSearches() {
    this._sessionSeq++;
  }

  _showWithoutFiles(sources) {
    if (!this._view?.isVisible) return;
    sources.files = [];
    this._clearShownFiles();
    this._cancelPendingRender();
    this._render(sources);
  }

  _worthWalking(query, sources, files) {
    return (
      !looksLikePath(query) && this._nothingElseToShow({ ...sources, files })
    );
  }

  _shouldSearchFiles(query, appCount) {
    return (
      appCount <= FILE_QUERY_MAX_APP_ITEMS &&
      query.length >= FILE_QUERY_MIN_LENGTH
    );
  }

  _nothingElseToShow(sources) {
    return (
      sources.files.length === 0 &&
      sources.apps.length === 0 &&
      sources.calculator.length === 0 &&
      (sources.commands?.length ?? 0) === 0 &&
      sources.url.length === 0
    );
  }

  /** @returns {boolean} whether the view had to be repainted */
  _render(sources) {
    if (!this._view) return false;

    const { items, changed } = updateResultItems(sources, this._items);
    this._items = items;

    if (this._selectedIndex >= items.length)
      this._selectedIndex = Math.max(0, items.length - 1);

    if (!changed) {
      this._view.setSelection(this._selectedIndex);
      return false;
    }

    this._view.renderResults(items, items.map(rowIdentity), {
      selectedIndex: this._selectedIndex,
      buildRow: (item) =>
        buildRow(item, {
          selected: false,
          onActivate: (activated) => {
            const index = this._items.indexOf(activated);
            if (index < 0) return;
            this._selectedIndex = index;
            this.activateSelected();
          },
        }),
    });
    return true;
  }
}
