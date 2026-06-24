#!/usr/bin/env bash
# gate.sh —— 护栏聚合器（一键跑全部机器闸门）
#
# 聚合跑：
#   ① contract-readonly-gate.sh  契约只读（防 gaming oracle，最重要）
#   ② mirror-gate.sh             指令文件 CLAUDE.md ↔ AGENTS.md 镜像
#   ③ structure-gate.sh          src/*.rs 单文件 ≤300 行
#
# 任一失败 → 整体 exit 1，末尾打印汇总。
#
# 用法：
#   tools/gate/gate.sh                  # 契约闸默认比 HEAD~1..HEAD
#   tools/gate/gate.sh --staged         # 契约闸比暂存区（pre-commit / pre-push 推荐）
#   tools/gate/gate.sh <base-ref>       # 契约闸比 <base-ref>..HEAD（如集成分支）
#
# ── 挂 pre-push hook（推荐）────────────────────────────────────────────────
#   把下面写进 .git/hooks/pre-push 并 chmod +x：
#       #!/usr/bin/env bash
#       exec "$(git rev-parse --show-toplevel)/tools/gate/gate.sh" --staged
#   （pre-commit 同理；--staged 让契约闸只审本次提交触碰的文件。）
#   或用 husky / pre-commit 框架挂同一行。
#
# 退出码：0 = 全过 / 1 = 任一失败。输出可 grep 前缀：GATE。
set -uo pipefail   # 注意：不用 -e，要让子闸全跑完再汇总（不在第一个失败就退出）

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 透传参数给契约闸（其余两闸不吃参数）
CONTRACT_ARGS=("$@")

declare -a NAMES=(
  "contract-readonly-gate.sh"
  "mirror-gate.sh"
  "structure-gate.sh"
)

declare -a RESULTS=()
overall=0

echo "GATE ══════════ loopforge 护栏聚合 ══════════"
echo

for g in "${NAMES[@]}"; do
  path="${DIR}/${g}"
  echo "GATE ▶ 跑 ${g}"
  if [ "$g" = "contract-readonly-gate.sh" ]; then
    bash "$path" "${CONTRACT_ARGS[@]}"
  else
    bash "$path"
  fi
  rc=$?
  if [ "$rc" -eq 0 ]; then
    RESULTS+=("✅ ${g}")
  else
    RESULTS+=("🔴 ${g} (exit ${rc})")
    overall=1
  fi
  echo
done

echo "GATE ══════════ 汇总 ══════════"
for r in "${RESULTS[@]}"; do
  echo "GATE   $r"
done

if [ "$overall" -eq 0 ]; then
  echo "GATE ✅ 全部护栏通过"
else
  echo "GATE 🔴 有护栏失败 —— 见上方明细，禁止 push / 合入"
fi
exit "$overall"
