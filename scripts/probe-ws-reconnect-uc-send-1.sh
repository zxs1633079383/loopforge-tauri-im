#!/usr/bin/env bash
set -euo pipefail

ROOT="/System/Volumes/Data/workspace/rust/loopforge-tauri-im"
GO_ROOT="/System/Volumes/Data/workspace/golang/cses-im-server"
PROBE_BIN="/tmp/cses-im-server-reconnect-probe"
LOG_ROOT="/tmp/loopforge"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="$LOG_ROOT/reconnect-probe-$RUN_ID"
BACKEND_PORT="${LOOPFORGE_PROBE_BACKEND_PORT:-18066}"

mkdir -p "$LOG_DIR"

RUN_LOG="$LOG_DIR/uc-send-1-reconnect.log"
NG_LOG="$LOG_DIR/run-ng.log"
APP_LOG="$LOG_DIR/run-app.log"
TRACE_JSONL="$LOG_DIR/trace-events.jsonl"
HELIX_RUN_JSONL_PATH="$LOG_DIR/run.jsonl"
WDIO_FIRST_LOG="$LOG_DIR/wdio-before-restart.log"
WDIO_SECOND_LOG="$LOG_DIR/wdio-after-restart.log"
EVIDENCE_DIR="$LOG_DIR/evidence"
CONFIG_PATH="$ROOT/config/dev-local.json"
CONFIG_BACKUP="$LOG_DIR/dev-local.json.before-probe"
CONFIG_RESTORE_NEEDED=0

GO_PID=""
FRONTEND_PID=""
APP_PID=""

log() { printf '%s\n' "$*" | tee -a "$RUN_LOG"; }
fail() { log "⛔ $*"; exit 1; }

cleanup_probe_bin() {
  pkill -f "$PROBE_BIN" 2>/dev/null || true
}

cleanup() {
  if [ -n "${GO_PID:-}" ]; then
    kill "$GO_PID" 2>/dev/null || true
    wait "$GO_PID" 2>/dev/null || true
  fi
  if [ -n "${APP_PID:-}" ]; then
    kill "$APP_PID" 2>/dev/null || true
    wait "$APP_PID" 2>/dev/null || true
  fi
  pkill -f "$ROOT/target/debug/loopforge-tauri-im" 2>/dev/null || true
  if [ -n "${FRONTEND_PID:-}" ]; then
    pkill -P "$FRONTEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
  fi
  cleanup_probe_bin
  if [ "$CONFIG_RESTORE_NEEDED" = "1" ] && [ -f "$CONFIG_BACKUP" ]; then
    cp "$CONFIG_BACKUP" "$CONFIG_PATH" 2>/dev/null || true
  fi
}
trap cleanup EXIT

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "缺依赖：$1（$2）"
}

port_pids() {
  lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null || true
}

assert_port_free() {
  local port="$1" name="$2" pids
  pids="$(port_pids "$port")"
  if [ -n "$pids" ]; then
    log "端口 ${port}（${name}）已被占用："
    lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | tee -a "$RUN_LOG" || true
    fail "为避免误杀用户/其他流程进程，本探针停止。请释放端口后重跑。"
  fi
}

wait_http() {
  local url="$1" name="$2" timeout="${3:-120}" i
  log "等待 ${name} 就绪：${url}（≤${timeout}s）"
  for ((i = 0; i < timeout; i++)); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then
      log "✅ $name 就绪"
      return 0
    fi
    sleep 1
  done
  fail "${name} 超时未就绪：${url}"
}

wait_port_free() {
  local port="$1" name="$2" timeout="${3:-30}" i
  for ((i = 0; i < timeout; i++)); do
    if [ -z "$(port_pids "$port")" ]; then
      return 0
    fi
    sleep 1
  done
  fail "$name 端口 $port 在 ${timeout}s 内未释放"
}

wait_pattern() {
  local pattern="$1" file="$2" label="$3" timeout="${4:-30}" i
  log "等待 ${label}：${pattern}"
  for ((i = 0; i < timeout; i++)); do
    if [ -f "$file" ] && rg -q "$pattern" "$file"; then
      log "✅ 已观察到 $label"
      return 0
    fi
    sleep 1
  done
  fail "未观察到 ${label}（file=${file}）"
}

prepare_probe_config() {
  if ! git -C "$ROOT" diff --quiet -- "$CONFIG_PATH"; then
    fail "config/dev-local.json 已有未提交改动；为避免覆盖用户配置，本探针停止。"
  fi
  cp "$CONFIG_PATH" "$CONFIG_BACKUP"
  CONFIG_RESTORE_NEEDED=1
  perl -0pi -e "s/localhost:8066/localhost:${BACKEND_PORT}/g" "$CONFIG_PATH"
  log "临时切换 loopforge dev-local profile 到 backend port ${BACKEND_PORT}（退出时恢复）"
}

