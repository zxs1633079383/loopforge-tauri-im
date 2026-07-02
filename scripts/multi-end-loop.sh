#!/usr/bin/env bash
# Multi-end verification loop for loopforge-tauri-im.
#
# Real path only:
#   Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> WS/HTTP -> projection -> DOM
#
# Usage:
#   scripts/multi-end-loop.sh
#   scripts/multi-end-loop.sh --list
#   scripts/multi-end-loop.sh --list --area MB
#   scripts/multi-end-loop.sh --area MB
#   scripts/multi-end-loop.sh --all
#   scripts/multi-end-loop.sh --l2
#   scripts/multi-end-loop.sh --spec test/specs/uc-6.1.e2e.mjs
#   scripts/multi-end-loop.sh --loop 3 --spec test/specs/uc-6.1.e2e.mjs --spec test/specs/uc-6.2.e2e.mjs
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELIX_ROOT="${HELIX_ROOT:-/System/Volumes/Data/workspace/rust/helix}"
CSES_IM_ROOT="${CSES_IM_ROOT:-/System/Volumes/Data/workspace/golang/cses-im-server}"
RUN_LOG_DIR="${RUN_LOG_DIR:-/tmp/loopforge}"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
ARCHIVE_ROOT="${ARCHIVE_ROOT:-/tmp/loopforge/runs}"
ARCHIVE_DIR="${ARCHIVE_DIR:-$ARCHIVE_ROOT/$RUN_ID}"
RUN_APIFOX=0
RUN_SCREENSHOT=0
RUN_ALL=0
RUN_L2=0
LIST_ONLY=0
AREA=""
CSES_LOG="${CSES_LOG:-/tmp/cses-im-server.log}"
LOOPS=1
SPECS=()
ARCHIVE_READY=0
FINALIZE_DONE=0
CURRENT_STAGE="init"
CURRENT_DETAIL=""

usage() {
  sed -n '1,22p' "$0"
}

append_specs_from_cmd() {
  local mode="$1"
  while IFS= read -r spec; do
    [ -n "$spec" ] && SPECS+=("$spec")
  done < <(cd "$ROOT" && node scripts/uc-spec-list.mjs $mode)
}

copy_if_exists() {
  local src="$1"
  local dst="$2"
  [ -f "$src" ] && cp "$src" "$dst" || true
}

clear_stale_run_artifacts() {
  rm -f \
    "$RUN_LOG_DIR/run-ng.log" \
    "$RUN_LOG_DIR/run-app.log" \
    "$RUN_LOG_DIR/run.jsonl" \
    "$RUN_LOG_DIR/wdio-out.log" \
    "$RUN_LOG_DIR/cses-health.json"
}

finalize_run() {
  local exit_code="${1:-0}"
  [ "$FINALIZE_DONE" = 0 ] || return 0
  FINALIZE_DONE=1
  [ "$ARCHIVE_READY" = 1 ] || return 0

  mkdir -p "$ARCHIVE_DIR"
  cat >"$ARCHIVE_DIR/run-status.txt" <<EOF
exit_code=$exit_code
stage=$CURRENT_STAGE
detail=$CURRENT_DETAIL
EOF

  copy_if_exists "$RUN_LOG_DIR/run-ng.log" "$ARCHIVE_DIR/run-ng.log"
  copy_if_exists "$RUN_LOG_DIR/run-app.log" "$ARCHIVE_DIR/run-app.log"
  copy_if_exists "$RUN_LOG_DIR/run.jsonl" "$ARCHIVE_DIR/run.jsonl"
  copy_if_exists "$RUN_LOG_DIR/wdio-out.log" "$ARCHIVE_DIR/wdio-out.log"
  copy_if_exists "$RUN_LOG_DIR/cses-health.json" "$ARCHIVE_DIR/cses-health.json"
  copy_if_exists "$CSES_LOG" "$ARCHIVE_DIR/cses-im-server.log"
  (cd "$ROOT" && node scripts/summarize-run-report.mjs --archive "$ARCHIVE_DIR" --out "$ARCHIVE_DIR/summary.md") || true
  echo "archive: $ARCHIVE_DIR"
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --loop)
      LOOPS="${2:-}"
      shift 2
      ;;
    --spec)
      SPECS+=("${2:-}")
      shift 2
      ;;
    --all)
      RUN_ALL=1
      shift
      ;;
    --l2)
      RUN_L2=1
      shift
      ;;
    --area)
      AREA="${2:-}"
      shift 2
      ;;
    --apifox)
      RUN_APIFOX=1
      shift
      ;;
    --screenshot)
      RUN_SCREENSHOT=1
      shift
      ;;
    --archive-dir)
      ARCHIVE_DIR="${2:-}"
      shift 2
      ;;
    --list)
      LIST_ONLY=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown arg: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! [[ "$LOOPS" =~ ^[0-9]+$ ]] || [ "$LOOPS" -lt 1 ]; then
  echo "--loop must be a positive integer" >&2
  exit 2
fi

if [ -n "$AREA" ]; then
  append_specs_from_cmd "--area $AREA"
fi
if [ "$RUN_ALL" = 1 ]; then
  append_specs_from_cmd "--list l1"
fi
if [ "$RUN_L2" = 1 ]; then
  append_specs_from_cmd "--list l2"
