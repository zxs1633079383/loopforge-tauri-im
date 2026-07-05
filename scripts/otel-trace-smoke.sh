#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TRACE_ID="${1:-}"
if [[ -z "$TRACE_ID" ]]; then
  echo "usage: scripts/otel-trace-smoke.sh <trace-id-from-client-log>" >&2
  exit 2
fi

exec node "$ROOT/scripts/otel-trace-check.mjs" "$TRACE_ID"
