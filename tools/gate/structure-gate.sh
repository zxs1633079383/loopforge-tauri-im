#!/usr/bin/env bash
# structure-gate.sh —— 单文件行数硬顶护栏（many small files / 单一职责）
#
# 不变量（CLAUDE.md 代码风格 + helix code-structure-ddd.md §1）：
#   crates/**/src/**.rs 单文件硬顶 300 行；超限即拆（抽工具 / mod.rs 只 re-export）。
#
# 存量债 WHITELIST：`path baseline_lines` 映射，机器强制「只减不增」——
#   当前行数 > baseline 即 FAIL（baseline = 锁定时行数，红线 = 不许再涨）。
#   拆小到 ≤300 后从 WHITELIST 删该行 → 重新受 300 硬顶。
#   ⚠️ 严禁把 baseline 往**大**改抹掉 FAIL（等价绕闸）；baseline 只许往小改。
#
# 用法：
#   tools/gate/structure-gate.sh
#
# 退出码：0 = 通过 / 1 = 超限。输出可 grep 前缀：STRUCT-GATE。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "STRUCT-GATE 🔴 不在 git 仓库内" >&2; exit 2
}
cd "$ROOT"

MAX_LINES=300
fail=0

# ── 存量债白名单（src/ 已超 300 行，待拆 backlog）：`path baseline_lines` ──
# 当前本仓无超限源文件 → 白名单为空。新增超限 = 直接 FAIL。
WHITELIST=(
  # "crates/<crate>/src/<file>.rs <baseline_lines>"
)

# 命中白名单 → stdout 回传 baseline + return 0；未命中 → return 1。
whitelist_baseline() {
  local f="$1"
  for entry in "${WHITELIST[@]}"; do
    if [ "${entry% *}" = "$f" ]; then echo "${entry##* }"; return 0; fi
  done
  return 1
}

echo "STRUCT-GATE 行数闸（crates/**/src/**.rs ≤ ${MAX_LINES}，存量豁免 ${#WHITELIST[@]} 个·基线只减不增）"

found=0
while IFS= read -r f; do
  found=$((found + 1))
  lines=$(wc -l < "$f" | tr -d ' ')
  [ "$lines" -le "$MAX_LINES" ] && continue
  if base=$(whitelist_baseline "$f"); then
    if [ "$lines" -gt "$base" ]; then
      echo "STRUCT-GATE   ✗ 存量债增长 $f = $lines 行 > 基线 ${base} —— 违『只减不增』，拆分回正或收口到基线"
      fail=1
    else
      echo "STRUCT-GATE   · 豁免(存量债) $f = $lines 行（≤基线 ${base}，只减不增 OK）"
    fi
  else
    echo "STRUCT-GATE   ✗ 超限(新增) $f = $lines 行 > ${MAX_LINES} —— 拆分（many small files / mod.rs 只 re-export）"
    fail=1
  fi
done < <(find crates -path '*/src/*' -name '*.rs' -not -path '*/target/*' 2>/dev/null | sort)

echo "STRUCT-GATE 扫描了 ${found} 个 src/*.rs 文件"
if [ "$fail" -eq 0 ]; then
  echo "STRUCT-GATE ✅ PASS"
else
  echo "STRUCT-GATE 🔴 FAIL —— 见上方 ✗ 项"
fi
exit "$fail"