fi
if [ "$LIST_ONLY" = 1 ] && [ "${#SPECS[@]}" -eq 0 ]; then
  append_specs_from_cmd "--list all"
fi

if [ "$LIST_ONLY" = 1 ]; then
  printf '%s\n' "${SPECS[@]}"
  exit 0
fi

need_file() {
  [ -e "$1" ] || {
    echo "missing required path: $1" >&2
    exit 2
  }
}

tail_if_exists() {
  local label="$1"
  local file="$2"
  echo
  echo "== ${label}: ${file} =="
  if [ -f "$file" ]; then
    tail -n 80 "$file" || true
  else
    echo "(missing)"
  fi
}

need_file "$ROOT/package.json"
need_file "$ROOT/src-tauri/Cargo.toml"
need_file "$HELIX_ROOT/Cargo.toml"
need_file "$CSES_IM_ROOT"
mkdir -p "$RUN_LOG_DIR"
mkdir -p "$ARCHIVE_DIR"
clear_stale_run_artifacts
ARCHIVE_READY=1
trap 'rc=$?; trap - EXIT; finalize_run "$rc"; exit "$rc"' EXIT

echo "== multi-end roots =="
echo "loopforge: $ROOT"
echo "helix    : $HELIX_ROOT"
echo "go server: $CSES_IM_ROOT"
echo "logs     : $RUN_LOG_DIR, $CSES_LOG"

echo
echo "== backend health =="
if curl -sS -o "$RUN_LOG_DIR/cses-health.json" -w "%{http_code}" http://127.0.0.1:8066/api/cses/health | grep -q '^200$'; then
  echo "cses-im-server health OK"
else
  CURRENT_STAGE="backend-health"
  CURRENT_DETAIL="http://127.0.0.1:8066/api/cses/health"
  echo "cses-im-server health failed; start it with:" >&2
  echo "cd $CSES_IM_ROOT && CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json go run ./cmd/server > $CSES_LOG 2>&1" >&2
  exit 1
fi
if [ ! -f "$CSES_LOG" ]; then
  echo "warning: $CSES_LOG is missing; Go server is healthy but runtime log is not redirected"
fi

for ((i = 1; i <= LOOPS; i++)); do
  echo
  echo "== loop ${i}/${LOOPS}: static gates =="
  CURRENT_STAGE="static-gates"
  CURRENT_DETAIL="loop ${i}/${LOOPS}"
  (cd "$ROOT" && ./node_modules/.bin/tsc -p tsconfig.app.json --noEmit)
  (cd "$ROOT" && ./node_modules/.bin/ng build)
  (cd "$ROOT" && git diff --check)

  if [ "${#SPECS[@]}" -eq 0 ]; then
    echo "no --spec provided; skipped live WDIO run"
  else
    for spec in "${SPECS[@]}"; do
      CURRENT_STAGE="wdio"
      CURRENT_DETAIL="$spec"
      need_file "$ROOT/$spec"
      echo
      echo "== loop ${i}/${LOOPS}: live WDIO ${spec} =="
      (cd "$ROOT" && bash scripts/run.sh -- --spec "$spec")
    done
  fi

  if [ "$RUN_APIFOX" = 1 ]; then
    echo
    echo "== loop ${i}/${LOOPS}: Apifox HTTP suite =="
    CURRENT_STAGE="apifox"
    CURRENT_DETAIL="loop ${i}/${LOOPS}"
    if [ -z "${APIFOX_TOKEN:-}" ]; then
      echo "APIFOX_TOKEN is required for --apifox" >&2
      exit 2
    fi
    (cd "$ROOT" && python3 scripts/apifox-suite-create.py | tee "$ARCHIVE_DIR/apifox-create.log")
    APIFOX_CMD="$(grep -E '^apifox ' "$ARCHIVE_DIR/apifox-create.log" | tail -1)"
    if [ -z "$APIFOX_CMD" ]; then
      echo "scripts/apifox-suite-create.py did not print an apifox run command" >&2
      exit 1
    fi
    (cd "$ROOT" && bash -lc "$APIFOX_CMD" | tee "$ARCHIVE_DIR/apifox-run.log")
  fi

  if [ "$RUN_SCREENSHOT" = 1 ]; then
    echo
    echo "== loop ${i}/${LOOPS}: UI screenshots =="
    CURRENT_STAGE="screenshot"
    CURRENT_DETAIL="loop ${i}/${LOOPS}"
    need_file "$ROOT/scripts/capture-ui-screenshots.mjs"
    (cd "$ROOT" && node scripts/capture-ui-screenshots.mjs --out "$ARCHIVE_DIR")
  fi
done

CURRENT_STAGE="complete"
CURRENT_DETAIL="all requested gates passed"

echo
echo "== evidence tails =="
tail_if_exists "loopforge angular" "$RUN_LOG_DIR/run-ng.log"
tail_if_exists "loopforge tauri+helix" "$RUN_LOG_DIR/run-app.log"
tail_if_exists "loopforge structured hops" "$RUN_LOG_DIR/run.jsonl"
tail_if_exists "wdio" "$RUN_LOG_DIR/wdio-out.log"
tail_if_exists "cses-im-server" "$CSES_LOG"
