#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/trace-env.sh"

TRACE_DIR="${LOOPFORGE_TRACE_DIR:-/tmp/loopforge/trace}"
TRACE_ID_FILE="$TRACE_DIR/pc-send-trace-id.txt"
TRACE_JSONL="${LOOPFORGE_TRACE_JSONL:-/tmp/loopforge-trace/events.jsonl}"

mkdir -p "$TRACE_DIR" "$(dirname "$TRACE_JSONL")"
rm -f "$TRACE_ID_FILE"
export LOOPFORGE_OTEL_FLUSH_GRACE_MS="${LOOPFORGE_OTEL_FLUSH_GRACE_MS:-5000}"

cd "$ROOT"
bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs

node --input-type=module - "$TRACE_JSONL" "$TRACE_ID_FILE" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";

const [traceJsonl, traceIdFile] = process.argv.slice(2);
const lines = readFileSync(traceJsonl, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0);

const events = [];
for (let index = 0; index < lines.length; index += 1) {
  try {
    events.push(JSON.parse(lines[index]));
  } catch (error) {
    throw new Error(`invalid trace JSONL line ${index + 1}: ${error.message}`);
  }
}

const candidates = events
  .filter((event) => {
    const action = event?.payload?.action ?? event?.payload?.payload?.action;
    return (
      event?.name === "pc.ui.action" &&
      action === "im.send" &&
      typeof event?.trace_id === "string" &&
      /^[0-9a-f]{32}$/.test(event.trace_id)
    );
  })
  .map((event) => event.trace_id);

const traceId = candidates.at(-1);
if (!traceId) {
  throw new Error(`missing pc.ui.action im.send trace_id in ${traceJsonl}`);
}

writeFileSync(traceIdFile, `${traceId}\n`, "utf8");
console.log(`pc send trace id: ${traceId}`);
NODE

if [ ! -s "$TRACE_ID_FILE" ]; then
  echo "missing PC trace id file: $TRACE_ID_FILE" >&2
  exit 1
fi

TRACE_ID="$(tr -d '\n\r ' < "$TRACE_ID_FILE")"

if [ -f "$TRACE_JSONL" ]; then
  node scripts/trace-jsonl-check.mjs --input "$TRACE_JSONL" --trace-id "$TRACE_ID" || \
    echo "debug JSONL trace check did not pass; continuing to Jaeger proof for $TRACE_ID" >&2
fi

for attempt in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if node scripts/otel-trace-check.mjs --jaeger-url "$JAEGER_QUERY_URL" "$TRACE_ID"; then
    exit 0
  fi
  echo "waiting for Jaeger trace materialization ($attempt/12): $TRACE_ID" >&2
  sleep 5
done

node scripts/otel-trace-check.mjs --jaeger-url "$JAEGER_QUERY_URL" "$TRACE_ID"
