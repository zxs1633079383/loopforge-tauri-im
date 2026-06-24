#!/usr/bin/env bash
# install-hooks.sh —— 一次性装 git 钩子（钩子不进版本库·新 clone / 换机后跑一次）
# 用法：bash scripts/install-hooks.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOOK_SRC="$ROOT/scripts/hooks/pre-push"
HOOK_DST="$ROOT/.git/hooks/pre-push"

[ -f "$HOOK_SRC" ] || { echo "❌ 缺 $HOOK_SRC"; exit 1; }
mkdir -p "$ROOT/.git/hooks"
chmod +x "$HOOK_SRC"
# symlink 指向版本库内钩子 → 钩子内容随仓库演进，无需重装
ln -sf ../../scripts/hooks/pre-push "$HOOK_DST"
echo "✅ pre-push 已装：$HOOK_DST → scripts/hooks/pre-push"
echo "   每次 git push 前自动跑 scripts/gate.sh；gate 红则拦下。"
