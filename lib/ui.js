/*
 * Lightning Search, result rows
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Clutter from "gi://Clutter";
import Pango from "gi://Pango";
import St from "gi://St";

const ICON_SIZE = 32;

const ROW_STYLE = "lightning-result-row";
const ROW_STYLE_SELECTED = `${ROW_STYLE} selected`;
const TITLE_STYLE = "lightning-result-title";
const SUBTITLE_STYLE = "lightning-result-subtitle";
const ICON_STYLE = "lightning-result-icon";

const FALLBACK_ICONS = {
  file: "text-x-generic",
  folder: "folder",
  web: "web-browser",
  url: "web-browser",
  calc: "accessories-calculator",
  command: "utilities-terminal",
};

export function buildRow(item, { selected, onActivate }) {
  const row = new St.Button({
    x_expand: true,
    can_focus: false,
    reactive: true,
    style_class: selected ? ROW_STYLE_SELECTED : ROW_STYLE,
  });

  const rowBox = new St.BoxLayout({
    orientation: Clutter.Orientation.HORIZONTAL,
    x_expand: true,
  });
  const icon = buildIcon(item);
  if (icon) rowBox.add_child(icon);
  rowBox.add_child(textColumn(item));

  row.set_child(rowBox);
  row.connect("clicked", onActivate);
  return row;
}

export function buildIcon(item) {
  if (item.type === "app") return appIcon(item.appData);
  if (item.gicon) return themedIcon({ gicon: item.gicon });
  return fallbackIcon(item.type);
}

function appIcon(appData) {
  if (!appData) return fallbackIcon("app");

  if (appData.shellApp) {
    const texture = createAppTexture(appData.shellApp);
    if (texture) return texture;
  }
  try {
    const gicon = appData.desktopInfo.get_icon();
    if (gicon) return themedIcon({ gicon });
  } catch (_error) {}
  return null;
}

function createAppTexture(shellApp) {
  try {
    const texture = shellApp.create_icon_texture(ICON_SIZE);
    if (texture) texture.add_style_class_name(ICON_STYLE);
    return texture;
  } catch (_error) {
    return null;
  }
}

function themedIcon(props) {
  return new St.Icon({
    icon_size: ICON_SIZE,
    style_class: ICON_STYLE,
    ...props,
  });
}

function fallbackIcon(type) {
  const iconName = FALLBACK_ICONS[type];
  return iconName ? themedIcon({ icon_name: iconName }) : null;
}

function textColumn(item) {
  const column = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    x_expand: true,
  });
  column.add_child(ellipsizedLabel(item.title, TITLE_STYLE));
  if (item.subtitle)
    column.add_child(ellipsizedLabel(item.subtitle, SUBTITLE_STYLE));
  return column;
}

function ellipsizedLabel(text, styleClass) {
  const label = new St.Label({
    text,
    x_align: Clutter.ActorAlign.START,
    style_class: styleClass,
  });
  label.clutter_text.set_single_line_mode(true);
  label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
  return label;
}
