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
backup
activate "$TARGET"
