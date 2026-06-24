#!/usr/bin/env bash
# scripts/_lib.sh —— W4 harness 公共函数库（被 record/replay/run/dev-loop 复用）。
#
# 设计：fail-loud（前置检查不过立即 exit 非 0 + 清晰中文原因）、可读、零静默吞错。
# 所有脚本统一 `source` 本文件，拿到 REPO_ROOT / HELIX_ROOT / 端口常量 / 等待函数 / 日志函数。
#
# 不在本文件做任何副作用（不起进程、不删文件）——只定义函数与常量。

# —— 路径常量 ——
# REPO_ROOT：loopforge-tauri-im 仓根（本脚本目录的上一级）。
LF_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LF_LIB_DIR/.." && pwd)"
# HELIX_ROOT：上游 helix workspace（path dep / dev-loop 改引擎处）。可经 env 覆盖。
HELIX_ROOT="${HELIX_ROOT:-/Users/mac28/workspace/rustWorkspace/helix}"

# —— 端口常量（spec §7 / CLAUDE.md §6）——
FRONTEND_PORT="${FRONTEND_PORT:-1420}"      # pnpm/ng serve 前端
WEBDRIVER_PORT="${WEBDRIVER_PORT:-4445}"    # tauri-plugin-webdriver 内嵌 W3C server（仅 debug）

# —— 金标帧 / 测试产物落点 ——
TAPE_DIR="$REPO_ROOT/test/fixtures"
TAPE_FILE="${TAPE_FILE:-$TAPE_DIR/uc-send-1.tape.json}"
WDIO_CONF="${WDIO_CONF:-$REPO_ROOT/wdio.conf.mjs}"
RUN_LOG_DIR="${RUN_LOG_DIR:-/tmp/loopforge}"

# —— 结构化 JSONL hop 日志落点（W1 LogSink.to_file 写 / W3 reducer 经 env HELIX_RUN_JSONL 读）——
# 统一固定路径 → app(写) 与 wdio spec(读) 看同一份；reducer 在 spec 内聚 corr_key 出「断在哪一跳」。
HELIX_RUN_JSONL="${HELIX_RUN_JSONL:-$RUN_LOG_DIR/run.jsonl}"
# wdio 控制台输出（含 reducer「四面报告 / 断在哪一跳」）抓存这里，供 dev-loop 读 diff。
WDIO_OUT="${WDIO_OUT:-$RUN_LOG_DIR/wdio-out.log}"

# —— App 二进制名（src-tauri 产物；W1 落地后确认；可经 env 覆盖）——
APP_BIN_NAME="${APP_BIN_NAME:-loopforge-tauri-im}"
APP_BIN="${APP_BIN:-$REPO_ROOT/src-tauri/target/debug/$APP_BIN_NAME}"

# —— 录放模式环境变量名（组装根 src-tauri 读它选 Recording 模式；W1 落地后对齐）——
# 取值：live | record | replay。脚本经此 env 把模式传给 debug app。
MODE_ENV_VAR="LOOPFORGE_MODE"

