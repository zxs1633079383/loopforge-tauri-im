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
#   harness.sh spec <uc-id> [--fresh|--warm|--keep]
#                               对常驻栈跑单 spec（四面断言）·改 spec/expect/reducer 后直接重跑（~10s）
#   harness.sh reload-app [--uc4.1|--uc <UC>]  只重起 app（cargo run 增量编译·Rust/Angular 改后用）·ng 不动
#   harness.sh seed-freeze      冻结当前良好 seeded DB 为金标快照（--fresh restore 的源·C014）
#   harness.sh status           报 1420/4445 健康 + 快照状态
#   harness.sh down             显式收链路（用完才拆）
#
# 与 run.sh 的区别：run.sh = 每次全冷启 + trap 全拆（单次确定性·CI）；
#                   harness = 常驻复用（开发内循环·autonomous 级联）。
# UC-4.1 例外：需「起 app 前」重置 cursor（seed-behind-cursor）→ 暖栈下用 `reload-app --uc4.1`。
#
# —— 每-UC 状态隔离（C014·flaky-state 缺口修复）————————————————————————————————
# 缺口：暖栈 app 常驻 + DB 持久 → spec A 改了 DB/DOM/in-memory cursor/inflight →
#   spec B 前置被破坏 → 同一 UC 单独绿、跟在别 spec 后红（实测 1.4/5.3/10.1·跑序相关）。
# 修复：spec 跑前把 app 复位到**确定起点**——
#   ① 内核自驱 UC（4.1/4.2/4.4/10.1）：boot 时一次性自驱 hop（queryTodoList / gap-sync /
#      心跳补偿）是 ①② 断言标的；任何后继 spec 默认 truncate run.jsonl 即抹掉 → 永红。
#      隔离 = reload-app（jsonl 在起 app 时清·boot hop 重流入）+ bootstrap-UC 归属 + --keep（不再清）。
#      4.x 另须 seed-behind-cursor（cursor 落后才触发 gap 回放）。
#   ② 命令型 UC（1.4/5.3 等·自锚新建数据）：脏 DOM 残留行（如 stale [data-send-status=sending]）/
#      inflight 累积 / in-memory 漂移 → 间歇红。隔离 = restore 金标 DB 快照（字节复位·杜绝
#      channel/message 无界增长）+ reload-app（清 DOM/inflight/in-memory）。
# 自动判定：上述 UC 默认走隔离路径（即使纯 `spec <uc>`·满足判据「跟在别 spec 后稳定绿」）；
#   其余已稳健 UC 默认走暖栈快路径（~10s·不重起·开发内循环）。`--fresh` 强隔离 / `--warm` 强快路径。
ISOLATE_UCS="${ISOLATE_UCS:-1.4 5.3 10.1 4.1 4.2 4.4}"   # 默认走隔离的 flaky-prone UC 集（可 env 扩）
SELF_DRIVEN_BEHIND_UCS="4.1 4.2 4.4"                       # 自驱 + 须 seed-behind-cursor（gap 触发）
SELF_DRIVEN_PLAIN_UCS="10.1"                               # 自驱·无须 behind（hello 自带 about-me）
_uc_in_set() { local uc="$1" set="$2" x; for x in $set; do [ "$x" = "$uc" ] && return 0; done; return 1; }
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
    # #1 测试隔离（C014）：suite 起点冷启前对齐 cursor 到本地高水位 → 消除累积 DB 的
    # cursor=0 风暴（实测 196/219 cursor=0 → 200+ proactive resync 占满 WS → send echo 超窗红）。
    info "对齐 cursor 到高水位（seed-align-cursor·#1 冷启零风暴·C014）"
    bash "$REPO_ROOT/scripts/seed-align-cursor.sh" || warn "cursor 对齐失败（继续起 app·可能风暴）"
    _start_app_cargo ""
  fi
  echo "up @ $(date)" >"$STATE_FILE"
  ok "暖栈常驻就绪（ng 1420 + app 4445）·后续 \`harness.sh spec <uc>\` 只重跑 wdio（~10s）"
}

