/*
 * Lightning Search Launcher
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

import { clearCommandCache } from "./lib/commands.js";
import { ControlInterface } from "./lib/dbus-control.js";
import { FALLBACK_SHORTCUT, preferredShortcut } from "./lib/keybindings.js";
import { KeyboardShortcuts } from "./lib/keyboard-shortcuts.js";
import { LauncherView } from "./lib/launcher-view.js";
import { getPanelButton } from "./lib/panel-button.js";
import { SearchController } from "./lib/search-controller.js";
import { SettingsBindings } from "./lib/settings-bindings.js";
import { setFuzzyLevel } from "./lib/score.js";

const TOGGLE_DEBOUNCE_MS = 200;

// Fallback; the user-visible name comes from metadata.json (this.metadata.name).
const FALLBACK_NAME = "Lightning Search Launcher";
const SCHEMA_ID = "org.gnome.shell.extensions.lightning-search";
const PANEL_BUTTON_ROLE = "lightning-search";

export default class LightningSearchExtension extends Extension {
  get _displayName() {
    return this.metadata?.name ?? FALLBACK_NAME;
  }

  enable() {
    this._gettext = this.gettext.bind(this);
    this._settings = this.getSettings(SCHEMA_ID);
    clearCommandCache();
    setFuzzyLevel(this._settings.get_string("fuzzy-level"));

    this._view = new LauncherView(
      this._settings.get_string("search-placeholder-text"),
    );
    this._view.selectionColor = this._settings.get_string("selection-color");
    this._view.selectionTextColor = this._settings.get_string(
      "selection-text-color",
    );
    this._syncEntryIcon();

    this._search = new SearchController({
      view: this._view,
      settings: this._settings,
      gettext: this._gettext,
      displayName: this._displayName,
      onHide: () => this._hideLauncher(),
    });
    this._view.handlers = {
      onQueryChanged: () => this._search.queryChanged(),
      onActivationRequested: (mode) => this._search.activateSelected(mode),
      onSelectionMoved: (step) => this._search.moveSelection(step),
      onDismissRequested: () => this._hideLauncher(),
    };

    this._shortcuts = new KeyboardShortcuts();
    this._shortcuts.enable();
    this._bindShortcuts();
    this._connectSettings();

    this._panelButton = null;
    this._syncPanelButton();

    this._lastToggleTime = 0;

    this._control = new ControlInterface({
      onToggle: () => this._view && this._toggleLauncher(),
      onOpen: () => this._view && this._showLauncher(),
      onHide: () => this._view && this._hideLauncher(),
      onSearch: (query) => this._showQuery(query),
    });
    const controlError = this._control.enable();
    if (controlError) {
      console.error(
        `[${this._displayName}] ${this._gettext("Could not export control interface")}: ${controlError}`,
      );
    }
  }

  disable() {
    this._search?.dispose();
    this._search = null;
    this._control?.disable();
    this._control = null;
    this._settingsBindings?.disconnectAll();
    this._settingsBindings = null;
    this._removePanelButton();
    if (this._shortcuts) {
      this._shortcuts.disable();
      this._shortcuts = null;
    }
    this._view.destroy();
    this._view = null;
    this._settings = null;
  }

  _connectSettings() {
    const bindings = new SettingsBindings(this._settings);
    bindings.add("shortcut-key", () => this._bindShortcuts());
    bindings.add("search-placeholder-text", () => this._syncPlaceholderText());
    bindings.add("selection-color", () => this._syncSelectionColor());
    bindings.add("selection-text-color", () => this._syncSelectionTextColor());
    bindings.add("show-entry-icon", () => this._syncEntryIcon());
    bindings.add("entry-icon-size", () => this._syncEntryIcon());
    bindings.add("fuzzy-level", () => this._syncFuzzyLevel());
    bindings.add("enable-command-runner", () => this._search.refresh());
    bindings.add("app-result-limit", () => this._syncResultLimits());
    bindings.add("file-result-limit", () => this._syncResultLimits());
    bindings.add("show-panel-icon", () => this._syncPanelButton());
    this._settingsBindings = bindings;
  }

  _bindShortcuts() {
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

  _syncPlaceholderText() {
    if (this._view)
      this._view.placeholderText = this._settings.get_string(
        "search-placeholder-text",
      );
  }

  _syncSelectionColor() {
    if (this._view)
      this._view.selectionColor = this._settings.get_string("selection-color");
  }

  _syncSelectionTextColor() {
    if (this._view)
      this._view.selectionTextColor = this._settings.get_string(
        "selection-text-color",
      );
  }

  _syncEntryIcon() {
    if (!this._view) return;
    this._view.entryIconVisible = this._settings.get_boolean("show-entry-icon");
    this._view.entryIconSize = this._settings.get_int("entry-icon-size");
  }

  _syncFuzzyLevel() {
    setFuzzyLevel(this._settings.get_string("fuzzy-level"));
    this._search?.refresh();
  }

  _syncResultLimits() {
    this._search.setAppResultLimit(this._settings.get_int("app-result-limit"));
    this._search.setFileResultLimit(
      this._settings.get_int("file-result-limit"),
    );
    this._search.refresh();
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

  _showQuery(query) {
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
    this._search.reset();
  }

  _hideLauncher() {
    if (!this._view.isVisible) return;
    this._search.cancel();
    this._view.hide();
  }
}
