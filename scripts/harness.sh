#!/usr/bin/env bash
# scripts/harness.sh —— 暖栈常驻模式（Tier 0 提速）。
#
# 命题：run.sh 每次全冷启（ng serve ≤180s 等 + cargo run/boot ≤600s 等 + WKWebView 握手）
# 最后只为那 2s 的 wdio——启动税每轮重付。但 wdio 直连已起的 4445（wdio.conf.mjs:7），
# ng+app 本就能跨多次 wdio run 常驻，唯一逼重起的是 run.sh 的 `trap cleanup_chain EXIT`。
# 本脚本：起一次常驻（不挂 trap），把 red→green 内循环压到 ~10s（只重跑 wdio）。
#
# 子命令：
#   harness.sh up               起 ng(1420)+app(4445) 常驻·幂等（已健康则复用）·不挂 cleanup trap
#   harness.sh spec <uc-id>     对常驻栈跑单 spec（四面断言）·改 spec/expect/reducer 后直接重跑（~10s）
#   harness.sh reload-app [--uc4.1]  只重起 app（cargo run 增量编译·Rust/Angular 改后用）·ng 不动
#   harness.sh status           报 1420/4445 健康
#   harness.sh down             显式收链路（用完才拆）
#
# 与 run.sh 的区别：run.sh = 每次全冷启 + trap 全拆（单次确定性·CI）；
#                   harness = 常驻复用（开发内循环·autonomous 级联）。
# UC-4.1 例外：需「起 app 前」重置 cursor（seed-behind-cursor）→ 暖栈下用 `reload-app --uc4.1`。
set -uo pipefail
# UTF-8 locale 兜底：非 UTF-8 locale 下 bash 会把紧跟变量名的多字节中文吞进标识符
# （$var（ → 未绑定变量）。显式设 UTF-8 + 关键处用 ${var} 花括号界定双保险。
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

MODE="${LOOPFORGE_MODE:-live}"
NG_LOG="$RUN_LOG_DIR/run-ng.log"
APP_LOG="$RUN_LOG_DIR/run-app.log"
STATE_FILE="$RUN_LOG_DIR/harness.state"

frontend_healthy()  { curl -sf -o /dev/null "http://localhost:$FRONTEND_PORT" 2>/dev/null; }
webdriver_healthy() { curl -sf -o /dev/null "http://127.0.0.1:$WEBDRIVER_PORT/status" 2>/dev/null; }

# 起 app（cargo run debug·边构建边起·带模式 env·可选 bootstrap UC）；等 webdriver 就绪。
_start_app_cargo() {
  local bootstrap_uc="${1:-}"
  : >"$HELIX_RUN_JSONL" 2>/dev/null || true
  info "起 app：cargo run（${MODE_ENV_VAR}=${MODE}·webdriver ${WEBDRIVER_PORT}·run.jsonl=${HELIX_RUN_JSONL}）"
  ( cd "$REPO_ROOT" && env \
      "$MODE_ENV_VAR=$MODE" \
      "HELIX_RUN_JSONL=$HELIX_RUN_JSONL" \
      ${HELIX_DEVICE_ID:+"HELIX_DEVICE_ID=$HELIX_DEVICE_ID"} \
      ${HELIX_HTTP_MAX_INFLIGHT:+"HELIX_HTTP_MAX_INFLIGHT=$HELIX_HTTP_MAX_INFLIGHT"} \
      ${bootstrap_uc:+"LOOPFORGE_BOOTSTRAP_UC=$bootstrap_uc"} \
      nohup cargo run --manifest-path src-tauri/Cargo.toml >"$APP_LOG" 2>&1 & )
  wait_http "http://127.0.0.1:$WEBDRIVER_PORT/status" "webdriver(tauri-plugin)" 600
}