start_backend() {
  local phase="$1"
  local backend_log="$LOG_DIR/cses-reconnect-probe-$phase.log"
  log "启动 cses-im-server 探针后端（phase=${phase}，log=${backend_log}）"
  (
    cd "$GO_ROOT"
    exec env \
      CSES_IM_LISTEN_ADDR=":${BACKEND_PORT}" \
      CSES_IM_NODE_ID="loopforge-reconnect-${RUN_ID}-${phase}" \
      USER="loopforge_reconnect_${RUN_ID}" \
      "$PROBE_BIN"
  ) >"$backend_log" 2>&1 &
  GO_PID=$!
  wait_http "http://127.0.0.1:${BACKEND_PORT}/api/cses/health" "cses-im-server phase=$phase" 120
}

stop_backend() {
  if [ -n "${GO_PID:-}" ]; then
    log "停止 cses-im-server 探针后端 pid=$GO_PID"
    kill "$GO_PID" 2>/dev/null || true
    wait "$GO_PID" 2>/dev/null || true
    GO_PID=""
  fi
  wait_port_free "$BACKEND_PORT" "cses-im-server" 30
}

run_wdio_phase() {
  local phase="$1" out="$2"
  log "运行 UC-send-1（${phase}）"
  (
    cd "$ROOT"
    env HELIX_RUN_JSONL="$HELIX_RUN_JSONL_PATH" \
      pnpm exec wdio run wdio.conf.mjs --spec test/specs/uc-send-1.e2e.mjs
  ) 2>&1 | tee "$out" | tee -a "$RUN_LOG"
  local rc="${PIPESTATUS[0]}"
  if [ "$rc" -ne 0 ]; then
    fail "UC-send-1（${phase}）失败，详见 ${out}"
  fi
}

require_cmd curl "健康检查"
require_cmd lsof "端口占用检查"
require_cmd rg "日志断言"
require_cmd go "构建 cses-im-server 探针后端"
require_cmd cargo "启动 Tauri debug app"
require_cmd pnpm "启动前端和 WebdriverIO"

log "restart probe log dir: $LOG_DIR"

cleanup_probe_bin
assert_port_free "$BACKEND_PORT" "cses-im-server"
assert_port_free 1420 "loopforge 前端"
assert_port_free 4445 "tauri webdriver"
prepare_probe_config

log "构建 cses-im-server 探针二进制：$PROBE_BIN"
(
  cd "$GO_ROOT"
  go build -o "$PROBE_BIN" ./cmd/server
)

: >"$TRACE_JSONL"
: >"$HELIX_RUN_JSONL_PATH"
mkdir -p "$EVIDENCE_DIR"

start_backend 1

log "启动 loopforge 前端（log=${NG_LOG}）"
(
  cd "$ROOT"
  exec pnpm start
) >"$NG_LOG" 2>&1 &
FRONTEND_PID=$!
wait_http "http://localhost:1420" "loopforge 前端" 180

log "启动旧 Tauri/helix app（log=${APP_LOG}）"
(
  cd "$ROOT"
  exec env \
    LOOPFORGE_MODE=live \
    HELIX_RUN_JSONL="$HELIX_RUN_JSONL_PATH" \
    LOOPFORGE_TRACE_JSONL="$TRACE_JSONL" \
    LOOPFORGE_EVIDENCE_DIR="$EVIDENCE_DIR" \
    cargo run --manifest-path src-tauri/Cargo.toml
) >"$APP_LOG" 2>&1 &
APP_PID=$!
wait_http "http://127.0.0.1:4445/status" "tauri webdriver" 600

run_wdio_phase "backend restart 前" "$WDIO_FIRST_LOG"

stop_backend
sleep 1
start_backend 2

wait_pattern 'helix\.ws\.reconnect\.success|helix\.ws\.reconnect success' "$TRACE_JSONL" "helix reconnect success trace" 60
wait_pattern 'ws connection lifecycle.*action=.*register|action=.*register.*ws connection lifecycle' "$LOG_DIR/cses-reconnect-probe-2.log" "后端新 WS register" 60

run_wdio_phase "backend restart 后（同一旧 Tauri app）" "$WDIO_SECOND_LOG"

rg 'helix\.ws\.reconnect\.success|helix\.ws\.reconnect success' "$TRACE_JSONL" | tee -a "$RUN_LOG"
rg 'ws connection lifecycle.*action=.*register|action=.*register.*ws connection lifecycle' "$LOG_DIR/cses-reconnect-probe-2.log" | tee -a "$RUN_LOG"
rg 'UC-send-1 六面报告|Spec Files:[[:space:]]+1 passed' "$WDIO_FIRST_LOG" "$WDIO_SECOND_LOG" | tee -a "$RUN_LOG"

log "✅ restart probe PASS：旧 Tauri/helix 在后端重启后完成重连并通过 UC-send-1"
