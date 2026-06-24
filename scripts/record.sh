#!/usr/bin/env bash
# scripts/record.sh —— 建金标帧（Record 轨）。
#
# 流程（spec §6 Record · golden-replay-determinism.md §2 确定性三要素）：
#   1. 前置检查：HELIX_DEVICE_ID 必填（连真 go 的真实设备）+ app 已构建 + 端口空闲。
#   2. 起前端（1420）+ 起 debug app（Record 模式，连真 go）→ 等双就绪。
#   3. 经 wdio 跑 UC-send-1 一次（窗口内 set_uc → 发消息 → 等 echo）。
#   4. 组装根在 Record 模式下经 Recording<P> 旁路录「go 帧 + 时钟 + id + 随机」进 Tape，
#      run 结束 ctx.save_tape() 落 test/fixtures/uc-send-1.tape.json。
#   5. 提示人审 tape 后冻结（只读）——禁自动修复 agent 改它（rules/contract-readonly-autofix.md）。
#
# ⚠️ 录制是「连真 go」轨，非确定性的来源（go 在线）；冻结后才进确定性 Replay 轨。
# tape 文件本身由 app(Record 模式) 在真跑时生成；本脚本只负责编排 + 落点 + 人审提示。
#
# 用法：
#   HELIX_DEVICE_ID=<真实设备id> scripts/record.sh [-- <wdio 额外参数>]
# 环境变量：
#   HELIX_DEVICE_ID         （必填）连真 go 的真实设备身份。
#   HELIX_HTTP_MAX_INFLIGHT （选填）HTTP 在途上限，透传给 app（默认由 app 决定）。
#   TAPE_FILE               （选填）tape 落点，默认 test/fixtures/uc-send-1.tape.json。
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

# —— 解析 -- 之后的 wdio 透传参数 ——
WDIO_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --) shift; WDIO_ARGS=("$@"); break ;;
    *)  die "未知参数：$1（用法见脚本头）" ;;
  esac
done

# —— 前置检查（fail-loud）——
log "${C_DIM}== record.sh：建金标帧（Record 轨，连真 go）==${C_RST}"
require_cmd curl "就绪轮询"
require_cmd lsof "端口检查"
require_cmd pnpm "前端 / wdio"

[ -n "${HELIX_DEVICE_ID:-}" ] || die "HELIX_DEVICE_ID 未设 —— Record 必须连真 go，需真实设备身份。
  用法：HELIX_DEVICE_ID=<设备id> scripts/record.sh"

assert_app_built          # W1 src-tauri debug 产物
assert_wdio_ready         # W3 wdio + W2 node_modules
assert_port_free "$FRONTEND_PORT" "前端"
assert_port_free "$WEBDRIVER_PORT" "webdriver"

ensure_log_dir
NG_LOG="$RUN_LOG_DIR/record-ng.log"
APP_LOG="$RUN_LOG_DIR/record-app.log"

# —— 收链路兜底 ——
trap cleanup_chain EXIT

# —— 备份既有 tape（防误覆盖已冻结金标帧）——
if [ -f "$TAPE_FILE" ]; then
  BAK="$TAPE_FILE.bak.$(date +%Y%m%d-%H%M%S)"
  warn "已存在 tape：$TAPE_FILE —— 备份到 $BAK 再重录（冻结 tape 禁随意覆盖）"
  cp "$TAPE_FILE" "$BAK"
fi

# —— 起链路 ——
ok "前置检查通过（device=${HELIX_DEVICE_ID}，inflight=${HELIX_HTTP_MAX_INFLIGHT:-默认}）"
start_frontend "$NG_LOG"
# Record 模式 + 真设备 + inflight 透传给 app（组装根读这些 env 选模式/拼装 EngineDeps）
start_app "record" "$APP_LOG" \
  "HELIX_DEVICE_ID=$HELIX_DEVICE_ID" \
  ${HELIX_HTTP_MAX_INFLIGHT:+"HELIX_HTTP_MAX_INFLIGHT=$HELIX_HTTP_MAX_INFLIGHT"}

wait_app_ready

# —— 跑 UC-send-1 一次（wdio 内部 set_uc + 发消息 + 等 echo）——
info "跑 UC-send-1（录制一遍）"
if ! run_wdio "${WDIO_ARGS[@]+"${WDIO_ARGS[@]}"}"; then
  die "wdio 跑 UC-send-1 失败 —— tape 未必完整，检查 $APP_LOG / 上方 wdio 输出"
fi

# —— 验 tape 落盘 ——
if [ -f "$TAPE_FILE" ]; then
  SZ=$(wc -c <"$TAPE_FILE" | tr -d ' ')
  ok "金标帧已录：${TAPE_FILE}（${SZ} bytes）"
  log ""
  log "${C_YEL}下一步（人审冻结）：${C_RST}"
  log "  1. 审 tape：确认 inbound(go 帧) / clock / ids / randoms 完整且无敏感数据。"
  log "  2. 冻结：git add $TAPE_FILE && 提交；此后视为只读金标帧。"
  log "  3. 日常跑确定性 Replay：scripts/replay.sh"
else
  die "Record 跑完但未生成 tape：$TAPE_FILE
  —— 组装根 Record 模式可能未调 ctx.save_tape()（W1 集成缝）；检查 ${APP_LOG}。"
fi
