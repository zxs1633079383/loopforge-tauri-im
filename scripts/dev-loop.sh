#!/usr/bin/env bash
# scripts/dev-loop.sh —— 跨两 repo 自动修复闭环骨架（改引擎 → 重建 → 重跑 → 读 diff → 循环）。
#
# 两 repo（rules/contract-readonly-autofix.md §4）：
#   - helix checkout（改引擎实现）   ：$HELIX_ROOT
#   - loopforge testbed（重建重跑）   ：$REPO_ROOT
#
# 一轮闭环（spec §9 W4 / golden-replay-determinism.md）：
#   ① （loop 驱动器）改 helix 仓 Rust 实现     ← 本脚本不改代码，留给驱动器
#   ② 重建 testbed（src-tauri 拉新 path dep 重编）
#   ③ 确定性重跑（Replay 轨 → 四面断言）
#   ④ 读 reducer「断在哪一跳」diff           ← 喂回驱动器决策
#   ⑤ 绿则停 / 红则回 ①                       ← 循环条件
#
# 本脚本提供「一轮」的可复用执行体（rebuild → replay → 收 diff），
# 以及围绕它的循环骨架；①「改实现」与⑤「据 diff 决策下一改」是 loop 驱动器
# （helix-loop-engine skill / Workflow / /loop）的职责 —— 见下方 TODO 接缝。
#
# 用法：
#   scripts/dev-loop.sh once            # 跑一轮（rebuild + replay + 落 diff），人看结果
#   scripts/dev-loop.sh loop [MAX]      # 循环骨架（MAX 轮，默认 5）；每轮调驱动器钩子
# 契约只读护栏：本闭环只允许改 helix 实现 + 渲染壳，禁改 tape / 期望 / projection-schema /
#   真机curl真源（rules/contract-readonly-autofix.md §1）。
set -uo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

SUB="${1:-once}"
ensure_log_dir
DIFF_OUT="$RUN_LOG_DIR/reducer-diff.txt"

# —— 前置：两 repo 都在 ——
assert_two_repos() {
  [ -d "$HELIX_ROOT" ]   || die "helix checkout 不存在：$HELIX_ROOT（经 HELIX_ROOT 覆盖）"
  [ -f "$HELIX_ROOT/Cargo.toml" ] || die "$HELIX_ROOT 不像 helix workspace（缺 Cargo.toml）"
  [ -d "$REPO_ROOT/src-tauri" ]   || die "testbed 缺 src-tauri（W1 落地后）"
  ok "两 repo 就位：helix=$HELIX_ROOT · testbed=$REPO_ROOT"
}

# —— ② 重建 testbed（path dep 指向 helix，自动拉到引擎改动）——
rebuild_testbed() {
  require_cmd cargo "src-tauri 构建"
  info "重建 testbed（src-tauri debug，拉 helix path dep 改动）"
  ( cd "$REPO_ROOT" && cargo build --manifest-path src-tauri/Cargo.toml ) \
    || die "testbed 重建失败 —— 引擎改动可能编译不过；修复后重试"
  ok "testbed 重建完成"
}

# —— ③ 确定性重跑（Replay 轨）——
rerun_replay() {
  info "确定性重跑（Replay 轨，1 次）"
  # 复用 replay.sh：它自管前端/app/wdio 起停 + 四面断言。
  if bash "$LF_LIB_DIR/replay.sh" 1; then
    return 0
  else
    return 1
  fi
}

