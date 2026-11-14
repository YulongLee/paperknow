#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=deploy-common.sh
source "$SCRIPT_DIR/deploy-common.sh"
[[ $# == 2 && $1 == --release && $2 =~ ^[a-f0-9]{7,40}$ ]] || die 'Usage: rollback.sh --release EXISTING_RELEASE_DIRECTORY_SHA'
NAME=$2
prepare
TARGET=$RELEASES/$NAME
validate_release "$TARGET"
if [[ "$TARGET" == "$PREVIOUS" ]]; then
  healthy "$TARGET" || die 'Selected release is not healthy.'
  log 'Selected release is already active.'
  exit 0
fi
log 'Rolling back code only. Database and environment are kept; confirm schema compatibility before using this command.'
ROLLBACK_STOPPED=1
systemctl stop paperknow.service || die 'Cannot stop current service; rollback was not attempted.'
rollback_compatible "$TARGET" || die 'Rollback blocked: this version cannot safely edit existing analysis drafts, or compatibility could not be checked. Use a compatible forward fix or reviewed migration.'
backup
activate "$TARGET"
ROLLBACK_STOPPED=0
