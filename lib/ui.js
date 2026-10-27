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

import { defaultBrowserIcon } from "./browser-icon.js";

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
  setting: "org.gnome.Settings",
};

/** Rows that hand a link to the default browser instead of opening a file. */
const LINK_TYPES = new Set(["web", "url"]);

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
    rowBox,
    icon,
    iconKey: iconKeyFor(item),
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
  if (!view) return false;
  if (view.type !== item.type) return false;

  const key = iconKeyFor(item);
  if (key !== view.iconKey) {
    if (!applyIcon(view, item)) {
      const icon = buildIcon(item);
      if (view.icon) view.rowBox.remove_child(view.icon);
      if (icon) view.rowBox.insert_child_at_index(icon, 0);
      if (view.icon) view.icon.destroy();
      view.icon = icon;
    }
    view.iconKey = key;
  }

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

function applyIcon(view, item) {
  if (!view.icon || typeof view.icon.set_gicon !== "function") return false;
  try {
    if (item.type === "app") {
      const gicon = item.appData?.desktopInfo?.get_icon?.();
      if (!gicon) return false;
      view.icon.set_gicon(gicon);
      return true;
    }
    if (item.gicon) {
      view.icon.set_gicon(item.gicon);
      return true;
    }
  } catch (_error) {}
  return false;
}

function iconKeyFor(item) {
  if (item.type === "app") return `app:${item.appData?.id ?? item.title}`;
  if (item.gicon) return `gicon:${item.gicon.to_string?.() ?? item.gicon}`;
  return `type:${item.type}`;
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
  if (!iconName) return null;

  if (LINK_TYPES.has(type)) {
    const gicon = defaultBrowserIcon();
    if (gicon) return themedIcon({ gicon, fallback_icon_name: iconName });
  }

  return themedIcon({ icon_name: iconName });
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
