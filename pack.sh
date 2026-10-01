#!/usr/bin/env bash
#
# Lightning Search, packaging for extensions.gnome.org
#
# Copyright (C) 2026 Avimanyu Rimal, Mihier Kansal
#
# Licensed under the GNU GPL v3 or later.
# See LICENSE file for details.
#
# Usage: ./pack.sh [OUTPUT_DIRECTORY]
# 
set -euo pipefail

EXTENSION_UUID="lightning-search@mihierkansal.github.io"

EXT_SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-${EXT_SRC_DIR}}"

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

info()  { printf '%b\n' "${GREEN}==> ${NC}$1"; }
die()   { printf '%b\n' "${RED}==> ${NC}$1" >&2; exit 1; }

command -v gnome-extensions >/dev/null 2>&1 \
  || die "Required command 'gnome-extensions' not found in PATH."

mkdir -p "${OUT_DIR}"

info "Packing ${EXTENSION_UUID}" 
gnome-extensions pack "${EXT_SRC_DIR}" \
  --force \
  --out-dir="${OUT_DIR}" \
  --extra-source=shortcuts.js \
  --extra-source=lib \
  --extra-source=LICENSE \
  --extra-source=NOTICE

PACK="${OUT_DIR}/${EXTENSION_UUID}.shell-extension.zip"
info "Created ${PACK}"
echo
echo "  Upload this file at https://extensions.gnome.org/upload/"
echo
