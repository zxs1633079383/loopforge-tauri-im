#!/usr/bin/env bash
# contract-readonly-gate.sh —— 契约只读护栏（rules/contract-readonly-autofix.md 的可执行硬化）
#
# 核心不变量（防 gaming oracle）：
#   自动修复 agent **只能改 helix 引擎实现 + 本仓渲染壳**；冻结契约一律只读。
#   红转绿只能靠改实现，绝不许靠改期望 / golden / 投影契约把红变绿。
#   契约真要变 → 出「契约变更提案 + 证据」交人审，禁自改（见 rule §2）。
#
# 本闸门：扫一段 git diff，若触及任一**契约冻结路径**就 FAIL（exit 1）。
#
# 冻结路径集（四类）：
#   ① **/projection-schema.md        投影契约（21 工厂字段集，冻结）
#   ② **/真机curl真源.md             outbound 契约（真抓包 body+头，冻结）
#   ③ **/tests/fixtures/*.tape.json  golden tape（确定性源，改它=改题）
#   ④ test/expectations/**           四面期望文件（oracle 本体，每 UC）
#
# 用法：
#   tools/gate/contract-readonly-gate.sh                 # 默认比 HEAD~1..HEAD（已提交 diff）
#   tools/gate/contract-readonly-gate.sh --staged        # 比暂存区（pre-commit / pre-push 推荐）
#   tools/gate/contract-readonly-gate.sh <base-ref>      # 比 <base-ref>..HEAD（如 main / 集成分支）
#
# 退出码：0 = 未触契约 / 1 = 触碰冻结契约（违规）/ 2 = 用法或仓库异常。
# 输出可 grep 前缀：CONTRACT-GATE。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "CONTRACT-GATE 🔴 不在 git 仓库内，无法取 diff" >&2; exit 2
}
cd "$ROOT"

# ── 解析 diff 范围 ─────────────────────────────────────────────────────────
MODE="committed"
DIFF_DESC=""
case "${1:-}" in
  --staged|--cached)
    MODE="staged"; DIFF_DESC="暂存区（--staged）"
    ;;
  "")
    # 默认：HEAD~1..HEAD；若仓库只有 1 个 commit（无 HEAD~1）→ 退化为「全部已跟踪文件首版」无意义，
    # 改为对比空树（首 commit 全量）以保证首 commit 也能被审。
    if git rev-parse --verify -q HEAD~1 >/dev/null 2>&1; then
      DIFF_DESC="HEAD~1..HEAD"
    else
      MODE="first-commit"; DIFF_DESC="首 commit 全量（无 HEAD~1）"
    fi
    ;;
  *)
    BASE="$1"
    git rev-parse --verify -q "$BASE" >/dev/null 2>&1 || {
      echo "CONTRACT-GATE 🔴 base ref 不存在：$BASE" >&2; exit 2
    }
    MODE="range"; DIFF_DESC="${BASE}..HEAD"
    ;;
esac

# ── 取变更文件清单（仅路径，含改名两端）──────────────────────────────────
# 关键：-c core.quotepath=false —— 否则 git 把非 ASCII 路径（如「真机curl真源.md」）
# 用八进制转义并加双引号输出，basename 匹配会漏掉中文契约文件（实测漏检 ②）。
collect_changed() {
  case "$MODE" in
    staged)       git -c core.quotepath=false diff --cached --name-only --diff-filter=ACMRTD ;;
    range)        git -c core.quotepath=false diff "$BASE"..HEAD --name-only --diff-filter=ACMRTD ;;
    first-commit) git -c core.quotepath=false diff-tree --no-commit-id --name-only -r HEAD ;;
    committed)    git -c core.quotepath=false diff HEAD~1..HEAD --name-only --diff-filter=ACMRTD ;;
  esac
}

# ── 冻结路径判定（basename / glob 语义，跨任意目录层级）────────────────────
# 返回违规归类标签；非契约文件返回空。
classify_frozen() {
  local f="$1"
  local base; base="$(basename "$f")"
  # ① 投影契约
  if [ "$base" = "projection-schema.md" ]; then echo "① 投影契约 projection-schema.md"; return 0; fi
  # ② outbound 契约（含中文名）
  if [ "$base" = "真机curl真源.md" ]; then echo "② outbound 契约 真机curl真源.md"; return 0; fi
  # ③ golden tape：任意 .../tests/fixtures/*.tape.json
  case "$f" in
    */tests/fixtures/*.tape.json) echo "③ golden tape ($f)"; return 0 ;;
  esac
  # ④ 四面期望文件：test/expectations/** 任意层级
  case "$f" in
    test/expectations/*|*/test/expectations/*) echo "④ 四面期望文件 ($f)"; return 0 ;;
  esac
  return 1
}

echo "CONTRACT-GATE 扫描契约冻结路径 · diff 范围 = ${DIFF_DESC}"

violations=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if label="$(classify_frozen "$f")"; then
    echo "CONTRACT-GATE   ✗ 触碰冻结契约：$f"
    echo "CONTRACT-GATE       归类：$label"
    violations=$((violations + 1))
  fi
done < <(collect_changed | sort -u)

if [ "$violations" -eq 0 ]; then
  echo "CONTRACT-GATE ✅ PASS —— 未触碰任何冻结契约"
  exit 0
fi

cat <<'EOF'
CONTRACT-GATE 🔴 FAIL —— 契约只读，红转绿只能靠改实现（不许改期望/golden/契约把红变绿）。
CONTRACT-GATE   若你判定是契约本身过时（go 真改了 wire / 投影真要变）：
CONTRACT-GATE     ❌ 禁自改契约让测试过。
CONTRACT-GATE     ✅ 产出「契约变更提案」：一句话 gap + 证据（真抓包 / go 源码行 / 双端日志）
CONTRACT-GATE        + 期望新契约 → 交人审；人审通过后由人改契约，再让 agent 跟改实现。
CONTRACT-GATE   详见 rules/contract-readonly-autofix.md §2。
EOF
exit 1
