/*
 * Spotlight Launcher for GNOME
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
const FUZZY_LEVEL_LABELS = ["Off", "Balanced", "Loose"];

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
    const settings = this.getSettings(
      "org.gnome.shell.extensions.lightning-launcher",
    );

    const page = new Adw.PreferencesPage();
    const shortcutsGroup = new Adw.PreferencesGroup({
      title: "Shortcut",
      description: "Choose your launcher shortcut.",
    });

    const shortcutRow = new Adw.ActionRow({
      title: "Open launcher",
      subtitle: "Press this keybinding to open search",
    });
    shortcutRow.add_suffix(new ShortcutSettingWidget(settings, "shortcut-key"));
    shortcutsGroup.add(shortcutRow);

    const panelGroup = new Adw.PreferencesGroup({
      title: "Panel",
      description: "Top bar integration.",
    });
    const panelIconRow = new Adw.SwitchRow({
      title: "Show search icon",
      subtitle: "Add a search button to the right of the top bar",
    });
    panelIconRow.active = settings.get_boolean("show-panel-icon");
    panelIconRow.connect("notify::active", () => {
      settings.set_boolean("show-panel-icon", panelIconRow.active);
    });
    panelGroup.add(panelIconRow);

    const launcherGroup = new Adw.PreferencesGroup({
      title: "Launcher",
      description: "Customize the launcher search box.",
    });
    const placeholderRow = new Adw.EntryRow({
      title: "Placeholder text",
      show_apply_button: true,
    });
    placeholderRow.text = settings.get_string("search-placeholder-text");
    placeholderRow.connect("apply", () => {
      settings.set_string("search-placeholder-text", placeholderRow.text);
    });
    launcherGroup.add(placeholderRow);

    const entryIconRow = new Adw.SwitchRow({
      title: "Show search icon",
      subtitle: "Show the magnifying glass next to the search box",
    });
    entryIconRow.active = settings.get_boolean("show-entry-icon");
    launcherGroup.add(entryIconRow);

    const entryIconSizeRow = new Adw.SpinRow({
      title: "Search icon size",
      subtitle: "Resize the glyph without moving the search box text",
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

    const matchingGroup = new Adw.PreferencesGroup({
      title: "Matching",
      description: "How loosely a typed query matches application names.",
    });
    const fuzzyRow = new Adw.ComboRow({
      title: "Fuzzy matching",
      subtitle:
        "Off matches letters in order only; Loose also matches initials",
      model: Gtk.StringList.new(FUZZY_LEVEL_LABELS),
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
      title: "Appearance",
      description: "Colors used by the launcher.",
    });
    const selectionColorRow = new Adw.ActionRow({
      title: "Selected result color",
      subtitle: "Background of the highlighted result row",
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

    const searchGroup = new Adw.PreferencesGroup({
      title: "Search",
      description: "Engine used for the “Search web” fallback result.",
    });

    const engineRow = new Adw.EntryRow({
      title: "Search engine URL",
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
      title: "About",
    });
    const aboutRow = new Adw.ActionRow({
      title: "Spotlight Launcher for GNOME",
      subtitle: "JS-only GNOME launcher shortcut extension",
    });
    const linkButton = new Gtk.LinkButton({
      label: "Project page",
      uri: "https://github.com/mihierkansal/lightning-gnome-launcher-extension",
    });
    aboutRow.add_suffix(linkButton);
    aboutGroup.add(aboutRow);

    page.add(shortcutsGroup);
    page.add(panelGroup);
    page.add(launcherGroup);
    page.add(matchingGroup);
    page.add(appearanceGroup);
    page.add(searchGroup);
    page.add(aboutGroup);
    window.add(page);
  }
}
