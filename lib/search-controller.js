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
import { mergeResults } from "./search/merge.js";
import { looksLikePath } from "./search/path-query.js";

/** How long typing has to stop before the slow content search is worth running. */
const CONTENT_SEARCH_SETTLE_MS = 350;

const FILE_SEARCH_WATCHDOG_MS = 250;
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

    this._contentSearchId = 0;
    this._watchdogId = 0;
    this._rowIconsWarmed = false;
    this._searchSeq = 0;
    /** Bumped when the panel stops caring what any search in flight answers. */
    this._sessionSeq = 0;
    this._searchInFlight = false;
    /** The query the in-flight file search was started for. */
    this._searchQuery = "";
    /** Set when the text changed while a file search was still out. */
    this._rerunPending = false;
    this._selectedIndex = 0;
    this._items = [];
    this._shownFiles = [];
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
    // Turning it off should also abandon a content search already in flight.
    this.cancelContentSearch();
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
    this.cancelContentSearch();
    this._abandonSearches();
    this._selectedIndex = 0;
    this._items = [];
    this._shownFiles = [];
    this._warmRowIcons();
  }

  _warmRowIcons() {
    if (this._rowIconsWarmed || !this._view.warmIcons) return;
    this._rowIconsWarmed = true;
    this._view.warmIcons(loadApps(Shell.AppSystem.get_default()));
  }

  cancel() {
    this.cancelContentSearch();
    this._abandonSearches();
    if (this._files) this._files.cancel();
  }

  dispose() {
    this.cancelContentSearch();
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
    this.cancelContentSearch();
    this.runSearch();
  }

  runSearch() {
    if (!this._view.isVisible || !this._files) return;

    const query = this._view.entryText.trim();
    this._rerunPending = false;
    if (query === "") {
      this._files.cancel();
      this._items = [];
      this._shownFiles = [];
      this._view.clearResults();
      return;
    }

    this._selectedIndex = 0;

    const sources = this._collectSources(query);
    const wantsFiles = this._shouldSearchFiles(query, sources.apps.length);
    const cachedFiles = wantsFiles ? this._files.interimMatches(query) : [];
    const searchHarder =
      wantsFiles && this._nothingElseToShow({ ...sources, files: cachedFiles });

    if (!wantsFiles) {
      sources.files = [];
      this._shownFiles = [];
      this._render(sources);
      return;
    }

    const files = looksLikePath(query)
      ? cachedFiles
      : mergeResults(cachedFiles, this._shownFiles, this._files.resultLimit);
    if (this._worthPaintingEarly(sources, files, query)) {
      if (this._render({ ...sources, files })) this._shownFiles = files;
    }
    if (this._searchInFlight) {
      this._rerunPending = true;
      return;
    }

    const token = this._files.beginSearch();
    this._startFileSearch(query, token, sources, { scan: searchHarder });
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

  _startFileSearch(query, token, sources, options = {}) {
    const seq = ++this._searchSeq;
    const session = this._sessionSeq;
    this._searchInFlight = true;
    this._searchQuery = query;
    this._armWatchdog(seq);

    this._files
      .search(query, token, options)
      .then((items) => {
        if (
          items !== null &&
          session === this._sessionSeq &&
          this._queryStillCurrent(query)
        ) {
          sources.files = items;
          this._render(sources);
          this._shownFiles = items;

          if (items.length === 0 && options.scan && this._contentSearchEnabled)
            this._scheduleContentSearch(query, token, sources);
        }
        if (seq !== this._searchSeq) return;
        this._settleSearch();
      })
      .catch((error) => {
        if (seq !== this._searchSeq) return;
        console.error(
          `[${this._displayName}] ${this._gettext("File search failed")}: ${error.message}`,
        );
        this._settleSearch();
      });
  }

  _startContentSearch(query, token, sources) {
    const session = this._sessionSeq;
    this._files
      .search(query, token, { scan: false, content: true })
      .then((items) => {
        if (
          items === null ||
          session !== this._sessionSeq ||
          !this._queryStillCurrent(query)
        )
          return;
        sources.files = items;
        this._render(sources);
        this._shownFiles = items;
      })
      .catch((error) =>
        console.error(
          `[${this._displayName}] ${this._gettext("File search failed")}: ${error.message}`,
        ),
      );
  }

  _scheduleContentSearch(query, token, sources) {
    this.cancelContentSearch();
    this._contentSearchId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      CONTENT_SEARCH_SETTLE_MS,
      () => {
        this._contentSearchId = 0;
        if (!this._view.isVisible || this._view.entryText.trim() !== query)
          return GLib.SOURCE_REMOVE;
        this._startContentSearch(query, token, sources);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _queryStillCurrent(query) {
    return !!this._view && this._view.entryText.trim() === query;
  }

  _releaseSearch() {
    this._searchInFlight = false;
    this._searchQuery = "";
    this._rerunPending = false;
    this.cancelWatchdog();
  }
  _abandonSearches() {
    this._sessionSeq++;
    this._releaseSearch();
  }

  _settleSearch() {
    const rerun = this._rerunPending;
    this._releaseSearch();
    if (rerun) this.runSearch();
  }

  _armWatchdog(seq) {
    this.cancelWatchdog();
    this._watchdogId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      FILE_SEARCH_WATCHDOG_MS,
      () => {
        this._watchdogId = 0;
        if (seq !== this._searchSeq || !this._searchInFlight)
          return GLib.SOURCE_REMOVE;
        this._settleSearch();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  cancelWatchdog() {
    if (!this._watchdogId) return;
    GLib.Source.remove(this._watchdogId);
    this._watchdogId = 0;
  }

  cancelContentSearch() {
    if (!this._contentSearchId) return;
    GLib.Source.remove(this._contentSearchId);
    this._contentSearchId = 0;
  }

  _shouldSearchFiles(query, appCount) {
    return (
      appCount <= FILE_QUERY_MAX_APP_ITEMS &&
      query.length >= FILE_QUERY_MIN_LENGTH
    );
  }

  _worthPaintingEarly(sources, files, query) {
    return (
      files.length > 0 ||
      sources.url.length > 0 ||
      sources.calculator.length > 0 ||
      sources.apps.length > 0 ||
      (sources.commands?.length ?? 0) > 0 ||
      (this._searchInFlight && this._searchQuery !== query)
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
