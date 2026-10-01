/*
 * Spotlight Launcher for GNOME, GIO / Tracker promise wrappers
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 * The async *-async() GIO and Tracker calls only report through callbacks, so
 * every wrapper here resolves a Promise instead.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

export function enumerateChildrenAsync(dir, attrs) {
  return new Promise((resolve, reject) => {
    dir.enumerate_children_async(
      attrs,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
      (_source, result) => {
        try {
          resolve(dir.enumerate_children_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

/** Rejects when the file doesn't exist. */
export function queryInfoAsync(file, attributes) {
  return new Promise((resolve, reject) => {
    file.query_info_async(
      attributes,
      Gio.FileQueryInfoFlags.NONE,
      GLib.PRIORITY_DEFAULT,
      null,
      (_source, result) => {
        try {
          resolve(file.query_info_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export function nextFilesAsync(enumerator, count) {
  return new Promise((resolve, reject) => {
    enumerator.next_files_async(
      count,
      GLib.PRIORITY_DEFAULT,
      null,
      (_source, result) => {
        try {
          resolve(enumerator.next_files_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}
export function trackerBusNewAsync(Tracker, serviceName, objectPath) {
  return new Promise((resolve, reject) => {
    Tracker.SparqlConnection.bus_new_async(
      serviceName,
      objectPath,
      null,
      null,
      (_source, result) => {
        try {
          resolve(Tracker.SparqlConnection.bus_new_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export function sparqlQueryAsync(connection, sparql) {
  return new Promise((resolve, reject) => {
    connection.query_async(sparql, null, (_source, result) => {
      try {
        resolve(connection.query_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function sparqlNextAsync(cursor) {
  return new Promise((resolve, reject) => {
    cursor.next_async(null, (_source, result) => {
      try {
        resolve(cursor.next_finish(result));
      } catch (error) {
        reject(error);
      }
    });
  });
}

export function cursorString(cursor, column) {
  const value = cursor.get_string(column);
  return Array.isArray(value) ? value[0] : value;
}

export function closeEnumerator(enumerator) {
  if (!enumerator) return;
  try {
    enumerator.close(null);
  } catch (_error) {}
}

export function closeCursor(cursor) {
  if (!cursor) return;
  try {
    if (typeof cursor.close === "function") cursor.close();
  } catch (_error) {}
}
