#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
# shellcheck source=deploy-common.sh
source "$SCRIPT_DIR/deploy-common.sh"
REF=
if (( $# )); then
  [[ $# == 2 && $1 == --ref && $2 =~ ^[a-f0-9]{40}$ ]] || die 'Usage: release.sh [--ref FULL_40_CHARACTER_SHA]'
  REF=$2
fi
prepare
if [[ -z "$REF" ]]; then
  git_repo fetch --no-tags origin '+refs/heads/main:refs/remotes/origin/main'
  REF=$(git_repo rev-parse --verify 'refs/remotes/origin/main^{commit}')
fi
SHA=$(git_repo rev-parse --verify "$REF^{commit}") || die 'Requested commit is not present in the repository.'
TRUSTED=0
for branch in refs/remotes/origin/main refs/heads/workspace-release; do
  if git_repo show-ref --verify --quiet "$branch" && git_repo merge-base --is-ancestor "$SHA" "$branch"; then
    TRUSTED=1
  fi
done
(( TRUSTED == 1 )) || die 'Commit is not reachable from origin/main or the imported workspace-release branch.'
OLD_SHA=$(git_repo rev-parse --verify "$(basename -- "$PREVIOUS")^{commit}") || die 'Import the existing release commit into the repository before updating.'
if [[ "$SHA" == "$OLD_SHA" ]]; then
  healthy "$PREVIOUS" || die 'Current version exists but is not healthy.'
  log "This commit is already active: $SHA"
  exit 0
fi
git_repo merge-base --is-ancestor "$OLD_SHA" "$SHA" || die 'Refusing an older or divergent version. Use reviewed rollback for an existing release.'
TARGET=$RELEASES/$SHA
# systemd may consider an orderly SIGTERM a successful service stop. Its exit
# status alone therefore cannot prove that every build and test command finished.
# This marker is created only by the final command in a fresh private build tree.
BUILD_SUCCESS_MARKER=.paperknow-build-success
require_build_success() {
  local marker=$1/$BUILD_SUCCESS_MARKER
  [[ -f "$marker" && ! -L "$marker" ]] || die 'Build did not finish successfully; refusing to install or activate this release.'
  cmp -s -- "$marker" <(printf '%s\n' "$SHA") || die 'Build success metadata does not match the requested commit.'
}
if [[ -e "$TARGET" || -L "$TARGET" ]]; then
  validate_release "$TARGET"
  [[ -f "$TARGET/.paperknow-commit" && $(cat "$TARGET/.paperknow-commit") == "$SHA" ]] || die 'Existing release lacks matching build metadata.'
  require_build_success "$TARGET"
  log "Reusing prepared immutable release $SHA"
else
  BUILD_DIR=$(mktemp -d "$BASE/builds/build.XXXXXXXX")
  chown "$BUILD_USER:$BUILD_USER" "$BUILD_DIR"
  git_repo archive --format=tar "$SHA" | as_builder tar -x -C "$BUILD_DIR"
  [[ ! -e "$BUILD_DIR/.env" && ! -L "$BUILD_DIR/.env" && ! -e "$BUILD_DIR/.data" ]] || die 'Source archive contains local configuration or data.'
  [[ ! -e "$BUILD_DIR/$BUILD_SUCCESS_MARKER" && ! -L "$BUILD_DIR/$BUILD_SUCCESS_MARKER" ]] || die 'Source archive contains reserved build success metadata.'
  log "Building $SHA as the isolated build account"
  BUILD_UNIT=paperknow-build-${SHA:0:12}-$$.service
  systemd-run --unit="$BUILD_UNIT" --wait --pipe --collect --service-type=exec \
    --property=User="$BUILD_USER" --property=Group="$BUILD_USER" \
    --property=WorkingDirectory="$BUILD_DIR" --property=CPUQuota=100% \
    --property=MemoryHigh=768M --property=MemoryMax=1G --property=TasksMax=128 --property=Nice=10 \
    --property=IOSchedulingClass=best-effort --property=IOSchedulingPriority=7 \
    --property=NoNewPrivileges=true --property=ProtectSystem=strict \
    --property=ProtectHome=true --property=PrivateTmp=true \
    --property="ReadWritePaths=$BUILD_DIR $BUILD_HOME" \
    /usr/bin/env -i HOME="$BUILD_HOME" PATH="$RUNTIME:/usr/bin:/bin" \
    npm_config_cache="$BUILD_HOME/npm-cache" NODE_ENV=development \
    /bin/bash -c 'npm ci --no-audit --no-fund && npm run build && npm run check && npm test && npm prune --omit=dev --no-audit --no-fund && printf "%s\n" "$1" > .paperknow-build-success' paperknow-build "$SHA"
  BUILD_UNIT=
  require_build_success "$BUILD_DIR"
  [[ ! -e "$BUILD_DIR/.env" && ! -L "$BUILD_DIR/.env" && ! -e "$BUILD_DIR/.data" ]] || die 'Build unexpectedly created local configuration or data.'
  INCOMING=$(mktemp -d "$RELEASES/.incoming.XXXXXXXX")
  cp -a -- "$BUILD_DIR/." "$INCOMING/"
  printf '%s\n' "$SHA" > "$INCOMING/.paperknow-commit"
  chown -hR root:root "$INCOMING"
  chmod -R a+rX,go-w "$INCOMING"
  require_build_success "$INCOMING"
  mv -T -- "$INCOMING" "$TARGET"
  INCOMING=
fi
backup
activate "$TARGET"
if [[ -f "$SCRIPT_DIR/retention.py" ]]; then
  # A cleanup failure must never roll back a healthy release. The daily timer retries.
  # Release retention uses the same lock, so run after releasing our inherited FD.
  flock -u 9
  /usr/bin/python3 -I "$SCRIPT_DIR/retention.py" --apply || log 'Release retention deferred; inspect the retention timer.'
fi
log 'Only paperknow.service was restarted; other services and Nginx were unchanged.'
