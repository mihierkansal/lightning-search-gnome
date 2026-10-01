/*
 * Spotlight Launcher for GNOME, filesystem port
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

import Gio from "gi://Gio";

import {
  closeEnumerator,
  enumerateChildrenAsync,
  nextFilesAsync,
  queryInfoAsync,
} from "../promise-adapters.js";
import {
  DIR_ATTRIBUTES,
  FILE_BATCH_SIZE,
  STAT_ATTRIBUTES,
  STAT_CONCURRENCY,
} from "./constants.js";

export class GioFileSystem {
  async exists(path) {
    try {
      await queryInfoAsync(Gio.File.new_for_path(path), STAT_ATTRIBUTES);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async stat(path) {
    try {
      const info = await queryInfoAsync(
        Gio.File.new_for_path(path),
        STAT_ATTRIBUTES,
      );
      return {
        isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
        gicon: info.get_icon(),
      };
    } catch (_error) {
      return null;
    }
  }

  async listChildren(path, visit) {
    let enumerator = null;
    try {
      enumerator = await enumerateChildrenAsync(
        Gio.File.new_for_path(path),
        DIR_ATTRIBUTES,
      );
      for (;;) {
        const batch = await nextFilesAsync(enumerator, FILE_BATCH_SIZE);
        if (!batch || batch.length === 0) return;
        for (const info of batch) {
          const child = childEntry(info, path);
          if (child && !visit(child)) return;
        }
      }
    } catch (_error) {
    } finally {
      closeEnumerator(enumerator);
    }
  }
}

export async function statCandidates(fileSystem, items, token) {
  for (let start = 0; start < items.length; start += STAT_CONCURRENCY) {
    if (token?.isStale) return;
    const chunk = items.slice(start, start + STAT_CONCURRENCY);
    await Promise.all(
      chunk.map(async (item) => {
        const info = await fileSystem.stat(item.path);
        if (!info) return;
        item.type = info.isDirectory ? "folder" : "file";
        if (info.gicon) item.gicon = info.gicon;
      }),
    );
  }
}

function childEntry(info, parentPath) {
  const name = info.get_name();
  if (!name || name.startsWith(".")) return null;
  return {
    name,
    path: joinPath(parentPath, name),
    isDirectory: info.get_file_type() === Gio.FileType.DIRECTORY,
    gicon: info.get_icon(),
  };
}

function joinPath(parentPath, name) {
  return parentPath === "/" ? `/${name}` : `${parentPath}/${name}`;
}
