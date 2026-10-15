/*
 * Lightning Search Launcher, result rows
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

  const column = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
    x_expand: true,
  });
  const title = ellipsizedLabel(item.title, TITLE_STYLE);
  column.add_child(title);
  const subtitle = item.subtitle
    ? ellipsizedLabel(item.subtitle, SUBTITLE_STYLE)
    : null;
  if (subtitle) column.add_child(subtitle);
  rowBox.add_child(column);

  row.set_child(rowBox);
  row._rowState = {
    item,
    type: item.type,
    reusable: !item.gicon && item.type !== "app",
    column,
    title,
    subtitle,
  };
  row.connect("clicked", () => onActivate(row._rowState.item));
  row.updateItem = (next) => updateRow(row, next);
  return row;
}

function updateRow(row, item) {
  const view = row._rowState;
  if (!view || !view.reusable) return false;
  if (view.type !== item.type || item.gicon) return false;

  view.item = item;
  view.title.text = item.title;
  if (item.subtitle) {
    if (view.subtitle) view.subtitle.text = item.subtitle;
    else {
      view.subtitle = ellipsizedLabel(item.subtitle, SUBTITLE_STYLE);
      view.column.add_child(view.subtitle);
    }
  } else if (view.subtitle) {
    view.subtitle.destroy();
    view.subtitle = null;
  }
  return true;
}

export function buildIcon(item) {
  if (item.type === "app") return appIcon(item.appData);
  if (item.gicon) return themedIcon({ gicon: item.gicon });
  return fallbackIcon(item.type);
}

export function rowIconItems(apps) {
  const items = (apps ?? []).map((appData) => ({ type: "app", appData }));
  const built = new Set();
  for (const [type, iconName] of Object.entries(FALLBACK_ICONS)) {
    if (built.has(iconName)) continue;
    built.add(iconName);
    items.push({ type });
  }
  return items;
}

export function addRowIcons(container, items) {
  const icons = [];
  for (const item of items ?? []) {
    const icon = buildIcon(item);
    if (!icon) continue;
    container.add_child(icon);
    icons.push(icon);
  }
  return icons;
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