cmd_spec() {
  local uc="" keep_jsonl="" force_fresh="" force_warm=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --keep)  keep_jsonl="1" ;;
      --fresh) force_fresh="1" ;;
      --warm)  force_warm="1" ;;
      --*)     die "未知 spec 选项：$1（支持 --fresh|--warm|--keep）" ;;
      *)       [ -z "$uc" ] && uc="$1" || die "多余参数：$1" ;;
    esac
    shift
  done
  [ -n "$uc" ] || die "用法：harness.sh spec <uc-id> [--fresh|--warm|--keep]（如 6.4）"
  frontend_healthy  || die "前端 1420 未就绪 —— 先 \`harness.sh up\`"
  local spec_file="test/specs/uc-${uc}.e2e.mjs"
  [ -f "$REPO_ROOT/$spec_file" ] || die "spec 不存在：$spec_file"

  # —— 隔离判定（C014）：--warm 强快路径；--fresh 强隔离；否则 ISOLATE_UCS 命中即自动隔离 ——
  local isolate=""
  if [ -n "$force_warm" ]; then isolate=""
  elif [ -n "$force_fresh" ]; then isolate="1"
  elif _uc_in_set "$uc" "$ISOLATE_UCS"; then isolate="1"
  fi

  if [ -n "$isolate" ]; then
    _spec_isolated "$uc" "$spec_file"; return $?
  fi

  # —— 暖栈快路径（已稳健 UC·开发内循环·~10s）——
  webdriver_healthy || die "webdriver 4445 未就绪 —— 先 \`harness.sh up\`（Rust 改了用 reload-app）"
  # 内核自驱 UC 的 boot hop 在 app boot 时已流过——若 truncate run.jsonl 会抹掉（reducer 抽空假红）。
  # --keep 跳过 truncate（保 boot 自驱 hop）；普通命令 round-trip UC 仍默认 truncate（防跨轮串味）。
  if [ -n "$keep_jsonl" ]; then info "保 run.jsonl（--keep·内核自驱 UC boot hop 不清）"
  else : >"$HELIX_RUN_JSONL" 2>/dev/null || true; fi
  info "暖栈跑 spec：${spec_file}（app 不重起·仅 wdio）"
  if run_wdio --spec "$spec_file"; then ok "四面报告全绿（uc-${uc}）"; return 0
  else warn "wdio 红（uc-${uc}）—— reducer「断在哪一跳」见上 / ${APP_LOG}"; return 1; fi
}

