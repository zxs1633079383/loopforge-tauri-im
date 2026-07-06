#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${LOOPFORGE_PROFILE:-dev-local}"
CONFIG="$ROOT/config/${PROFILE}.json"

if [ ! -f "$CONFIG" ]; then
  echo "trace config not found: $CONFIG" >&2
  exit 2
fi

read_config() {
  local expression="$1"
  node -e "
const config = require(process.argv[1]);
const value = ${expression};
if (value === undefined || value === null || value === '') process.exit(3);
console.log(String(value));
" "$CONFIG"
}

export OTEL_EXPORTER_OTLP_ENDPOINT="$(read_config "config.observability?.otel?.endpoint")"
export JAEGER_QUERY_URL="$(read_config "config.observability?.otel?.jaegerQueryUrl ?? 'http://192.168.6.66:32281'")"
export TRACE_CAPTURE_ENABLED="$(read_config "config.observability?.otel?.capture?.enabled ?? true")"
