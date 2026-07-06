#!/usr/bin/env bash
# Static trace drift/security gate for Loopforge.
#
# The trace sidecar is allowed at the Tauri invoke envelope boundary only. It
# must not become part of business command payloads, and trace-related code must
# not write sensitive/business content into span or log attributes.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

FAIL=0
TRACE_FILES="$(mktemp -t loopforge-trace-files.XXXXXX)"
DISALLOWED_TRACE="$(mktemp -t loopforge-trace-disallowed.XXXXXX)"
IM_STORE_TRACE="$(mktemp -t loopforge-trace-im-store.XXXXXX)"
PAYLOAD_TRACE="$(mktemp -t loopforge-trace-payload.XXXXXX)"
RAW_DANGER="$(mktemp -t loopforge-trace-danger.XXXXXX)"
DANGER_HITS="$(mktemp -t loopforge-trace-danger-filtered.XXXXXX)"
trap 'rm -f "$TRACE_FILES" "$DISALLOWED_TRACE" "$IM_STORE_TRACE" "$PAYLOAD_TRACE" "$RAW_DANGER" "$DANGER_HITS"' EXIT

pass() {
  printf "PASS: %s\n" "$1"
}

fail() {
  printf "FAIL: %s\n" "$1"
  FAIL=1
}

print_hits() {
  sed 's/^/  /' "$1"
}

printf "[trace-static-gate] repo=%s\n" "$ROOT"

if rg -n "__trace" src src-tauri \
  | grep -vE '^(src-tauri/src/commands\.rs|src-tauri/src/trace\.rs|src/app/im/tauri-bridge\.service\.ts|src/app/im/trace-context\.service\.ts):' \
    >"$DISALLOWED_TRACE"; then
  fail "__trace appears outside approved source boundary files"
  print_hits "$DISALLOWED_TRACE"
else
  pass "__trace is limited to approved source boundary files"
fi

if rg -n "__trace" src/app/im/im-store.service.ts >"$IM_STORE_TRACE"; then
  fail "src/app/im/im-store.service.ts writes or references __trace directly"
  print_hits "$IM_STORE_TRACE"
else
  pass "src/app/im/im-store.service.ts does not write __trace"
fi

TRACE_DEFAULT=$(awk '
  /fn default_trace_jsonl_path\(\)/ { in_fn=1; next }
  in_fn && match($0, /"[^"]+"/) { print substr($0, RSTART + 1, RLENGTH - 2); exit }
' crates/helix-driver-instrument/src/trace_event.rs)
if [ "$TRACE_DEFAULT" = "/tmp/loopforge-trace/events.jsonl" ]; then
  pass "trace JSONL defaults stay under /tmp"
else
  printf "  observed default: %s\n" "${TRACE_DEFAULT:-<missing>}"
  fail "trace JSONL default must stay exactly /tmp/loopforge-trace/events.jsonl"
fi

if rg -n 'payload\[[[:space:]]*["'\'']__trace["'\''][[:space:]]*\][[:space:]]*=|\.insert\([[:space:]]*["'\'']__trace["'\'']' \
  src-tauri/src/commands.rs >"$PAYLOAD_TRACE"; then
  fail "src-tauri/src/commands.rs appears to insert __trace into a business payload"
  print_hits "$PAYLOAD_TRACE"
else
  pass "business payload builders do not insert __trace"
fi

for name in helix.ws.connect helix.ws.send helix.ws.recv helix.ws.close; do
  if rg -q "\"$name\"" crates/helix-driver-instrument/src/transport.rs src-tauri/src/engine.rs; then
    pass "WS trace event is instrumented: $name"
  else
    fail "missing WS trace instrumentation for $name"
  fi
done

rg -0 -l 'TraceContext|__trace|traceparent|baggage|otel|opentelemetry' \
  src src-tauri scripts config >"$TRACE_FILES" || true

if [ -s "$TRACE_FILES" ]; then
  count="$(tr '\0' '\n' <"$TRACE_FILES" | sed '/^$/d' | wc -l | tr -d ' ')"
  pass "trace-related file discovery found $count files"

  DANGEROUS_TERMS='Authorization|cookieId|cookie[_-]?id|cookie|token'
  DANGEROUS_WORDS="(^|[^[:alnum:]_])(${DANGEROUS_TERMS})([^[:alnum:]_]|$)"
  DANGEROUS_CONTEXTS='set_attribute|\brecord[[:space:]]*\(|\bspan\b|attribute|console\.log|println!|tracing::|debug!|info!|warn!|error!'
  DANGER_RE="(${DANGEROUS_CONTEXTS}).{0,160}(${DANGEROUS_WORDS})|(${DANGEROUS_WORDS}).{0,160}(${DANGEROUS_CONTEXTS})"

  xargs -0 rg -n -i -e "$DANGER_RE" -- <"$TRACE_FILES" >"$RAW_DANGER" || true

  # Presence booleans are intentionally allowed: they prove a credential exists
  # without recording its value.
  grep -vE '(_present|present[[:space:]]*=)' "$RAW_DANGER" >"$DANGER_HITS" || true

  if [ -s "$DANGER_HITS" ]; then
    fail "trace-related files log/record sensitive or business content in span/log context"
    print_hits "$DANGER_HITS"
  else
    pass "trace-related files do not log sensitive/business content in span/log context"
  fi
else
  pass "trace-related file discovery found 0 files"
fi

if [ "$FAIL" -eq 0 ]; then
  printf "[trace-static-gate] PASS\n"
else
  printf "[trace-static-gate] FAIL\n"
fi

exit "$FAIL"
