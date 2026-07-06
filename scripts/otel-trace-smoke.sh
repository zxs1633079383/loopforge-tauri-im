#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

TRACE_ID="${1:-}"
if [[ -z "$TRACE_ID" ]]; then
  echo "usage: scripts/otel-trace-smoke.sh <trace-id-from-client-log>" >&2
  exit 2
fi

node "$ROOT/scripts/otel-trace-check.mjs" "$TRACE_ID"

TRACE_JSONL="${LOOPFORGE_TRACE_JSONL:-/tmp/loopforge-trace/events.jsonl}"
node "$ROOT/scripts/trace-jsonl-check.mjs" --input "$TRACE_JSONL" --trace-id "$TRACE_ID"
