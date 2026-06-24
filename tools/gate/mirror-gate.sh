#!/usr/bin/env bash
# mirror-gate.sh —— 指令文件镜像铁律的可执行护栏
#
# 不变量（CLAUDE.md §「指令文件同步铁律」+ helix code-structure-ddd.md §5）：
#   每个含 CLAUDE.md 的目录必须同目录有 AGENTS.md，且两者 `diff` 完全为空。
#   AGENTS.md 是 codex 读的镜像；改一个必须同步另一个。
#
# 用法：
#   tools/gate/mirror-gate.sh
#
# 退出码：0 = 全部成对且一致 / 1 = 缺失或不一致 / 2 = 仓库异常。
# 输出可 grep 前缀：MIRROR-GATE。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "MIRROR-GATE 🔴 不在 git 仓库内" >&2; exit 2
}
cd "$ROOT"

fail=0
checked=0

echo "MIRROR-GATE 扫描所有含 CLAUDE.md 的目录（须有 AGENTS.md 镜像且一致）"

# 找出所有 CLAUDE.md（排除 .git / target / node_modules），取其所在目录
while IFS= read -r c; do
  dir="$(dirname "$c")"
  a="${dir}/AGENTS.md"
  checked=$((checked + 1))
  if [ ! -f "$a" ]; then
    echo "MIRROR-GATE   ✗ 缺镜像：${dir}/ 有 CLAUDE.md 但缺 AGENTS.md"
    echo "MIRROR-GATE       补法：cp ${c} ${a}"
    fail=1
    continue
  fi
  if ! diff -q "$c" "$a" >/dev/null 2>&1; then
    echo "MIRROR-GATE   ✗ 不一致：${c} ↔ ${a}（镜像必须完全相同）"
    echo "MIRROR-GATE       看差异：diff ${c} ${a}"
    fail=1
  fi
done < <(find . -name 'CLAUDE.md' \
            -not -path './.git/*' \
            -not -path '*/target/*' \
            -not -path '*/node_modules/*' | sort)

# 反向：是否有孤儿 AGENTS.md（有 AGENTS.md 但无 CLAUDE.md）
while IFS= read -r a; do
  dir="$(dirname "$a")"
  c="${dir}/CLAUDE.md"
  if [ ! -f "$c" ]; then
    echo "MIRROR-GATE   ✗ 孤儿镜像：${dir}/ 有 AGENTS.md 但缺 CLAUDE.md（应成对）"
    fail=1
  fi
done < <(find . -name 'AGENTS.md' \
            -not -path './.git/*' \
            -not -path '*/target/*' \
            -not -path '*/node_modules/*' | sort)

echo "MIRROR-GATE 检查了 ${checked} 个 CLAUDE.md 目录"
if [ "$fail" -eq 0 ]; then
  echo "MIRROR-GATE ✅ PASS —— 全部成对且镜像一致"
else
  echo "MIRROR-GATE 🔴 FAIL —— 见上方 ✗ 项"
fi
exit "$fail"
