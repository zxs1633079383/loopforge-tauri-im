#!/usr/bin/env bash
# gate.sh — loopforge-tauri-im 提交闸门链（借鉴 helix scripts/gate.sh）
#
# 把 harness 纪律从「文档约定」升级为「可执行拦截」。建议 pre-push 调本脚本。
# 任一步红 → 退出码非 0。可单独跑 `bash scripts/gate.sh`。
set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)" || exit 2
FAIL=0
step() { printf "\n— [gate] %s\n" "$1"; }
ok()   { printf "  ✅ %s\n" "$1"; }
bad()  { printf "  ❌ %s\n" "$1"; FAIL=1; }

# 1. CLAUDE.md ↔ AGENTS.md 镜像一致（同步铁律）
step "1 CLAUDE.md ↔ AGENTS.md 镜像"
if diff -q CLAUDE.md AGENTS.md >/dev/null 2>&1; then ok "镜像一致"; else bad "CLAUDE.md 与 AGENTS.md 不一致（镜像铁律）"; fi

# 2. harness 索引不变量（铁律③）：cards 数 == CLAUDE §9 == README §1
step "2 harness 索引不变量"
C=$(ls docs/harness/C*.md 2>/dev/null | wc -l | tr -d ' ')
CL=$(grep -cE '^\| C[0-9]+' CLAUDE.md 2>/dev/null || echo 0)
RD=$(grep -cE '^\| C[0-9]+' docs/harness/README.md 2>/dev/null || echo 0)
if [ "$C" = "$CL" ] && [ "$C" = "$RD" ]; then ok "cards=$C CLAUDE=$CL README=$RD 一致"; else bad "索引漂移 cards=$C CLAUDE=$CL README=$RD"; fi

# 3. 录放/webdriver 必须 feature 闸（C 待立·release 不带）
step "3 webdriver/set_uc 必在 feature 闸后（release 不带录放）"
if grep -q 'cfg(feature = "webdriver")' src-tauri/src/commands.rs 2>/dev/null; then ok "set_uc 在 webdriver feature 闸后"; else bad "set_uc 未 feature 闸（release 可能带录放·CLAUDE §2 #4）"; fi

# 4. reducer 自测（裁判可信 + 可证伪对偶·C008）
step "4 reducer 自测（四面 + 可证伪对偶）"
if command -v node >/dev/null 2>&1; then
  if node test/reducer/four-facet-reducer.test.mjs >/tmp/lf-gate-reducer.log 2>&1; then ok "$(grep -oE '[0-9]+ 通过 / [0-9]+ 失败' /tmp/lf-gate-reducer.log | head -1)"; else bad "reducer 自测红（见 /tmp/lf-gate-reducer.log）"; fi
else bad "无 node"; fi

# 5. 四面 expect JSON 全部可解析（契约文件不坏·C004）
step "5 test/expect/*.json 全部 valid JSON"
BADJSON=0
for f in test/expect/*.json; do [ -e "$f" ] || continue; node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null || { bad "JSON 坏: $f"; BADJSON=1; }; done
[ "$BADJSON" = 0 ] && ok "全部 expect JSON 可解析"

# 6. helix 依赖单一 git 快照（C001·禁 path/git 混用）
step "6 helix 依赖单版本（C001）"
MIX=$(grep -rhnE "helix-(core|im|driver-native|driver-host)\s*=" src-tauri/Cargo.toml crates/*/Cargo.toml 2>/dev/null | grep -c 'path =')
if [ "$MIX" = 0 ]; then ok "无 helix path dep（全 git 同源）"; else bad "$MIX 处 helix path dep（与 git dep 混用→E0277·见 C001）"; fi

# 7. 单文件行数闸门（coding-style ≤800 行·仅警告）
step "7 单文件 ≤800 行（警告）"
OVER=$(find src-tauri/src crates/*/src src/app test/reducer -name '*.rs' -o -name '*.ts' -o -name '*.mjs' 2>/dev/null | while read -r f; do n=$(wc -l <"$f"); [ "$n" -gt 800 ] && echo "$f($n)"; done)
[ -z "$OVER" ] && ok "无超 800 行文件" || printf "  ⚠️ 超 800 行: %s\n" "$OVER"

# 8b. C013 纯渲染壳禁区 grep（第二北极星·应单调 ≤ BASELINE·冻结=不增；S8 终局 BASELINE=0）
step "8b C013 纯渲染壳禁区 grep（第二北极星·HITS ≤ BASELINE）"
C013_BASELINE=0
HITS=$(grep -roE "extract[A-Z][A-Za-z]+|normalize[A-Z][A-Za-z]+|_rows\(\)\.findIndex|role *=== *['\"]CREATOR|role *=== *['\"]ADMIN|role *=== *['\"]MANGER" src/app/im/*.ts 2>/dev/null | wc -l | tr -d ' ')
if [ "$HITS" -le "$C013_BASELINE" ]; then
  ok "禁区命中 ${HITS} / 基线 ${C013_BASELINE}（HITS==0 ⟺ 第二北极星 100%）"
else
  bad "C013 违反：禁区命中 ${HITS} > 基线 ${C013_BASELINE}（本仓新增处理逻辑·应去 helix 补投影/指令）"
fi

# 9. loop-engine events.jsonl ↔ open gap issue 一致性（LE-7·SPEC §5/§8）
#    gap_emit 的 sig 须对应仍 open 的 issue，无悬挂；坏 JSON/缺 sig/缺 issue 即红。
#    gh 不可用/无网 → 模块内降级为结构+JSON 校验（不当作失败）。events.jsonl 缺失=跳过。
step "9 loop-engine events.jsonl ↔ open gap issue 一致性"
if command -v node >/dev/null 2>&1; then
  if [ -f scripts/loop-engine/events-consistency.mjs ]; then
    if node scripts/loop-engine/events-consistency.mjs docs/loop-engine/events.jsonl >/tmp/lf-gate-events.log 2>&1; then
      ok "$(grep -E '✅|⏭' /tmp/lf-gate-events.log | head -1 | sed 's/^[[:space:]]*//;s/^[✅⏭][[:space:]]*//')"
    else
      cat /tmp/lf-gate-events.log
      bad "events.jsonl 一致性自检红（悬挂 sig / 结构错 / 坏 JSON·见上）"
    fi
  else
    printf "  ⏭ 跳过（scripts/loop-engine/events-consistency.mjs 未就绪）\n"
  fi
else bad "无 node"; fi

# 8. clippy 卫生（慢·默认跳；GATE_CLIPPY=1 启用·deny warnings）
step "8 clippy 卫生（默认跳·GATE_CLIPPY=1 启用）"
if [ "${GATE_CLIPPY:-0}" = "1" ]; then
  if cargo clippy --manifest-path src-tauri/Cargo.toml --quiet -- -D warnings >/tmp/lf-gate-clippy.log 2>&1; then ok "clippy 无 warning"; else bad "clippy 有 warning/error（见 /tmp/lf-gate-clippy.log）"; fi
else printf "  ⏭ 跳过（GATE_CLIPPY=1 启用·workspace lints 已配 unwrap/panic/dbg/todo=warn）\n"; fi

printf "\n[gate] %s\n" "$([ "$FAIL" = 0 ] && echo "✅ 全部通过" || echo "❌ 有红项·见上")"
exit "$FAIL"
