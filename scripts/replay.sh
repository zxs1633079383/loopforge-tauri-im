#!/usr/bin/env bash
# scripts/replay.sh —— 日常确定性闭环（Replay 轨）。
#
# 流程（spec §6 Replay · golden-replay-determinism.md §1 双轨）：
#   1. 前置检查：tape 存在（已冻结金标帧）+ app 已构建 + 端口空闲。
#   2. 起前端（1420）+ 起 debug app（Replay 模式，喂 tape，不碰网络）→ 等双就绪。
#   3. 经 wdio 跑 UC-send-1 → 四面断言（① 出站 body / ② 投影 / ③ DOM / ④ 落库）。
#   4. 秒级、无网络、无 go flaky —— 自动修复闭环的确定性输入端。
#
# 可证伪/确定性（HX-C011 + golden-replay-determinism.md）：同 tape 重跑 N 次结果须一致；
# Replay 模式下 Recording<P> 出站只 tee 日志（facet ① 仍断言），入站/响应/时钟/id 全从 tape 供，
# helix 内部 timer/id 不漂移 → 字节级复现。
#
# 用法：
#   scripts/replay.sh [N]            # N=重跑次数（确定性自检；默认 1）
#   TAPE_FILE=<路径> scripts/replay.sh
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

N="${1:-1}"
case "$N" in (*[!0-9]*|'') die "重跑次数须为正整数：'$N'";; esac
[ "$N" -ge 1 ] || die "重跑次数须 ≥1：'$N'"

log "${C_DIM}== replay.sh：确定性闭环（Replay 轨，喂 tape，无网络）·重跑 ${N} 次 ==${C_RST}"
require_cmd curl "就绪轮询"
require_cmd lsof "端口检查"
require_cmd pnpm "前端 / wdio"

# —— 前置检查（fail-loud）——
assert_tape_exists        # 金标帧（record.sh 产物，人审冻结）
assert_app_built          # W1 src-tauri debug 产物
assert_wdio_ready         # W3 wdio + W2 node_modules
assert_port_free "$FRONTEND_PORT" "前端"
assert_port_free "$WEBDRIVER_PORT" "webdriver"

ensure_log_dir
NG_LOG="$RUN_LOG_DIR/replay-ng.log"
APP_LOG="$RUN_LOG_DIR/replay-app.log"

trap cleanup_chain EXIT

ok "前置检查通过（tape=$TAPE_FILE）"

# —— 起前端一次（多次 wdio run 复用同一前端，省启动）——
start_frontend "$NG_LOG"
wait_http "http://localhost:$FRONTEND_PORT" "前端(ng serve)" 180

# —— N 轮：每轮重起 app(Replay) + 跑 wdio（app 重起保证 tape 从头喂、状态干净）——
PASS=0; FAIL=0; FIRST_REPORT=""
for ((r=1; r<=N; r++)); do
  log ""
  log "${C_DIM}—— Replay 轮 $r/$N ——${C_RST}"
  # 每轮独立 app 进程（释放上轮 webdriver 端口）
  pkill -f "target/debug/$APP_BIN_NAME" 2>/dev/null || true
  for _w in 1 2 3 4 5; do lsof -ti:"$WEBDRIVER_PORT" >/dev/null 2>&1 || break; sleep 1; done

  start_app "replay" "$APP_LOG" "TAPE_FILE=$TAPE_FILE"
  wait_http "http://127.0.0.1:$WEBDRIVER_PORT/status" "webdriver(tauri-plugin)" 60

  if run_wdio; then
    PASS=$((PASS+1)); ok "轮 $r 绿（四面齐）"
  else
    FAIL=$((FAIL+1)); warn "轮 $r 红 —— 见上方 wdio 输出 / $APP_LOG"
  fi
done

# —— 收口 ——
log ""
log "${C_DIM}== Replay 结果：${PASS} 绿 / ${FAIL} 红（共 ${N}）==${C_RST}"
if [ "$FAIL" -eq 0 ]; then
  ok "确定性闭环全绿（同 tape 重跑 ${N} 次一致）"
  exit 0
else
  die "Replay 有红 —— 自动修复闭环须先回正（改 helix 实现 / 渲染壳，禁改 tape/期望）。
  reducer diff 见 wdio 输出的「断在哪一跳」报告。" 1
fi