# —— ④ 收 reducer diff（W3 reducer 在 wdio spec 内跑，「断在哪一跳」打到控制台）——
# W3 实现（test/specs/uc-send-1.e2e.mjs）：读 $HELIX_RUN_JSONL → runFourFacet 聚 corr_key
# → console.log('[UC-send-1 四面报告] ...') + 逐面 '✖ <facet>: ...'。
# 故 reducer diff 真源 = wdio 控制台输出（_lib.sh 的 run_wdio 已 tee 到 $WDIO_OUT）。
# 本函数从 $WDIO_OUT 抠四面报告行落 $DIFF_OUT，供 loop 驱动器据此改实现。
collect_reducer_diff() {
  if [ -f "$WDIO_OUT" ]; then
    # 抠四面报告 + 断点行 + 原始 run.jsonl 路径，组装喂驱动器的 diff 快照。
    {
      echo "# reducer diff @ $(date '+%F %T')"
      echo "# run.jsonl: $HELIX_RUN_JSONL"
      grep -E '\[UC-.* 四面报告\]|✖ |断在' "$WDIO_OUT" || echo "(无四面报告行——可能在四面断言前就失败，见 $WDIO_OUT)"
    } >"$DIFF_OUT"
    ok "reducer diff 已收：$DIFF_OUT"
  else
    warn "未找到 wdio 输出（$WDIO_OUT）—— replay 可能未跑到 wdio。以退出码为准。"
    : >"$DIFF_OUT"
  fi
}

# —— 一轮闭环执行体 ——
run_one_round() {
  assert_two_repos
  rebuild_testbed
  if rerun_replay; then
    collect_reducer_diff
    ok "本轮：四面全绿（闭环可停）"
    return 0
  else
    collect_reducer_diff
    warn "本轮：有红 —— diff 见 $DIFF_OUT（喂回 loop 驱动器决策下一改）"
    return 1
  fi
}

case "$SUB" in
  once)
    log "${C_DIM}== dev-loop.sh once：跑一轮（rebuild + replay + 收 diff）==${C_RST}"
    run_one_round
    ;;

  loop)
    MAX="${2:-5}"
    case "$MAX" in (*[!0-9]*|'') die "MAX 须为正整数：'$MAX'";; esac
    log "${C_DIM}== dev-loop.sh loop：自动修复循环骨架（≤${MAX} 轮）==${C_RST}"
    warn "循环骨架：①「改 helix 实现」与⑤「据 diff 决策」是 loop 驱动器职责，本脚本留接缝。"
    for ((round=1; round<=MAX; round++)); do
      log ""
      log "${C_DIM}######## 闭环轮 $round/$MAX ########${C_RST}"

      # ───────────────────────────────────────────────────────────────
      # TODO（loop 驱动器接缝 ①）：在此调驱动器「据上轮 diff 改 helix 实现」。
      #   驱动器（helix-loop-engine skill / Workflow / /loop）读 $DIFF_OUT，
      #   定位「断在哪一跳」→ 在 $HELIX_ROOT 改对应 Rust 实现（契约只读，禁改期望/tape）。
      #   接法示例：
      #     bash "$DEVLOOP_FIX_HOOK" "$DIFF_OUT" "$HELIX_ROOT"   # 由 env 注入
      #   未注入钩子时本脚本不改代码，仅 rebuild+replay 验证当前状态。
      # ───────────────────────────────────────────────────────────────
      if [ -n "${DEVLOOP_FIX_HOOK:-}" ] && [ -x "$DEVLOOP_FIX_HOOK" ]; then
        info "调 fix 钩子：$DEVLOOP_FIX_HOOK（据 $DIFF_OUT 改 helix 实现）"
        "$DEVLOOP_FIX_HOOK" "$DIFF_OUT" "$HELIX_ROOT" \
          || warn "fix 钩子返回非 0（本轮无改动或修复失败）"
      else
        info "未注入 DEVLOOP_FIX_HOOK —— 本轮只验证当前实现（不自动改 helix）。"
      fi

      # ②③④
      if run_one_round; then
        ok "闭环收敛于第 $round 轮（四面全绿）"
        exit 0
      fi

      # ───────────────────────────────────────────────────────────────
      # TODO（loop 驱动器接缝 ⑤）：在此据 $DIFF_OUT 判「是否继续 / 换策略 / 早停」。
      #   默认：红则进下一轮。驱动器可据 diff 决定 break（如同一跳连续 N 轮不动 = 卡死告警）。
      # ───────────────────────────────────────────────────────────────
    done
    die "循环达上限 ${MAX} 轮仍未全绿 —— 见 $DIFF_OUT；可能需人介入或换修复策略。" 1
    ;;

  *)
    die "未知子命令：'$SUB'（用 once | loop [MAX]）"
    ;;
esac
