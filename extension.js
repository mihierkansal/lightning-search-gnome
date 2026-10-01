/*
 * Lightning Search Launcher
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { FALLBACK_SHORTCUT, preferredShortcut } from "./lib/keybindings.js";
import { clearCommandCache, makeCommandItem } from "./lib/commands.js";
import { KeyboardShortcuts } from "./lib/keyboard-shortcuts.js";
import { LauncherView } from "./lib/launcher-view.js";
import { getPanelButton } from "./lib/panel-button.js";
import {
  activateItem,
  engineNameFromUrl,
  loadApps,
  makeAppItems,
  makeCalcItem,
  makeUrlItem,
  makeWebItem,
  rowIdentity,
  updateResultItems,
} from "./lib/results.js";
import { setFuzzyLevel } from "./lib/score.js";
import { buildRow } from "./lib/ui.js";
import { FileSearch } from "./lib/search/file-search.js";

const SEARCH_DEBOUNCE_MS = 40;
const TOGGLE_DEBOUNCE_MS = 200;
const FILE_QUERY_MIN_LENGTH = 2;
const FILE_QUERY_MAX_APP_ITEMS = 4;

// Fallback; the user-visible name comes from metadata.json (this.metadata.name).
const FALLBACK_NAME = "Lightning Search Launcher";
const SCHEMA_ID = "org.gnome.shell.extensions.lightning-search";
const PANEL_BUTTON_ROLE = "lightning-search";

const DBUS_BUS_NAME = "org.gnome.Shell.Extensions.LightningSearch";
const DBUS_OBJECT_PATH = "/org/gnome/Shell/Extensions/LightningSearch";
const DBUS_INTERFACE_XML = `
<node>
  <interface name="${DBUS_BUS_NAME}">
    <method name="Toggle"/>
    <method name="Open"/>
    <method name="Hide"/>
    <method name="Search">
      <arg name="query" type="s" direction="in"/>
    </method>
  </interface>
</node>`;

export default class LightningSearchExtension extends Extension {
  get _displayName() {
    return this.metadata?.name ?? FALLBACK_NAME;
  }

  enable() {
    this._gettext = this.gettext.bind(this);
    this._settings = this.getSettings(SCHEMA_ID);
    clearCommandCache();
    this._syncFuzzyLevel();

    this._view = new LauncherView(this._placeholderText());
    this._view.selectionColor = this._selectionColor();
    this._view.selectionTextColor = this._selectionTextColor();
    this._syncEntryIcon();
    this._view.handlers = {
      onQueryChanged: () => this._onQueryChanged(),
      onActivationRequested: (mode) => this._activateSelected(mode),
      onSelectionMoved: (step) => this._moveSelection(step),
      onDismissRequested: () => this._hideLauncher(),
    };
    this._files = new FileSearch();

    this._shortcuts = new KeyboardShortcuts();
    this._shortcuts.enable();
    this._bindShortcut();
    this._settingsChangedId = this._settings.connect(
      "changed::shortcut-key",
      () => this._bindShortcut(),
    );

    this._placeholderChangedId = this._settings.connect(
      "changed::search-placeholder-text",
      () => this._syncPlaceholderText(),
    );

    this._selectionColorChangedId = this._settings.connect(
      "changed::selection-color",
      () => this._syncSelectionColor(),
    );

    this._selectionTextColorChangedId = this._settings.connect(
      "changed::selection-text-color",
      () => this._syncSelectionTextColor(),
    );

    this._entryIconChangedId = this._settings.connect(
      "changed::show-entry-icon",
      () => this._syncEntryIcon(),
    );
    this._entryIconSizeChangedId = this._settings.connect(
      "changed::entry-icon-size",
      () => this._syncEntryIcon(),
    );

    this._fuzzyLevelChangedId = this._settings.connect(
      "changed::fuzzy-level",
      () => this._syncFuzzyLevel(),
    );

    this._commandRunnerChangedId = this._settings.connect(
      "changed::enable-command-runner",
      () => this._syncCommandRunner(),
    );

    this._panelButton = null;
    this._panelIconChangedId = this._settings.connect(
      "changed::show-panel-icon",
      () => this._syncPanelButton(),
    );
    this._syncPanelButton();

    this._debounceId = 0;
    this._lastToggleTime = 0;
    this._selectedIndex = 0;
    this._items = [];

    this._dbus = null;
    this._busNameId = 0;
    this._exportControlInterface();
  }

  disable() {
    this._cancelSearchDebounce();
    this._unexportControlInterface();
    if (this._settingsChangedId) {
      this._settings.disconnect(this._settingsChangedId);
      this._settingsChangedId = 0;
    }
    if (this._placeholderChangedId) {
      this._settings.disconnect(this._placeholderChangedId);
      this._placeholderChangedId = 0;
    }
    if (this._selectionColorChangedId) {
      this._settings.disconnect(this._selectionColorChangedId);
      this._selectionColorChangedId = 0;
    }
    if (this._selectionTextColorChangedId) {
      this._settings.disconnect(this._selectionTextColorChangedId);
      this._selectionTextColorChangedId = 0;
    }
    if (this._entryIconChangedId) {
      this._settings.disconnect(this._entryIconChangedId);
      this._entryIconChangedId = 0;
    }
    if (this._entryIconSizeChangedId) {
      this._settings.disconnect(this._entryIconSizeChangedId);
      this._entryIconSizeChangedId = 0;
    }
    if (this._fuzzyLevelChangedId) {
      this._settings.disconnect(this._fuzzyLevelChangedId);
      this._fuzzyLevelChangedId = 0;
    }
    if (this._commandRunnerChangedId) {
      this._settings.disconnect(this._commandRunnerChangedId);
      this._commandRunnerChangedId = 0;
    }
    if (this._panelIconChangedId) {
      this._settings.disconnect(this._panelIconChangedId);
      this._panelIconChangedId = 0;
    }
    this._removePanelButton();
    if (this._shortcuts) {
      this._shortcuts.disable();
      this._shortcuts = null;
    }
    if (this._files) {
      this._files.dispose();
      this._files = null;
    }
    this._view.destroy();
    this._view = null;
    this._settings = null;
  }

  _bindShortcut() {
    if (!this._shortcuts || !this._settings) return;
    this._shortcuts.unlisten();

    const preferred = preferredShortcut(this._settings);
    const toggle = () => this._toggleLauncher();

    if (this._shortcuts.listenFor(preferred, toggle)) return;

    if (this._shortcuts.listenFor(FALLBACK_SHORTCUT, toggle)) {
      Main.notify(
        this._displayName,
        this._gettext("%s unavailable, using %s")
          .replace("%s", () => preferred)
          .replace("%s", () => FALLBACK_SHORTCUT),
      );
      return;
    }
    console.error(
      `[${this._displayName}] ${this._gettext("Could not register any shortcut")}`,
    );
  }

  _placeholderText() {
    return this._settings.get_string("search-placeholder-text");
  }

  _syncPlaceholderText() {
    if (this._view) this._view.placeholderText = this._placeholderText();
  }

  _selectionColor() {
    return this._settings.get_string("selection-color");
  }

  _syncSelectionColor() {
    if (this._view) this._view.selectionColor = this._selectionColor();
  }

  _selectionTextColor() {
    return this._settings.get_string("selection-text-color");
  }

  _syncSelectionTextColor() {
    if (this._view) this._view.selectionTextColor = this._selectionTextColor();
  }

  _syncEntryIcon() {
    if (!this._view) return;
    this._view.entryIconVisible = this._settings.get_boolean("show-entry-icon");
    this._view.entryIconSize = this._settings.get_int("entry-icon-size");
  }

  _syncFuzzyLevel() {
    setFuzzyLevel(this._settings.get_string("fuzzy-level"));
    if (this._view?.isVisible) this._scheduleSearch();
  }

  _syncCommandRunner() {
    if (this._view?.isVisible) this._scheduleSearch();
  }

  _syncPanelButton() {
    const shouldShow = this._settings.get_boolean("show-panel-icon");
    if (shouldShow && !this._panelButton) this._addPanelButton();
    else if (!shouldShow && this._panelButton) this._removePanelButton();
  }

  _addPanelButton() {
    const PanelButton = getPanelButton();
    this._panelButton = new PanelButton(() => this._toggleLauncher());
    Main.panel.addToStatusArea(
      PANEL_BUTTON_ROLE,
      this._panelButton,
      -1,
      "right",
    );
  }

  _removePanelButton() {
    if (!this._panelButton) return;
    this._panelButton.destroy();
    this._panelButton = null;
  }

  _exportControlInterface() {
    this._dbus = Gio.DBusExportedObject.wrapJSObject(DBUS_INTERFACE_XML, this);
    try {
      this._dbus.export(Gio.DBus.session, DBUS_OBJECT_PATH);
    } catch (error) {
      console.error(
        `[${this._displayName}] ${this._gettext("Could not export control interface")}: ${error}`,
      );
      this._dbus = null;
      return;
    }

    this._busNameId = Gio.bus_own_name(
      Gio.BusType.SESSION,
      DBUS_BUS_NAME,
      Gio.BusNameOwnerFlags.NONE,
      null,
      null,
      null,
    );
  }

  _unexportControlInterface() {
    if (this._busNameId) {
      Gio.bus_unown_name(this._busNameId);
      this._busNameId = 0;
    }
    if (!this._dbus) return;
    this._dbus.unexport();
    this._dbus = null;
  }

  Toggle() {
    if (!this._view) return;
    this._toggleLauncher();
  }

  Open() {
    if (!this._view) return;
    this._showLauncher();
  }

  Hide() {
    if (!this._view) return;
    this._hideLauncher();
  }

  Search(query) {
    if (!this._view) return;
    this._showLauncher();
    this._view.entryText = query ?? "";
  }

  _toggleLauncher() {
    const now = Date.now();
    if (now - this._lastToggleTime < TOGGLE_DEBOUNCE_MS) return;
    this._lastToggleTime = now;

    if (this._view.isVisible) this._hideLauncher();
    else this._showLauncher();
  }

  _focusedMonitor() {
    const focusWindow = global.display.focus_window;
    const index =
      focusWindow && focusWindow.get_monitor() >= 0
        ? focusWindow.get_monitor()
        : global.display.get_current_monitor();
    return (
      Main.layoutManager.monitors[index] ?? Main.layoutManager.primaryMonitor
    );
  }

  _showLauncher() {
    this._view.show(this._focusedMonitor());
    this._selectedIndex = 0;
    this._items = [];
  }

  _hideLauncher() {
    if (!this._view.isVisible) return;
    this._cancelSearchDebounce();
    if (this._files) this._files.cancel();
    this._view.hide();
  }

  _onQueryChanged() {
    if (!this._view.isVisible) return;
    this._scheduleSearch();
  }

  _scheduleSearch() {
    this._cancelSearchDebounce();
    this._debounceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      SEARCH_DEBOUNCE_MS,
      () => {
        this._debounceId = 0;
        this._runSearch();
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  _cancelSearchDebounce() {
    if (!this._debounceId) return;
    GLib.Source.remove(this._debounceId);
    this._debounceId = 0;
  }

  _runSearch() {
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

    const sources = this._collectSources(query, this._gettext);
    const wantsFiles = this._shouldSearchFiles(query, sources.apps.length);
    if (wantsFiles) {
      sources.files = this._files.interimMatches(query);
    }

    this._render(sources);
    if (wantsFiles) this._searchFiles(query, token, sources);
  }

  _collectSources(query, _) {
    const apps = makeAppItems(
      loadApps(Shell.AppSystem.get_default()),
      query,
      _,
    );
    const calculator = [makeCalcItem(query, _)].filter(Boolean);
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
            this._activateSelected();
          },
        }),
    );
  }

  _moveSelection(step) {
    const count = this._items.length;
    if (count === 0) return;
    this._selectedIndex = (this._selectedIndex + step + count) % count;
    this._view.setSelection(this._selectedIndex);
  }

  _activateSelected(mode = "background") {
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

    this._hideLauncher();
  }
}
