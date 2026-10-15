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

const SEARCH_DEBOUNCE_MS = 40;
/** How long typing has to stop before the slow content search is worth running. */
const CONTENT_SEARCH_SETTLE_MS = 350;
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

    this._debounceId = 0;
    this._contentSearchId = 0;
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
    this._selectedIndex = 0;
    this._items = [];
    this._shownFiles = [];
  }

  cancel() {
    this.cancelDebounce();
    this.cancelContentSearch();
    if (this._files) this._files.cancel();
  }

  dispose() {
    this.cancelDebounce();
    this.cancelContentSearch();
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
    if (this._files) this._files.cancel();
    this.cancelDebounce();
    this.cancelContentSearch();
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
      this._shownFiles = [];
      this._view.clearResults();
      return;
    }

    const token = this._files.beginSearch();
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
    if (this._worthPaintingEarly(sources, files)) {
      if (this._render({ ...sources, files })) this._shownFiles = files;
    }

    this._searchFiles(query, token, sources, { scan: searchHarder });
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

  _searchFiles(query, token, sources, options = {}) {
    this._files
      .search(query, token, options)
      .then((items) => {
        if (items === null) return;
        sources.files = items;
        this._render(sources);
        this._shownFiles = items;

        // Nothing came back from the quick half. The content search is far too
        // slow to run on every keystroke, so it waits for the typing to settle
        // and only then fills in the rows that the name index could not find.
        if (items.length === 0 && options.scan && this._contentSearchEnabled)
          this._scheduleContentSearch(query, token, sources);
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
        this._searchFiles(query, token, sources, {
          scan: false,
          content: true,
        });
        return GLib.SOURCE_REMOVE;
      },
    );
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

  /**
   * Whether the rows in hand are worth painting before the file search answers.
   *
   * The query's own rows -- a URL, a calculator answer, a command or an app --
   * always are: they are what the keystroke was for, and waiting for the files
   * meant a typed URL only appeared once Tracker had answered a query it was
   * never going to match. File rows that are known already are worth painting
   * for the same reason.
   *
   * The web fallback on its own is not: it is the "nothing matched" row, and
   * showing it only to push the file rows above it a moment later is the reorder
   * this whole path is here to avoid. Left out means the panel holds what it has
   * until the files come back.
   */
  _worthPaintingEarly(sources, files) {
    return (
      files.length > 0 ||
      sources.url.length > 0 ||
      sources.calculator.length > 0 ||
      sources.apps.length > 0 ||
      (sources.commands?.length ?? 0) > 0
    );
  }

  /**
   * Whether the expensive half of the file search is worth running: the
   * full-text content search and the filesystem walk. Both exist to find
   * something when the quick answer is nothing, and both are slow enough to hold
   * back rows that are already available, so they are skipped whenever an app,
   * calculator, command, URL or cached file row is going to be shown for this
   * query. The filesystem walk then runs with the search, and the content search
   * waits for the typing to settle (see `_scheduleContentSearch`).
   */
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
      buildRowAt: (index, item) =>
        buildRow(item, {
          selected: index === this._selectedIndex,
          onActivate: () => {
            this._selectedIndex = index;
            this.activateSelected();
          },
        }),
    });
    return true;
  }
}
