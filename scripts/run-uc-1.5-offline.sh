#!/usr/bin/env bash
# scripts/run-uc-1.5-offline.sh —— UC-1.5-offline（撤回离线 gap-replay）端到端编排驱动。
#
# 离线撤回（im:post:deleted）无法在单个 --warm spec 内驱动：重放靠冷启动 increment，而 helix
# in-memory cursor（channel.rs Channel::cursor）须 reload 才回退（seed-behind-cursor + cold boot·
# UC-4.1/4.2/4.4 同范式）。故四阶段编排：
#   ① setup spec（暖栈）：建群 C → 发消息 M（捕获 server_id S）→ 撤回 M（服务端记 PostRevoke
#      channel_event）→ 写锚 /tmp/uc-offrev-anchor.json。
#   ② 回退 C 的 channel_event_cursor 到撤回前（覆盖 PostUpsert(M)+PostRevoke(M) 两事件）。
#   ③ reload-app --uc UC-1.5-offline：冷启动 increment 重放 → im:post:received(M) 载行 +
#      im:post:deleted(M) 标撤回（重放帧 uc_id=UC-1.5-offline）。
#   ④ observer spec --keep：不 truncate run.jsonl（保冷启动重放帧）→ 读重放 run.jsonl 裁 ②③。
#
# 用法：bash scripts/run-uc-1.5-offline.sh
# 前置：暖栈已起（harness.sh up）+ cses-im-server :8066 + seeded DB。
# 幂等可重复：每次跑制造一个新锚频道（不依赖前次状态）。
set -uo pipefail
# UTF-8 locale 兜底：非 UTF-8 locale 下 bash 把紧跟变量名的多字节中文吞进标识符
# （$NEW（ → 未绑定变量 NEW（…）。显式设 UTF-8 + 关键处 ${var} 花括号界定双保险（对齐 harness.sh）。
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"

LF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$LF_DIR/.." && pwd)"
HARNESS="$REPO_ROOT/scripts/harness.sh"
ANCHOR_FILE="${UC_OFFREV_ANCHOR:-/tmp/uc-offrev-anchor.json}"
DB_PATH="${HELIX_DB:-/tmp/loopforge-im.db}"
export UC_OFFREV_ANCHOR="$ANCHOR_FILE"

say() { printf '\033[36m▶ %s\033[0m\n' "$*"; }
die() { printf '\033[31m⛔ %s\033[0m\n' "$*" >&2; exit 1; }

command -v sqlite3 >/dev/null 2>&1 || die "需要 sqlite3"

# engine.rs open("sqlite:{db}?mode=rwc") → sqlx 把整串当字面文件名。优先字面名文件。
LITERAL="${DB_PATH}?mode=rwc"
if [ -f "$LITERAL" ] && [ -s "$LITERAL" ]; then TARGET="$LITERAL"
elif [ -f "$DB_PATH" ] && [ -s "$DB_PATH" ]; then TARGET="$DB_PATH"
else die "找不到非空 seeded DB（查过 '$LITERAL' 与 '$DB_PATH'）"; fi

# —— ① setup（暖栈·建群+发+撤回·写锚）——
say "阶段① setup：建群 → 发消息（捕获 server_id）→ 撤回 → 写锚"
rm -f "$ANCHOR_FILE"
bash "$HARNESS" spec 1.5-offline-setup --warm || die "setup spec 失败"
[ -f "$ANCHOR_FILE" ] || die "锚文件未生成：$ANCHOR_FILE"
C="$(sed -n 's/.*"C":"\([^"]*\)".*/\1/p' "$ANCHOR_FILE")"
S="$(sed -n 's/.*"S":"\([^"]*\)".*/\1/p' "$ANCHOR_FILE")"
[ -n "$C" ] && [ -n "$S" ] || die "锚解析失败（C=$C S=$S）"
say "锚：C=$C S=$S"

# —— ② 回退 C 的 cursor 到撤回前（覆盖 PostUpsert+PostRevoke 末两事件）——
CUR="$(sqlite3 "$TARGET" "SELECT last_event_seq FROM channel_event_cursor WHERE channel_id='$C';" 2>/dev/null)"
[ -n "$CUR" ] || die "C 无 cursor 行（DB 未记 $C）"
NEW=$(( CUR - 2 )); [ "${NEW}" -lt 1 ] && NEW=1
say "阶段② 回退 cursor：C last_event_seq ${CUR} -> ${NEW} （覆盖 PostUpsert+PostRevoke 重放窗）"
sqlite3 "$TARGET" "UPDATE channel_event_cursor SET last_event_seq=${NEW} WHERE channel_id='${C}';" || die "cursor 回退失败"

# —— ③ reload-app --uc UC-1.5-offline（冷启动重放·帧归本 UC）——
say "阶段③ reload-app --uc UC-1.5-offline：冷启动 increment 重放 PostUpsert+PostRevoke"
bash "$HARNESS" reload-app --uc UC-1.5-offline || die "reload-app 失败"

# —— ④ observer spec --keep（读冷启动重放 run.jsonl·裁 ②③）——
say "阶段④ observer spec（--keep·保冷启动重放帧）"
bash "$HARNESS" spec 1.5-offline --warm --keep
RC=$?
if [ "$RC" -eq 0 ]; then printf '\033[32m✅ UC-1.5-offline 四面（②③）全绿\033[0m\n'; else printf '\033[31m❌ UC-1.5-offline 红（见上 reducer 断点）\033[0m\n'; fi
exit $RC