# —— 隔离路径（C014）：把 app 复位到确定起点再跑 spec·令结果跨跑序一致 ——
# 命令型 UC：reload（清 DOM/inflight/in-memory·保 live cursor·无同步风暴）；自锚新建 id 跨跑序绿。
#   （full DB restore 默认关·LOOPFORGE_RESTORE_DB=1 才开——stale cursor 会引发同步风暴·见下注 §2.3）
# 自驱 UC：reload + bootstrap-UC 归属 + 不二次 truncate（boot hop 是 ①② 标的）；4.x 另 seed-behind-cursor。
# 自驱 UC **不** restore DB——其 cursor 须跟 server 实时水位（冻结 cursor 会落出事件保留窗）。
_spec_isolated() {
  local uc="$1" spec_file="$2"
  local self_behind="" self_plain="" self_driven="" bootstrap_uc=""
  if _uc_in_set "$uc" "$SELF_DRIVEN_BEHIND_UCS"; then self_behind="1"; self_driven="1"
  elif _uc_in_set "$uc" "$SELF_DRIVEN_PLAIN_UCS"; then self_plain="1"; self_driven="1"; fi
  [ -n "$self_driven" ] && bootstrap_uc="UC-${uc}"

  info "隔离路径（C014·确定起点）：uc-${uc} $([ -n "$self_driven" ] && echo '内核自驱·reload+bootstrap+keep' || echo '命令型·reload（清DOM/inflight/in-memory·保live cursor）')"

  # —— 停 app（释放 DB 句柄）——
  pkill -f "cargo run --manifest-path src-tauri" 2>/dev/null || true
  pkill -f "target/debug/$APP_BIN_NAME" 2>/dev/null || true
  local pid; pid="$(lsof -ti:"$WEBDRIVER_PORT" 2>/dev/null || true)"; [ -n "$pid" ] && kill $pid 2>/dev/null || true
  sleep 1

  # —— 命令型 UC：可选 restore 金标 DB 快照（默认**关**·LOOPFORGE_RESTORE_DB=1 开）——
  # ⚠️ 实测教训（2026-06-27）：full DB restore 把 cursor 一并还原到**冻结时的旧水位** →
  #   reload 后 hello 见 local cursor 远落后 server → 触发冷启自愈 catch-up 同步风暴
  #   （app 日志 "stuck_channels=N" + 数十条 ws-send），风暴与本 UC 的 WS echo 抢道 →
  #   命令型 UC 的 DOM 更新（如 5.3 关闭行移除）被埋/迟到 → 20s 超时假红。
  #   故**默认不 restore**：reload 本身已清 DOM/inflight/in-memory，且保留 **live cursor**
  #   （跟 server 实时水位·无风暴）→ 命令型 UC 自锚新建 id·跨跑序确定绿。
  #   restore 仅作「显式 DB 行复位」工具（累积 channel/message 太多时手动 LOOPFORGE_RESTORE_DB=1
  #   清一次·须接受随之的一次同步风暴）·或 `harness.sh seed-freeze` 后手动 seed-snapshot restore。
  if [ -z "$self_driven" ] && [ "${LOOPFORGE_RESTORE_DB:-0}" = "1" ]; then
    warn "LOOPFORGE_RESTORE_DB=1：restore 金标快照（将引发一次冷启同步风暴·见 C014）"
    bash "$REPO_ROOT/scripts/seed-snapshot.sh" restore || die "DB 快照还原失败（C014）"
  fi
  # —— 自驱 4.x：cursor 落后态（gap 回放触发·复用 C003/C004 决策 A）——
  # —— 非-behind（命令型 / 自驱-plain 如 10.1）：cursor 前推对齐高水位 → 冷启零风暴（#1·C014）——
  if [ -n "$self_behind" ]; then
    info "seed-behind-cursor（自驱 ${uc}·cursor 落后触发 gap/补偿回放）"
    bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "cursor 落后重置失败（C014）"
  else
    info "对齐 cursor 到高水位（seed-align-cursor·命令型/自驱-plain·冷启零风暴·#1·C014）"
    bash "$REPO_ROOT/scripts/seed-align-cursor.sh" || warn "cursor 对齐失败（继续·可能风暴）"
  fi

  # —— 起 app（bootstrap-UC 归属自驱 boot hop；起 app 即 truncate jsonl·boot hop 重流入）——
  # 注：_start_app_cargo 在起进程前已 `: >jsonl` 清空·app 从 offset 0 干净 append。
  _start_app_cargo "$bootstrap_uc"

  # —— **不**在此再 truncate jsonl ——
  # 命令型 UC 旧实现此处二次 truncate，但 app 刚 boot 仍在 flush 增量 hop（异步），
  # 截断正被 append 的文件 → app 文件 offset 越过 EOF → 稀疏 null 空洞 → reducer parseErrors
  # 暴涨（实测 26 行 null 垃圾·5.3 隔离假红）。隔离已靠「起 app 时一次 truncate」给干净起点；
  # 命令型 UC 的 boot hop 是别 channel 的（合法 JSON·非本 UC 锚 ch）→ corr-key 认领天然隔离·
  # 不污染本 UC 束。自驱 UC 本就 --keep（boot hop 是 ①② 标的）。两类都无需二次 truncate。
  info "隔离跑 spec：${spec_file}（不二次 truncate·避免截断 app append 中文件产生 null 空洞）"
  if run_wdio --spec "$spec_file"; then ok "四面报告全绿（uc-${uc}·隔离）"; return 0
  else warn "wdio 红（uc-${uc}·隔离）—— reducer「断在哪一跳」见上 / ${APP_LOG}"; return 1; fi
}

