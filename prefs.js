/*
 * Lightning Search Launcher
 *
 * Copyright (C) 2026 Avimanyu Rimal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import Adw from "gi://Adw";
import { ShortcutSettingWidget } from "./shortcuts.js";

import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";

const DEFAULT_SELECTION_COLOR = "rgba(0, 122, 255, 0.9)";

const FUZZY_LEVELS = ["off", "balanced", "loose"];

function parseCssColor(css) {
  const rgba = new Gdk.RGBA();
  if (!rgba.parse(css)) rgba.parse(DEFAULT_SELECTION_COLOR);
  return rgba;
}

function toCssColor({ red, green, blue, alpha }) {
  const r = Math.round(red * 255);
  const g = Math.round(green * 255);
  const b = Math.round(blue * 255);
  const a = Math.round(alpha * 100) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default class Preferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const _ = this.gettext.bind(this);
    const settings = this.getSettings(
      "org.gnome.shell.extensions.lightning-search",
    );

    const fuzzyLevelLabels = [_("Off"), _("Balanced"), _("Loose")];

    const page = new Adw.PreferencesPage();
    const shortcutsGroup = new Adw.PreferencesGroup({
      title: _("Shortcut"),
      description: _("Choose your launcher shortcut."),
    });

    const shortcutRow = new Adw.ActionRow({
      title: _("Open launcher"),
      subtitle: _("Press this keybinding to open search"),
    });
    shortcutRow.add_suffix(
      new ShortcutSettingWidget(settings, "shortcut-key", _),
    );
    shortcutsGroup.add(shortcutRow);

    const panelGroup = new Adw.PreferencesGroup({
      title: _("Panel"),
      description: _("Top bar integration."),
    });
    const panelIconRow = new Adw.SwitchRow({
      title: _("Show search icon"),
      subtitle: _("Add a search button to the right of the top bar"),
    });
    panelIconRow.active = settings.get_boolean("show-panel-icon");
    panelIconRow.connect("notify::active", () => {
      settings.set_boolean("show-panel-icon", panelIconRow.active);
    });
    panelGroup.add(panelIconRow);

    const launcherGroup = new Adw.PreferencesGroup({
      title: _("Launcher"),
      description: _("Customize the launcher search box."),
    });
    const placeholderRow = new Adw.EntryRow({
      title: _("Placeholder text"),
      show_apply_button: true,
    });
    placeholderRow.text = settings.get_string("search-placeholder-text");
    placeholderRow.connect("apply", () => {
      settings.set_string("search-placeholder-text", placeholderRow.text);
    });
    launcherGroup.add(placeholderRow);

    const entryIconRow = new Adw.SwitchRow({
      title: _("Show search icon"),
      subtitle: _("Show the magnifying glass next to the search box"),
    });
    entryIconRow.active = settings.get_boolean("show-entry-icon");
    launcherGroup.add(entryIconRow);

    const entryIconSizeRow = new Adw.SpinRow({
      title: _("Search icon size"),
      subtitle: _("Resize the glyph without moving the search box text"),
      adjustment: new Gtk.Adjustment({
        lower: 12,
        upper: 28,
        step_increment: 1,
        page_increment: 2,
      }),
    });
    entryIconSizeRow.value = settings.get_int("entry-icon-size");
    entryIconSizeRow.sensitive = entryIconRow.active;
    entryIconSizeRow.connect("notify::value", () => {
      settings.set_int("entry-icon-size", Math.round(entryIconSizeRow.value));
    });
    entryIconRow.connect("notify::active", () => {
      settings.set_boolean("show-entry-icon", entryIconRow.active);
      entryIconSizeRow.sensitive = entryIconRow.active;
    });
    launcherGroup.add(entryIconSizeRow);

    const commandRunnerRow = new Adw.SwitchRow({
      title: _("Run terminal commands"),
      subtitle: _(
        "When the first word matches an executable on your PATH, run the line in the background (Ctrl + Enter for a terminal window)",
      ),
    });
    commandRunnerRow.active = settings.get_boolean("enable-command-runner");
    commandRunnerRow.connect("notify::active", () => {
      settings.set_boolean("enable-command-runner", commandRunnerRow.active);
    });
    launcherGroup.add(commandRunnerRow);

    const resultsGroup = new Adw.PreferencesGroup({
      title: _("Results"),
      description: _("How many results the launcher shows at a time."),
    });
    const appResultsRow = new Adw.SpinRow({
      title: _("Maximum application results"),
      subtitle: _("Application matches shown before the list scrolls"),
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 40,
        step_increment: 1,
        page_increment: 4,
      }),
    });
    appResultsRow.value = settings.get_int("app-result-limit");
    appResultsRow.connect("notify::value", () => {
      settings.set_int("app-result-limit", Math.round(appResultsRow.value));
    });
    resultsGroup.add(appResultsRow);

    const fileResultsRow = new Adw.SpinRow({
      title: _("Maximum file results"),
      subtitle: _(
        "File matches shown before the list scrolls; higher values can make file searches take slightly longer",
      ),
      adjustment: new Gtk.Adjustment({
        lower: 1,
        upper: 40,
        step_increment: 1,
        page_increment: 4,
      }),
    });
    fileResultsRow.value = settings.get_int("file-result-limit");
    fileResultsRow.connect("notify::value", () => {
      settings.set_int("file-result-limit", Math.round(fileResultsRow.value));
    });
    resultsGroup.add(fileResultsRow);

    const matchingGroup = new Adw.PreferencesGroup({
      title: _("Matching"),
      description: _("How loosely a typed query matches application names."),
    });
    const fuzzyRow = new Adw.ComboRow({
      title: _("Fuzzy matching"),
      subtitle: _(
        "Off matches letters in order only; Loose also matches initials",
      ),
      model: Gtk.StringList.new(fuzzyLevelLabels),
    });
    fuzzyRow.selected = Math.max(
      0,
      FUZZY_LEVELS.indexOf(settings.get_string("fuzzy-level")),
    );
    fuzzyRow.connect("notify::selected", () => {
      settings.set_string("fuzzy-level", FUZZY_LEVELS[fuzzyRow.selected]);
    });
    matchingGroup.add(fuzzyRow);

    const appearanceGroup = new Adw.PreferencesGroup({
      title: _("Appearance"),
      description: _("Colors used by the launcher."),
    });
    const selectionColorRow = new Adw.ActionRow({
      title: _("Selected result color"),
      subtitle: _("Background of the highlighted result row"),
    });
    const colorButton = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({ with_alpha: true }),
      rgba: parseCssColor(settings.get_string("selection-color")),
    });
    colorButton.valign = Gtk.Align.CENTER;
    colorButton.connect("notify::rgba", () => {
      settings.set_string("selection-color", toCssColor(colorButton.rgba));
    });
    selectionColorRow.add_suffix(colorButton);
    appearanceGroup.add(selectionColorRow);

    const selectionTextColorRow = new Adw.ActionRow({
      title: _("Selected result text color"),
      subtitle: _(
        "Title and subtitle text color of the highlighted result row",
      ),
    });
    const textColorButton = new Gtk.ColorDialogButton({
      dialog: new Gtk.ColorDialog({ with_alpha: true }),
      rgba: parseCssColor(settings.get_string("selection-text-color")),
    });
    textColorButton.valign = Gtk.Align.CENTER;
    textColorButton.connect("notify::rgba", () => {
      settings.set_string(
        "selection-text-color",
        toCssColor(textColorButton.rgba),
      );
    });
    selectionTextColorRow.add_suffix(textColorButton);
    appearanceGroup.add(selectionTextColorRow);

    const searchGroup = new Adw.PreferencesGroup({
      title: _("Search"),
      description: _("Engine used for the “Search web” fallback result."),
    });

    const engineRow = new Adw.EntryRow({
      title: _("Search engine URL"),
      show_apply_button: true,
    });
    engineRow.text = settings.get_string("search-engine-url");
    engineRow.connect("apply", () => {
      let url = engineRow.text.trim();
      if (url && !url.includes("%s")) url = `${url}%s`; // tolerate missing placeholder
      if (url && !/^https?:\/\//.test(url)) url = `https://${url}`;
      settings.set_string("search-engine-url", url);
      engineRow.text = url;
    });
    searchGroup.add(engineRow);

    const aboutGroup = new Adw.PreferencesGroup({
      title: _("About"),
    });
    const aboutRow = new Adw.ActionRow({
      title: this.metadata.name,
      subtitle: _("A fast search launcher for GNOME"),
    });
    const linkButton = new Gtk.LinkButton({
      label: _("Project page"),
      uri: "https://github.com/mihierkansal/lightning-search-gnome",
    });
    aboutRow.add_suffix(linkButton);
    aboutGroup.add(aboutRow);

    page.add(shortcutsGroup);
    page.add(panelGroup);
    page.add(launcherGroup);
    page.add(resultsGroup);
    page.add(matchingGroup);
    page.add(appearanceGroup);
    page.add(searchGroup);
    page.add(aboutGroup);
    window.add(page);
  }
}
