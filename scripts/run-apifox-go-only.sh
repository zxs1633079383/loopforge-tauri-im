#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ "${1:-}" = "--dry-run" ]; then
  echo "APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox"
  exit 0
fi

if [ -z "${APIFOX_TOKEN:-}" ]; then
  echo "APIFOX_TOKEN is required. Export it in the shell environment; do not put it in this script or git-tracked files." >&2
  exit 2
fi

export APIFOX_PROFILE=go-only
exec bash "$ROOT/scripts/multi-end-loop.sh" --apifox "$@"
