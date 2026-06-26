#!/usr/bin/env bash
# scripts/render-board.sh —— 三信号 log → 泳道台账板（helix 纯渲染壳迁移进度·人读视图）。
#
# 设计：纯读不写（绝不碰三 log）、fail-loud、零依赖（bash + awk + sort）。
# 用法：bash scripts/render-board.sh [migration-dir]
#   migration-dir 缺省 = docs/migration/（可传 fixture 目录供测试）。
#
# 输入：<dir>/{HELIX_READY,BOUND_GREEN,NEED_HELIX}.log（单写者 append-only·见 orchestration/README §4）。
# 输出：18 条 apply* 渲染路径逐行状态 + 汇总行 `PENDING n / 🟦m / 🟨b / 🟩k`。
#
# ── 泳道状态语义（4 lane · 3 log 派生·见 README §3 解锁状态机 / conductor.md §1）──
#   ⬛ PENDING      = 该行 ∉ HELIX_READY.log ∧ ∉ BOUND_GREEN.log（helix 还没吐 render-ready）
#   🟨 BINDABLE     = 该行 ∈ HELIX_READY.log ∧ ∉ BOUND_GREEN.log（已物理解锁·A2 可绑/绑定中）  ← 行级独占标记
#   🟩 BOUND_GREEN  = 该行 ∈ BOUND_GREEN.log（已绑 + 四面 reducer 裁绿）                      ← 行级独占标记
#   🟦 HELIX_READY  = 累计解锁里程碑总数 = 🟨 + 🟩（B 已 re-pin merge 过的行·含后来绑绿的）   ← 仅汇总叠加·无行级独占标记
# 注：conductor.md emitStatusLine 把 🟦/🟨 合并叫「待绑」(ready−green)；本板拆细——
#     🟦 显累计解锁、🟨 显当前可绑(ready−green)，两者在汇总行并列，行级用 ⬛/🟨/🟩 三态。
set -euo pipefail

LF_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$LF_LIB_DIR/_lib.sh"

MIGRATION_DIR="${1:-$REPO_ROOT/docs/migration}"
READY_LOG="$MIGRATION_DIR/HELIX_READY.log"
GREEN_LOG="$MIGRATION_DIR/BOUND_GREEN.log"
NEED_LOG="$MIGRATION_DIR/NEED_HELIX.log"

[ -d "$MIGRATION_DIR" ] || die "迁移信号目录不存在：$MIGRATION_DIR"

# ── 台账全行集 = 18 条 apply* 渲染路径（真源：docs/纯渲染壳-铁律与helix迁移台账.md §4·
#    实测 `grep -rhoE '\bapply[A-Z][a-zA-Z]*\s*\(' src/app/im/*.ts` 的 18 个方法定义（S7 #56：−applyMembersSnapshot −applyMemberUpdated +applyChannelMembers））──
# 维护规则：src/app/im 新增/删除一个 apply* 渲染路径 → 同步增删本清单 + 台账 §4（保持 18 这个分母诚实）。
LEDGER=(
  applyBatchUpdated
  applyChannelClosed
  applyChannelCreated
  applyChannelIncrement
  applyChannelMembers
  applyChannelUpdate
  applyChannelUpdateByPost
  applyChannelUpdatePost
  applyDialogList
  applyMemberNickname
  applyMessageItem
  applyMessagesQueryResult
  applyOlderLoaded
  applyPostDeleted
  applyPostSending
  applyReadResult
  applyScheduleCreated
  applyTodoUpdated
)
LEDGER_N=${#LEDGER[@]}

# 抽某 log 的第 2 列（apply_name），去注释/空行，输出唯一名字集（每行一个）。
extract_names() {
  local f="$1"
  [ -f "$f" ] || return 0
  awk -F'\t' '
    /^[[:space:]]*#/ { next }     # 注释行
    /^[[:space:]]*$/ { next }     # 空行
    { gsub(/^[[:space:]]+|[[:space:]]+$/, "", $2); if ($2 != "") print $2 }
  ' "$f" | sort -u
}

# 名字是否在某集合（换行分隔字符串）中。
in_set() {
  local name="$1" set="$2"
  printf '%s\n' "$set" | grep -qxF "$name"
}

READY_SET="$(extract_names "$READY_LOG")"
GREEN_SET="$(extract_names "$GREEN_LOG")"
NEED_SET="$(extract_names "$NEED_LOG")"

pending=0; bindable=0; green=0; ready_total=0

# 标题
printf '泳道台账板 — helix 纯渲染壳迁移（%d 条 apply* 渲染路径 · 第二北极星）\n' "$LEDGER_N"
printf '来源: %s/{HELIX_READY,BOUND_GREEN,NEED_HELIX}.log（单写者 append-only · README §4）\n\n' "$MIGRATION_DIR"

# 逐行状态（行级独占：⬛/🟨/🟩；🟩 优先于 🟨）
for name in "${LEDGER[@]}"; do
  is_green=0; is_ready=0
  in_set "$name" "$GREEN_SET" && is_green=1
  in_set "$name" "$READY_SET" && is_ready=1
  # green 行必然曾 ready（即便 B 漏写 ready）→ 计 ready_total。
  if [ "$is_green" -eq 1 ]; then
    green=$((green+1)); ready_total=$((ready_total+1))
    printf '  🟩 %-26s BOUND_GREEN\n' "$name"
  elif [ "$is_ready" -eq 1 ]; then
    bindable=$((bindable+1)); ready_total=$((ready_total+1))
    # NEED_HELIX 反向需求挂在该行 → 附注（A2 已发现缺字段·插队回 B）。
    if in_set "$name" "$NEED_SET"; then
      printf '  🟨 %-26s BINDABLE   (NEED_HELIX 反向需求挂起)\n' "$name"
    else
      printf '  🟨 %-26s BINDABLE\n' "$name"
    fi
  else
    pending=$((pending+1))
    printf '  ⬛ %-26s PENDING\n' "$name"
  fi
done

# 🟦 HELIX_READY = 累计解锁 = 🟨 + 🟩。
helix_ready=$ready_total

printf '\n汇总: PENDING %d / 🟦%d / 🟨%d / 🟩%d\n' "$pending" "$helix_ready" "$bindable" "$green"

# 一致性自检（可证伪护栏·C008）：四 lane 必须自洽，否则脚本逻辑坏 → fail-loud。
[ $((pending + bindable + green)) -eq "$LEDGER_N" ] \
  || die "泳道计数不自洽：PENDING($pending)+BINDABLE($bindable)+GREEN($green) != $LEDGER_N"
[ "$helix_ready" -eq $((bindable + green)) ] \
  || die "🟦 累计解锁($helix_ready) != 🟨($bindable)+🟩($green)"