# —— 颜色（仅 tty）——
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'; C_DIM=$'\033[2m'; C_RST=$'\033[0m'
else
  C_RED=''; C_GRN=''; C_YEL=''; C_DIM=''; C_RST=''
fi

log()  { printf '%s\n' "$*"; }
info() { printf '%s\n' "${C_DIM}· $*${C_RST}"; }
ok()   { printf '%s\n' "${C_GRN}✅ $*${C_RST}"; }
warn() { printf '%s\n' "${C_YEL}⚠️  $*${C_RST}" >&2; }
# die：fail-loud——打印原因到 stderr，退出码可指定（默认 1）。
die()  { printf '%s\n' "${C_RED}⛔ $*${C_RST}" >&2; exit "${2:-1}"; }

# —— 前置检查：命令存在 ——
require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺依赖：未找到命令 '$1'（$2）"
}

# —— 前置检查：端口空闲（避免撞已有进程）——
# 用法：port_free <port> <名字>；占用即 die（要求调用方先收链路）。
assert_port_free() {
  local p="$1" name="$2" pid
  pid="$(lsof -ti:"$p" 2>/dev/null || true)"
  [ -z "$pid" ] || die "端口 $p（$name）已被占用 pid=$pid —— 先收链路或换端口（FRONTEND_PORT/WEBDRIVER_PORT）"
}

# —— 等待 HTTP 就绪（轮询，超时 fail-loud）——
# 用法：wait_http <url> <名字> <超时秒>
wait_http() {
  local url="$1" name="$2" timeout="${3:-120}" i
  info "等待 $name 就绪：$url（≤${timeout}s）"
  for ((i=0; i<timeout; i++)); do
    if curl -sf -o /dev/null "$url" 2>/dev/null; then ok "$name 就绪（$url）"; return 0; fi
    sleep 1
  done
  die "$name 超时未就绪（$url，${timeout}s）—— 检查上游进程日志"
}

# —— 等待前端（1420）+ webdriver（4445）双就绪 ——
wait_app_ready() {
  wait_http "http://localhost:$FRONTEND_PORT" "前端(ng serve)" "${1:-180}"
  wait_http "http://127.0.0.1:$WEBDRIVER_PORT/status" "webdriver(tauri-plugin)" "${2:-60}"
}

# —— 前置：app 二进制存在（W1 产物）——
assert_app_built() {
  [ -x "$APP_BIN" ] || die "未找到 debug app 二进制：$APP_BIN
  —— 先 \`cargo build --manifest-path src-tauri/Cargo.toml\`（W1 src-tauri 落地后）。
  或经 APP_BIN=<路径> 覆盖。"
}

# —— 前置：wdio 配置 + node deps（W3/W2 产物）——
assert_wdio_ready() {
  [ -f "$WDIO_CONF" ] || die "未找到 wdio 配置：$WDIO_CONF（W3 测试 / W2 接线落地后）"
  [ -d "$REPO_ROOT/node_modules" ] || die "node_modules 缺失 —— 先 \`pnpm install\`（W2 前端落地后）"
}

# —— 前置：tape 文件存在（replay 用）——
assert_tape_exists() {
  [ -f "$TAPE_FILE" ] || die "金标帧 tape 不存在：$TAPE_FILE
  —— 先跑 \`scripts/record.sh\`（连真 go 录一次），人审后冻结。"
}

# —— 收链路：杀 app + 释放端口 ——
cleanup_chain() {
  pkill -f "target/debug/$APP_BIN_NAME" 2>/dev/null || true
  local p
  for p in "$FRONTEND_PORT" "$WEBDRIVER_PORT"; do
    pid="$(lsof -ti:"$p" 2>/dev/null || true)"
    [ -n "$pid" ] && kill $pid 2>/dev/null || true
  done
}

# —— 起前端（后台，日志旁路）；返回 pid（写入 $1 指向的全局变量名不便，故用文件锚）——
# 用法：start_frontend <logfile>
start_frontend() {
  local logf="$1"
  require_cmd pnpm "前端构建器"
  info "起前端：pnpm start（端口 $FRONTEND_PORT，日志 $logf）"
  ( cd "$REPO_ROOT" && nohup pnpm start >"$logf" 2>&1 & )
}

# —— 起 debug app（后台，带模式 env）——
# 用法：start_app <mode:live|record|replay> <logfile> [extra-env...]
start_app() {
  local mode="$1" logf="$2"; shift 2
  assert_app_built
  # app 写 hop 日志到 HELIX_RUN_JSONL（= reducer 读的同一份）；重起前清旧 JSONL 防跨轮串味。
  : >"$HELIX_RUN_JSONL" 2>/dev/null || true
  info "起 debug app：$APP_BIN（$MODE_ENV_VAR=$mode，webdriver $WEBDRIVER_PORT，run.jsonl=$HELIX_RUN_JSONL，日志 $logf）"
  ( cd "$REPO_ROOT" && env \
      "$MODE_ENV_VAR=$mode" \
      "HELIX_RUN_JSONL=$HELIX_RUN_JSONL" \
      "$@" nohup "$APP_BIN" >"$logf" 2>&1 & )
}

# —— 跑 wdio ——
# 导出 HELIX_RUN_JSONL（reducer 经此 env 读 hop 日志）+ tee 控制台到 WDIO_OUT
# （含 reducer「四面报告 / 断在哪一跳」，供 dev-loop 收 diff）。
# 保留 wdio 真实退出码（PIPESTATUS[0]，不被 tee 吞掉）。
run_wdio() {
  assert_wdio_ready
  info "跑 wdio：$WDIO_CONF（run.jsonl=$HELIX_RUN_JSONL）"
  local rc
  ( cd "$REPO_ROOT" && env "HELIX_RUN_JSONL=$HELIX_RUN_JSONL" \
      pnpm exec wdio run "$WDIO_CONF" "$@" ) 2>&1 | tee "$WDIO_OUT"
  rc="${PIPESTATUS[0]}"
  return "$rc"
}

# —— 确保日志目录存在 ——
ensure_log_dir() { mkdir -p "$RUN_LOG_DIR"; }