cmd_up() {
  ensure_log_dir
  require_cmd curl "就绪轮询"; require_cmd lsof "端口检查"
  require_cmd pnpm "前端/wdio"; require_cmd cargo "src-tauri 构建"
  [ -f "$REPO_ROOT/src-tauri/Cargo.toml" ] || die "未找到 src-tauri/Cargo.toml"
  assert_wdio_ready
  if frontend_healthy && webdriver_healthy; then
    ok "暖栈已在跑（1420+4445 健康）·复用·不重起"; echo "up(reuse) @ $(date)" >"$STATE_FILE"; return 0
  fi
  # —— 前端（常驻·整个 session 只起一次）——
  if frontend_healthy; then info "前端 1420 已健康·复用"
  else
    assert_port_free "$FRONTEND_PORT" "前端"
    start_frontend "$NG_LOG"
    wait_http "http://localhost:$FRONTEND_PORT" "前端(ng serve)" 180
  fi
  # —— app ——
  if webdriver_healthy; then info "webdriver 4445 已健康·复用"
  else
    assert_port_free "$WEBDRIVER_PORT" "webdriver"
    _start_app_cargo ""
  fi
  echo "up @ $(date)" >"$STATE_FILE"
  ok "暖栈常驻就绪（ng 1420 + app 4445）·后续 \`harness.sh spec <uc>\` 只重跑 wdio（~10s）"
}

cmd_spec() {
  local uc="${1:-}"; [ -n "$uc" ] || die "用法：harness.sh spec <uc-id>（如 6.4）"
  frontend_healthy  || die "前端 1420 未就绪 —— 先 \`harness.sh up\`"
  webdriver_healthy || die "webdriver 4445 未就绪 —— 先 \`harness.sh up\`（Rust 改了用 reload-app）"
  local spec_file="test/specs/uc-${uc}.e2e.mjs"
  [ -f "$REPO_ROOT/$spec_file" ] || die "spec 不存在：$spec_file"
  : >"$HELIX_RUN_JSONL" 2>/dev/null || true   # 清旧 hop 防跨轮串味
  info "暖栈跑 spec：${spec_file}（app 不重起·仅 wdio）"
  if run_wdio --spec "$spec_file"; then ok "四面报告全绿（uc-${uc}）"; return 0
  else warn "wdio 红（uc-${uc}）—— reducer「断在哪一跳」见上 / ${APP_LOG}"; return 1; fi
}

cmd_reload_app() {
  local bootstrap_uc=""
  if [ "${1:-}" = "--uc4.1" ]; then
    info "UC-4.1：起 app 前重置 cursor 落后态（seed-behind-cursor·C003/C004）"
    bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "cursor 重置失败" 1
    bootstrap_uc="UC-4.1"
  fi
  info "重起 app（cargo run·增量编译·ng 保持不动·Rust/Angular 改后用以确保 WKWebView 加载新产物）"
  pkill -f "cargo run --manifest-path src-tauri" 2>/dev/null || true
  pkill -f "target/debug/$APP_BIN_NAME" 2>/dev/null || true
  local pid; pid="$(lsof -ti:"$WEBDRIVER_PORT" 2>/dev/null || true)"; [ -n "$pid" ] && kill $pid 2>/dev/null || true
  sleep 1
  _start_app_cargo "$bootstrap_uc"
  ok "app 重起就绪（4445）·ng（1420）未动"
}

cmd_status() {
  frontend_healthy  && ok "前端 1420 健康"      || warn "前端 1420 未就绪"
  webdriver_healthy && ok "webdriver 4445 健康" || warn "webdriver 4445 未就绪"
  [ -f "$STATE_FILE" ] && info "state: $(cat "$STATE_FILE")"
}

cmd_down() {
  info "收暖栈链路（显式拆·用完才拆）"
  cleanup_chain
  pkill -f "cargo run --manifest-path src-tauri" 2>/dev/null || true
  pkill -f "pnpm start" 2>/dev/null || true
  pkill -f "ng serve" 2>/dev/null || true
  rm -f "$STATE_FILE"
  ok "暖栈已拆（1420+4445 释放）"
}

case "${1:-}" in
  up)         cmd_up ;;
  spec)       shift; cmd_spec "${1:-}" ;;
  reload-app) shift; cmd_reload_app "${1:-}" ;;
  status)     cmd_status ;;
  down)       cmd_down ;;
  *)          die "用法：harness.sh {up | spec <uc-id> | reload-app [--uc4.1] | status | down}" ;;
esac
