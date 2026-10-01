/*
 * Spotlight Launcher for GNOME, file search limits
 *
 * Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
 *
 * Licensed under the GNU GPL v3 or later.
 * See LICENSE file for details.
 *
 */

export const SCORE_CUTOFF = 300;

export const FILE_RESULT_LIMIT = 6;

export const SCAN_RESULT_LIMIT = 5;

export const PATH_RESULT_LIMIT = 8;

export const PATH_COLLECT_LIMIT = 9;

export const FOLDER_HEAD_SCORE = 3000;
export const LISTED_CHILD_SCORE = 2000;
export const FOLDER_SCORE_BONUS = 50;

export const INDEX_MATCH_LIMIT = 30;

export const INDEX_ROW_LIMIT = 30;

export const STAT_CONCURRENCY = 8;

/*
 * Filesystem-walk budget. The bounds are generous; the deadline is what
 * really stops the walk when nothing matches.
 */
export const SCAN_MAX_DEPTH = 4;
export const SCAN_MAX_VISITS = 4000;
export const SCAN_TIME_BUDGET_MS = 200;
export const SCAN_COLLECT_LIMIT = 10;

export const FILE_BATCH_SIZE = 64;

export const DIR_ATTRIBUTES = "standard::name,standard::type,standard::icon";
export const STAT_ATTRIBUTES = "standard::type,standard::icon";

export const TRACKER_BUS_NAME = "org.freedesktop.LocalSearch3";
export const TRACKER_OBJECT_PATH = "/org/freedesktop/Tracker3/Endpoint";