cmd_reload_app() {
  local bootstrap_uc="" align_cursor="1"
  if [ "${1:-}" = "--uc4.1" ]; then
    info "UC-4.1：起 app 前重置 cursor 落后态（seed-behind-cursor·C003/C004）"
    bash "$REPO_ROOT/scripts/seed-behind-cursor.sh" || die "cursor 重置失败" 1
    bootstrap_uc="UC-4.1"
    align_cursor=""   # 4.1 需要 seed-behind 制造的 gap·禁对齐（否则抹平回放触发条件）
  elif [ "${1:-}" = "--uc" ] && [ -n "${2:-}" ]; then
    # 通用 bootstrap UC：内核自驱 UC（hello 收尾自驱·无前端命令）须把 hello hop 归本 UC
    # （否则默认 __quiescence__·reducer 按 uc_id 过滤抽空·见 ctx.rs BOOTSTRAP_UC_ENV 注）。
    # UC-10.1 待办列表（queryTodoList → im:todo:updated）即此类：hello 攒 about-me → 自驱拉取。
    bootstrap_uc="$2"
    info "通用 bootstrap UC=${bootstrap_uc}：hello 自驱 hop 归本 UC（内核自驱·非前端命令·如 UC-10.1 待办）"
  fi
  info "重起 app（cargo run·增量编译·ng 保持不动·Rust/Angular 改后用以确保 WKWebView 加载新产物）"
  pkill -f "cargo run --manifest-path src-tauri" 2>/dev/null || true
  pkill -f "target/debug/$APP_BIN_NAME" 2>/dev/null || true
  local pid; pid="$(lsof -ti:"$WEBDRIVER_PORT" 2>/dev/null || true)"; [ -n "$pid" ] && kill $pid 2>/dev/null || true
  sleep 1
  # 冷启前对齐 cursor 到高水位 → 消除累积 DB 的 cursor=0 风暴（#1·C014）；4.1 除外（需 gap）。
  if [ -n "$align_cursor" ]; then
    info "对齐 cursor 到高水位（seed-align-cursor·冷启零风暴·#1·C014）"
    bash "$REPO_ROOT/scripts/seed-align-cursor.sh" || warn "cursor 对齐失败（继续·可能风暴）"
  fi
  _start_app_cargo "$bootstrap_uc"
  ok "app 重起就绪（4445）·ng（1420）未动"
}

cmd_status() {
  frontend_healthy  && ok "前端 1420 健康"      || warn "前端 1420 未就绪"
  webdriver_healthy && ok "webdriver 4445 健康" || warn "webdriver 4445 未就绪"
  [ -f "$STATE_FILE" ] && info "state: $(cat "$STATE_FILE")"
  bash "$REPO_ROOT/scripts/seed-snapshot.sh" status 2>/dev/null || true
}

# —— 冻结金标 DB 快照（C014·--fresh restore 的源）——
cmd_seed_freeze() {
  bash "$REPO_ROOT/scripts/seed-snapshot.sh" freeze
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
  up)          cmd_up ;;
  spec)        shift; cmd_spec "$@" ;;
  reload-app)  shift; cmd_reload_app "$@" ;;
  seed-freeze) cmd_seed_freeze ;;
  status)      cmd_status ;;
  down)        cmd_down ;;
  *)           die "用法：harness.sh {up | spec <uc-id> [--fresh|--warm|--keep] | reload-app [--uc4.1|--uc <UC>] | seed-freeze | status | down}" ;;
esac
