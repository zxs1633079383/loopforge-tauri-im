#!/usr/bin/env bash
# scripts/conductor-tick.sh —— Conductor 动态 loop reactor 的「一个 tick」可执行骨架。
#
# 真源伪码：docs/orchestration/conductor.md §1（reactor 循环）+ §3（骨架）。
# 角色：Conductor 本体是**主对话持有的动态 loop**（ScheduleWakeup 驱动·非 Workflow 脚本）。
#       本脚本只把「一个 tick」的纯读+决策逻辑落成可跑可观测的命令——
#       读三 log + git status → 算 runnable 集 → 吐一行状态窗 → 打印「建议下次 wakeup 延时」。
#       真正的 ScheduleWakeup / 派 background agent / Workflow 由主对话调（本脚本只算+建议·零副作用）。
# 本切（S3）只证「空转可观测」：此时三 log 皆空 → 全 PENDING → runnable=续 B(pending)。真派活在 S4。
#
# 用法：bash scripts/conductor-tick.sh [migration-dir]
set -euo pipefail

LF_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$LF_LIB_DIR/_lib.sh"

MIGRATION_DIR="${1:-$REPO_ROOT/docs/migration}"
READY_LOG="$MIGRATION_DIR/HELIX_READY.log"
GREEN_LOG="$MIGRATION_DIR/BOUND_GREEN.log"
NEED_LOG="$MIGRATION_DIR/NEED_HELIX.log"
[ -d "$MIGRATION_DIR" ] || die "迁移信号目录不存在：$MIGRATION_DIR"

# 台账全行集（与 render-board.sh 同源·19 条·见台账 §4）。
LEDGER=(
  applyBatchUpdated applyChannelClosed applyChannelCreated applyChannelIncrement
  applyChannelUpdate applyChannelUpdateByPost applyChannelUpdatePost applyDialogList
  applyMemberNickname applyMemberUpdated applyMembersSnapshot applyMessageItem
  applyMessagesQueryResult applyOlderLoaded applyPostDeleted applyPostSending
  applyReadResult applyScheduleCreated applyTodoUpdated
)
LEDGER_N=${#LEDGER[@]}

extract_names() {
  local f="$1"; [ -f "$f" ] || return 0
  awk -F'\t' '
    /^[[:space:]]*#/ { next } /^[[:space:]]*$/ { next }
    { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); if ($2 != "") print $2 }
  ' "$f" | sort -u
}
in_set() { printf '%s\n' "$2" | grep -qxF "$1"; }

READY_SET="$(extract_names "$READY_LOG")"
GREEN_SET="$(extract_names "$GREEN_LOG")"
NEED_SET="$(extract_names "$NEED_LOG")"

# ── tick 步骤 2：算 runnable（conductor.md §1.2 / §3）──────────────────────
rows_pending=0       # ledger − ready          → 喂 B（续/派 helix 迁移）
rows_unlocked=0      # ready − green           → 派 A2 解锁批
needs_from_a2=0      # NEED_HELIX 未被 B 消费的 → 插队喂 B（反向边）
for name in "${LEDGER[@]}"; do
  in_set "$name" "$READY_SET" || { rows_pending=$((rows_pending+1)); continue; }
  in_set "$name" "$GREEN_SET" || rows_unlocked=$((rows_unlocked+1))
done
# needs_from_a2：NEED_HELIX 里 B 还没在 HELIX_READY 里满足的行。
while IFS= read -r n; do
  [ -z "$n" ] && continue
  in_set "$n" "$READY_SET" || needs_from_a2=$((needs_from_a2+1))
done <<< "$NEED_SET"

