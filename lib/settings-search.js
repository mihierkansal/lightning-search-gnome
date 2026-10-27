/*
 * Lightning Search Launcher, settings search
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 */

import Gio from "gi://Gio";

const PANEL_DESKTOP_RE = /^gnome-.+-panel\.desktop$/;

/** The Settings app icon, so the row matches the other app icons. */
const SETTINGS_ICON = Gio.ThemedIcon.new_from_names([
  "org.gnome.Settings",
  "preferences-system",
]);

let panels = null;

export function loadSettingsPanels() {
  if (panels) return panels;

  panels = [];
  for (const info of Gio.AppInfo.get_all()) {
    const id = info.get_id();
    if (!id || !PANEL_DESKTOP_RE.test(id)) continue;

    const title = info.get_name() || "";
    if (title === "") continue;

    let keywords = [];
    try {
      keywords = info.get_keywords() ?? [];
    } catch (_error) {}

    const description = info.get_description() || "";
    panels.push({
      info,
      title,
      description,
      name: normalize(title),
      keywords: normalize(keywords.join(" ")),
      summary: normalize(description),
    });
  }
  return panels;
}

export function makeSettingItem(query) {
  const terms = normalize(query)
    .split(" ")
    .filter((term) => term !== "");
  if (terms.length === 0) return null;

  const compactQuery = terms.join("");
  let best = null;
  let bestScore = 0;

  for (const panel of loadSettingsPanels()) {
    const score = scorePanel(panel, terms, compactQuery);
    if (score > bestScore) {
      best = panel;
      bestScore = score;
    }
  }
  if (!best) return null;

  return {
    type: "setting",
    title: best.title,
    subtitle: best.description,
    panelInfo: best.info,
    gicon: SETTINGS_ICON,
  };
}

export function activateSetting(item) {
  try {
    item.panelInfo?.launch([], null);
  } catch (error) {
    console.error(
      `[Lightning Search Launcher] Could not open settings panel: ${error}`,
    );
  }
}

function scorePanel(panel, terms, compactQuery) {
  let total = 0;
  for (const term of terms) {
    const score = bestTermScore(panel, term);
    if (score === 0) return 0;
    total += score;
  }

  const compactName = panel.name.replace(/ /g, "");
  if (compactName === compactQuery) total += 1200;
  else if (compactName.startsWith(compactQuery)) total += 600;
  else if (compactName.includes(compactQuery)) total += 300;

  return total;
}

function bestTermScore(panel, term) {
  const fields = [
    [panel.name, 1000],
    [panel.keywords, 500],
    [panel.summary, 250],
  ];

  let best = 0;
  for (const [text, weight] of fields) {
    const index = text.indexOf(term);
    if (index === -1) continue;
    const boundary = index === 0 || text[index - 1] === " ";
    best = Math.max(best, weight + (boundary ? weight * 0.2 : 0));
  }
  return best;
}

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
