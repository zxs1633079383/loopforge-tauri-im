#!/usr/bin/env bash
# scripts/run.sh —— 一条命令从零到四面报告（Live 轨，连真 go）。
#
# 串起整条链路（CLAUDE.md §6 / spec §9 W4）：
#   pnpm start（前端 1420）
#   + cargo run debug（src-tauri，内嵌 webdriver 4445）
#   + wait-on（双就绪）
#   + wdio run（四面断言）
#
# 默认 Live 模式（透传真 go + tee 日志，不录不放）——日常开发/手测跑真 go。
# 想要确定性请用 scripts/replay.sh；想录金标帧请用 scripts/record.sh。
#
# 与 record/replay 的区别：run.sh 用 `cargo run`（边构建边起，开发态），
# record/replay 用预构建二进制（${APP_BIN}）求快与确定。
#
# 用法：
#   scripts/run.sh [-- <wdio 额外参数>]
# 环境变量：
#   HELIX_DEVICE_ID         （Live 连真 go 建议设；不设则由 app 决定行为）。
#   HELIX_HTTP_MAX_INFLIGHT （选填）HTTP 在途上限。
#   LOOPFORGE_MODE          （选填）live|record|replay，默认 live。
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

MODE="${LOOPFORGE_MODE:-live}"
WDIO_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; WDIO_ARGS=("$@"); break ;;
    *)  die "未知参数：$1（用法见脚本头）" ;;
  esac
done

log "${C_DIM}== run.sh：从零到四面报告（模式=${MODE}）==${C_RST}"
require_cmd curl "就绪轮询"
require_cmd lsof "端口检查"
require_cmd pnpm "前端 / wdio"
require_cmd cargo "src-tauri 构建"

# —— 前置检查 ——
[ -f "$REPO_ROOT/src-tauri/Cargo.toml" ] || die "未找到 src-tauri/Cargo.toml（W1 src-tauri 落地后）"
assert_wdio_ready
assert_port_free "$FRONTEND_PORT" "前端"
assert_port_free "$WEBDRIVER_PORT" "webdriver"

ensure_log_dir
NG_LOG="$RUN_LOG_DIR/run-ng.log"
APP_LOG="$RUN_LOG_DIR/run-app.log"

trap cleanup_chain EXIT

# —— 起前端 ——
start_frontend "$NG_LOG"
wait_http "http://localhost:$FRONTEND_PORT" "前端(ng serve)" 180

# —— UC-4.1 专用 seed：起 app 前重置 cursor 到落后态（必须早于 app 加载 in-memory cursor）——
# hello 握手发的 fromSeq = 启动时从 DB channel_event_cursor 灌入的 in-memory 值；
# 故重置必须在 app 启动前（spec 的 before-hook 太晚·cursor 已灌入内存）。
# 幂等可重复：每轮 run 都重置（上轮 hello 已把 cursor 推回 current）。
BOOTSTRAP_UC=""
if printf '%s\n' "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}" | grep -q 'uc-4.1'; then
  info "UC-4.1：起 app 前重置 cursor 到落后态（seed-behind-cursor·决策 A·C003/C004）"
  bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "UC-4.1 cursor 重置失败（seed-behind-cursor）" 1
  # bootstrap UC 归属：UC-4.1 是「就绪根」——hello 自驱增量在 app 启动即流过（早于 e2e
  # before-hook 的 set_uc('UC-4.1')）→ 默认归 __quiescence__·reducer 按 uc_id 过滤抽空。
  # 设 bootstrap UC=UC-4.1 使 hello hop 真正归 UC-4.1（机器件归属·非改冻结 oracle）。
  BOOTSTRAP_UC="UC-4.1"
  info "UC-4.1：bootstrap UC 归属 = UC-4.1（hello 自驱帧归 UC-4.1·LOOPFORGE_BOOTSTRAP_UC）"
elif printf '%s\n' "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}" | grep -q 'uc-4.2'; then
  info "UC-4.2：起 app 前重置 cursor 到落后态（seed-behind-cursor·gap sync 自驱前置）"
  bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "UC-4.2 cursor 重置失败（seed-behind-cursor）" 1
  BOOTSTRAP_UC="UC-4.2"
  info "UC-4.2：bootstrap UC 归属 = UC-4.2（hello 自驱 sync-notify hop 归本 UC）"
elif printf '%s\n' "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}" | grep -q 'uc-4.4'; then
  info "UC-4.4：起 app 前重置 cursor 到落后态（seed-behind-cursor·heartbeat gap 自驱前置）"
  bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "UC-4.4 cursor 重置失败（seed-behind-cursor）" 1
  BOOTSTRAP_UC="UC-4.4"
  info "UC-4.4：bootstrap UC 归属 = UC-4.4（hello/heartbeat 自驱 hop 归本 UC）"
elif printf '%s\n' "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}" | grep -q 'uc-10.1'; then
  BOOTSTRAP_UC="UC-10.1"
  info "UC-10.1：bootstrap UC 归属 = UC-10.1（hello 自驱 todo hop 归本 UC）"
fi

# —— 起 app：cargo run debug（边构建边起；首次构建慢，耐心等 webdriver 就绪）——
: >"$HELIX_RUN_JSONL" 2>/dev/null || true
info "起 app：cargo run（src-tauri，debug，${MODE_ENV_VAR}=${MODE}，webdriver ${WEBDRIVER_PORT}，run.jsonl=${HELIX_RUN_JSONL}）"
( cd "$REPO_ROOT" && env \
    "$MODE_ENV_VAR=$MODE" \
    "HELIX_RUN_JSONL=$HELIX_RUN_JSONL" \
    ${HELIX_DEVICE_ID:+"HELIX_DEVICE_ID=$HELIX_DEVICE_ID"} \
    ${HELIX_HTTP_MAX_INFLIGHT:+"HELIX_HTTP_MAX_INFLIGHT=$HELIX_HTTP_MAX_INFLIGHT"} \
    ${BOOTSTRAP_UC:+"LOOPFORGE_BOOTSTRAP_UC=$BOOTSTRAP_UC"} \
    nohup cargo run --manifest-path src-tauri/Cargo.toml >"$APP_LOG" 2>&1 & )

# cargo 首次冷构建可能数分钟 → webdriver 就绪超时给足
wait_http "http://127.0.0.1:$WEBDRIVER_PORT/status" "webdriver(tauri-plugin)" 600

# —— 跑 wdio（四面断言）——
info "跑 wdio（四面断言：① 出站 / ② 投影 / ③ DOM / ④ 落库）"
if run_wdio "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}"; then
  ok "四面报告全绿"
  exit 0
else
  die "wdio 红 —— reducer「断在哪一跳」报告见上方输出 / $APP_LOG" 1
fi
