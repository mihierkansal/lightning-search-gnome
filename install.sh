#!/usr/bin/env bash

set -euo pipefail
 
EXTENSION_UUID="lightning-search@mihierkansal.github.io"
SCHEMA_ID="org.gnome.shell.extensions.lightning-search"

EXT_SRC_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EXT_DEST_DIR="${XDG_DATA_HOME:-${HOME}/.local/share}/gnome-shell/extensions/${EXTENSION_UUID}"
SCHEMA_COMPILED="${EXT_DEST_DIR}/schemas/gschemas.compiled"
EXT_BIN_DIR="${XDG_BIN_HOME:-${HOME}/.local/bin}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { printf '%b\n' "${GREEN}==> ${NC}$1"; }
warn()  { printf '%b\n' "${YELLOW}==> ${NC}$1"; }
error() { printf '%b\n' "${RED}==> ${NC}$1" >&2; }
die()   { error "$1"; exit 1; }
 
info "Installing ${EXTENSION_UUID} for user ${USER}"

for cmd in glib-compile-schemas gnome-extensions; do
  command -v "$cmd" >/dev/null 2>&1 || die "Required command '$cmd' not found in PATH."
done 

info "Compiling GSettings schemas..."
mkdir -p "${EXT_DEST_DIR}/schemas"
glib-compile-schemas "${EXT_SRC_DIR}/schemas" --targetdir="$(dirname "${SCHEMA_COMPILED}")"
 
info "Copying extension files..."
install -D -m 0644 \
  "${EXT_SRC_DIR}/extension.js" \
  "${EXT_SRC_DIR}/prefs.js" \
  "${EXT_SRC_DIR}/shortcuts.js" \
  "${EXT_SRC_DIR}/stylesheet.css" \
  "${EXT_SRC_DIR}/metadata.json" \
  -t "${EXT_DEST_DIR}/"

info "Copying lib modules..."
install -d "${EXT_DEST_DIR}/lib/search"
install -m 0644 "${EXT_SRC_DIR}"/lib/*.js -t "${EXT_DEST_DIR}/lib/"
install -m 0644 "${EXT_SRC_DIR}"/lib/search/*.js -t "${EXT_DEST_DIR}/lib/search/"

info "Installing the lightning-search command..."
mkdir -p "${EXT_BIN_DIR}"
install -m 0755 "${EXT_SRC_DIR}/bin/lightning-search" -t "${EXT_BIN_DIR}"
case ":${PATH}:" in
  *":${EXT_BIN_DIR}:"*) ;;
  *) warn "${EXT_BIN_DIR} is not in your PATH; add it to use the lightning-search command." ;;
esac

info "Installed to: ${EXT_DEST_DIR}"
echo
echo "  Log out and back in."
echo "  Open the Extension Manager, toggle the extension ON under Lightning Search Launcher, click the gear icon, and choose your preferred keyboard shortcut. Or if you want to stick with the defaults just run ./enable.sh after logging back in."
echo "  Once enabled, you can also open the launcher from the terminal with: lightning-search"
echo
info "Done."