# cross_repo_gap：worktrees/*/NEED_CSES_IM_SERVER_FIX.md（§6.5 跨项目契约协调·硬停信号）。
shopt -s nullglob
cross_gap_files=( "$REPO_ROOT"/worktrees/*/NEED_CSES_IM_SERVER_FIX.md )
shopt -u nullglob
cross_gap=${#cross_gap_files[@]}

# ── tick 步骤 2.5：派活建议（conductor.md §3·本脚本只建议·不真派）─────────────
runnable=()
if [ "$rows_pending" -gt 0 ] || [ "$needs_from_a2" -gt 0 ]; then
  runnable+=("续 B 长 loop（helix 迁移·pending=$rows_pending + needs_from_a2=${needs_from_a2}）")
fi
if [ "$rows_unlocked" -gt 0 ]; then
  runnable+=("派 A2 解锁批 Workflow(ui-a2-bind·rows_unlocked=$rows_unlocked)")
fi

# ── 异常闸门（conductor.md §2·HEAD 超 30min 不动 ∧ 有未提交 .rs/.ts/.go → 告警）──
alert=""
head_epoch="$(git -C "$REPO_ROOT" log -1 --format=%ct 2>/dev/null || echo 0)"
now_epoch="$(date +%s)"
head_age_min=$(( (now_epoch - head_epoch) / 60 ))
uncommitted_code="$(git -C "$REPO_ROOT" status --porcelain 2>/dev/null | grep -E '\.(rs|ts|go)$' || true)"
uncommitted_code_n=0
[ -n "$uncommitted_code" ] && uncommitted_code_n="$(printf '%s\n' "$uncommitted_code" | grep -c . || true)"
if [ "$head_age_min" -gt 30 ] && [ "$uncommitted_code_n" -gt 0 ]; then
  alert="疑似中断留半成品：HEAD ${head_age_min}min 不动 ∧ ${uncommitted_code_n} 个未提交 .rs/.ts/.go"
fi

# ── tick 步骤 6：排下一次 wakeup（动态 pacing·conductor.md §2）────────────────
# 选择逻辑（真 ScheduleWakeup 由主对话调·此处只算建议延时 + 理由）：
#   解锁在流(rows_unlocked>0)      → 270s（缓存热·别踩 300s fleet 对齐）
#   B 卡 NEED_FIX / 异常闸门命中    → 1500s（省 cache·一次 miss 换长等）
#   全空闲 / 引导期(全 PENDING)     → 1200s（长心跳兜底·等事件驱动唤醒）
if [ "$rows_unlocked" -gt 0 ]; then
  wakeup=270;  wakeup_reason="解锁在流（rows_unlocked=${rows_unlocked}·热缓存）"
elif [ -n "$alert" ] || [ "$cross_gap" -gt 0 ]; then
  wakeup=1500; wakeup_reason="卡点/异常（省 cache·长等）"
else
  wakeup=1200; wakeup_reason="空闲/引导期（长心跳兜底·靠完成事件驱动唤醒）"
fi

# ── tick 步骤 5：状态窗（一行·conductor.md §1.5）──────────────────────────────
green_n="$(printf '%s\n' "$GREEN_SET" | grep -c . || true)"
budget="⏱ wakeup ${wakeup}s（${wakeup_reason}）"
warn_seg="—"
[ -n "$alert" ] && warn_seg="$alert"
[ "$cross_gap" -gt 0 ] && warn_seg="跨仓 gap×$cross_gap → 硬停找人"

printf '📊 PENDING %d / 🟦 待绑 %d / 🟩 绿 %d / ⚠️ %s / %s\n' \
  "$rows_pending" "$rows_unlocked" "$green_n" "$warn_seg" "$budget"

# ── 决策面（多行·供主对话据此调 ScheduleWakeup / 派 agent / Workflow）──────────
echo "── tick 决策（主对话据此调度·本脚本零副作用）──"
if [ "$cross_gap" -gt 0 ]; then
  echo "  ⛔ 硬停：跨仓 gap × ${cross_gap}（$(printf '%s ' "${cross_gap_files[@]##*/worktrees/}")）→ fork cses-im-server 协调 worktree·不强 merge"
fi
if [ "${#runnable[@]}" -eq 0 ]; then
  echo "  · runnable 空（全 BOUND_GREEN 或全部在外部等待）"
else
  for r in "${runnable[@]}"; do echo "  ▸ runnable: $r"; done
fi
echo "  ⏱ 建议下次 wakeup 延时: ${wakeup}s（${wakeup_reason}）"
echo "    （真 ScheduleWakeup 由主对话调；harness 在 B/A2 完成时事件驱动唤醒优先于本兜底心跳）"
