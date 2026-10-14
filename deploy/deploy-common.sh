#!/usr/bin/env bash
# Sourced only by the root-owned release/rollback scripts installed in bin/.
set -Eeuo pipefail
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
umask 077
BASE=/opt/paperknow
REPO=$BASE/repository
RELEASES=$BASE/releases
BUILD_HOME=$BASE/build-home
BUILD_USER=paperknow-build
RUNTIME=$BASE/runtime/bin
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
PREVIOUS=
SWITCHED=0
BUILD_DIR=
BUILD_UNIT=
INCOMING=

die() { printf 'PaperKnow: %s\n' "$*" >&2; exit 1; }
log() { printf 'PaperKnow: %s\n' "$*"; }

as_builder() {
  runuser -u "$BUILD_USER" -- env -i HOME="$BUILD_HOME" \
    PATH="$RUNTIME:/usr/bin:/bin" GIT_TERMINAL_PROMPT=0 \
    npm_config_cache="$BUILD_HOME/npm-cache" NODE_ENV=development \
    nice -n 10 ionice -c 2 -n 7 "$@"
}

git_repo() {
  as_builder git -c http.lowSpeedLimit=1024 -c http.lowSpeedTime=60 --git-dir="$REPO" "$@"
}

validate_release() {
  local candidate=$1 name
  name=$(basename -- "$candidate")
  [[ "$name" =~ ^[a-f0-9]{7,40}$ ]] || die 'Release directory must be named with its Git commit.'
  [[ "$candidate" == "$RELEASES/$name" && -d "$candidate" && ! -L "$candidate" ]] || die 'Invalid release directory.'
  [[ $(stat -c '%u' "$candidate") == 0 ]] || die 'Release directory must be owned by root.'
  [[ -f "$candidate/server.mjs" && -f "$candidate/package-lock.json" ]] || die 'Release is incomplete.'
}

atomic_link() {
  local target=$1 temporary=$BASE/.current.$$
  [[ ! -e "$temporary" && ! -L "$temporary" ]] || return 1
  ln -s -- "$target" "$temporary" || return 1
  if ! mv -Tf -- "$temporary" "$BASE/current"; then
    rm -f -- "$temporary"
    return 1
  fi
}

healthy() {
  local expected=$1 pid attempt
  for attempt in {1..20}; do
    pid=$(systemctl show --property=MainPID --value paperknow.service 2>/dev/null || true)
    if [[ "$pid" =~ ^[1-9][0-9]*$ ]] && \
       [[ $(readlink -f -- "/proc/$pid/cwd" 2>/dev/null || true) == "$expected" ]] && \
       systemctl is-active --quiet paperknow.service && \
       curl --silent --show-error --fail --max-time 3 http://127.0.0.1:5173/api/capabilities 2>/dev/null | \
       /usr/bin/python3 -I -c 'import json,sys; v=json.load(sys.stdin); sys.exit(0 if v.get("account") is True and v.get("maxFileBytes")==2097152 else 1)' 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  return 1
}

finish() {
  local code=$?
  trap - EXIT HUP INT TERM
  set +e
  if [[ -n "$BUILD_UNIT" ]]; then
    systemctl stop "$BUILD_UNIT" >/dev/null 2>&1
  fi
  if (( code != 0 && SWITCHED == 1 )); then
    printf 'PaperKnow: deployment failed; restoring previous code link %s\n' "$PREVIOUS" >&2
    if atomic_link "$PREVIOUS" && systemctl restart paperknow.service && healthy "$PREVIOUS"; then
      printf 'PaperKnow: previous code is healthy. Database and environment were not restored.\n' >&2
    else
      printf 'PaperKnow: previous code could not be verified; inspect only paperknow.service logs.\n' >&2
    fi
    printf 'PaperKnow: database migrations are not reversed automatically; use the snapshot only after reviewing compatibility.\n' >&2
  fi
  [[ -z "$BUILD_DIR" || "$BUILD_DIR" != "$BASE/builds/"* ]] || rm -rf -- "$BUILD_DIR"
  [[ -z "$INCOMING" || "$INCOMING" != "$RELEASES/.incoming."* ]] || rm -rf -- "$INCOMING"
  exit "$code"
}

prepare() {
  [[ $EUID == 0 ]] || die 'Run the installed script with sudo.'
  local directory
  for directory in "$BASE" "$RELEASES" "$BASE/backups" "$BASE/builds" "$BUILD_HOME" "$REPO"; do
    [[ -d "$directory" && ! -L "$directory" ]] || die "Missing dedicated directory: $directory"
  done
  [[ $(stat -c '%u' "$BASE") == 0 && $(stat -c '%u' "$RELEASES") == 0 ]] || die 'Application and releases directories must be root-owned.'
  local available_kib
  available_kib=$(df -Pk / "$BASE" /var/lib/paperknow | awk 'NR>1 {if(min=="" || $4<min) min=$4} END {print min}')
  [[ "$available_kib" =~ ^[0-9]+$ ]] && (( available_kib >= 2097152 )) || die 'At least 2 GiB free disk space is required; no code was switched.'
  [[ $(id -u "$BUILD_USER") != 0 ]] || die 'Invalid build account.'
  [[ -x "$RUNTIME/node" && -x "$RUNTIME/npm" ]] || die 'The isolated Node runtime is missing.'
  [[ -L "$BASE/current" ]] || die 'Current release must be a symbolic link.'
  [[ ! -L "$BASE/.deploy.lock" ]] || die 'Invalid deployment lock.'
  exec 9>"$BASE/.deploy.lock"
  flock -n 9 || die 'Another PaperKnow deployment or rollback is running.'
  PREVIOUS=$(readlink -f -- "$BASE/current")
  validate_release "$PREVIOUS"
  [[ $(git_repo rev-parse --is-bare-repository) == true ]] || die 'The dedicated repository must be bare.'
  [[ $(git_repo remote get-url origin) == 'https://github.com/YulongLee/paperknow.git' ]] || die 'Unexpected origin repository.'
  trap finish EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
}

backup() {
  local destination
  destination=$(/usr/bin/python3 -I "$SCRIPT_DIR/backup.py") || die 'Snapshot failed; code was not switched.'
  log "Snapshot saved: $destination"
}

activate() {
  local target=$1
  # Mark before switching so a signal between rename and assignment is recoverable.
  SWITCHED=1
  atomic_link "$target" || die 'Cannot switch current release.'
  systemctl restart paperknow.service || die 'PaperKnow failed to restart.'
  healthy "$target" || die 'PaperKnow health check failed.'
  SWITCHED=0
  log "Active and healthy: $target"
}
