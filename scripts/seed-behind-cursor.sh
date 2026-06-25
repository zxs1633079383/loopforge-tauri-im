#!/usr/bin/env bash
# scripts/seed-behind-cursor.sh —— UC-4.1 专用 seed：把 channel_event_cursor 各行
# last_event_seq 回退 DELTA（默认 2000·env SEED_BEHIND_DELTA 覆盖），使 hello 握手发
# fromSeq=（max-DELTA）→ server 回放最近 DELTA 个区间内的真 increment_channel 帧 →
# ② im:channel:increment + ④ batch_upsert channel 真 emit·四面转绿。
#
# ⚠️ 关键修正（2026-06-25·实测沉淀·替代「置 0」旧策略）：
#   旧策略 last_event_seq=0 让 server 视为「从头全量同步」→ 返回 no_change 空增量
#   （seq=0 的历史已过 server 事件保留窗 → 不回放）→ ②④ 永空·误判「server 数据 gap」。
#   实测：cursor 回退到 max-1000（落后但仍在 server 事件保留窗内）→ server 回放 114 个
#   increment_channel 帧·②×114 ④×114 真落地。故必须回退「相对量」而非清零。
#
# 背景（C003 / C004 决策 A · 人审通过）：
#   app 实际打开的 DB 是字面名文件 `/tmp/loopforge-im.db?mode=rwc`（engine.rs:101
#   open("sqlite:{db_path}?mode=rwc") → sqlx 把整串当文件名）；plain `/tmp/loopforge-im.db`
#   是 0 字节幽灵文件。决策 A = 把 cursor 拉回落后态（改环境·不改冻结 oracle）。
#
# 幂等可重复：每次 run 前调用（hello 跑完会把 cursor 推回 high-water → 下轮再回退 DELTA）。
# run.sh / uc-4.1 spec 的 before-hook 应调用本脚本，让 UC-4.1 可重复绿（不留一次性手工态）。
#
# 用法：
#   bash scripts/seed-behind-cursor.sh                       # 回退默认 DELTA=2000
#   SEED_BEHIND_DELTA=1000 bash scripts/seed-behind-cursor.sh
#   HELIX_DB=/path/to.db bash scripts/seed-behind-cursor.sh
set -uo pipefail

# 回退量（events）：cursor 拉回 max(0, last_event_seq - DELTA)。须落在 server 事件保留窗内
# （太大 → 回退到已过期 seq → server no_change；太小 → 无区间可回放）。实测 1000-2000 有效。
SEED_BEHIND_DELTA="${SEED_BEHIND_DELTA:-2000}"

# engine.rs 默认 db_path = /tmp/loopforge-im.db（env HELIX_DB 覆盖）。
DB_PATH="${HELIX_DB:-/tmp/loopforge-im.db}"

require_db() {
  command -v sqlite3 >/dev/null 2>&1 || { echo "⛔ 需要 sqlite3"; exit 1; }
}
require_db

# engine.rs 用 open("sqlite:{db_path}?mode=rwc")，sqlx 把整串当字面文件名 →
# 磁盘真文件是 "<db_path>?mode=rwc"。优先操作字面名文件；不存在再退 plain。
LITERAL="${DB_PATH}?mode=rwc"
if [ -f "$LITERAL" ] && [ -s "$LITERAL" ]; then
  TARGET="$LITERAL"
elif [ -f "$DB_PATH" ] && [ -s "$DB_PATH" ]; then
  TARGET="$DB_PATH"
else
  echo "⛔ 找不到非空 seeded DB（查过 '$LITERAL' 与 '$DB_PATH'）—— 先 seed DB（C003）"
  exit 1
fi

ROWS=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor;" 2>/dev/null || echo 0)
CH=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel;" 2>/dev/null || echo 0)
if [ "${ROWS:-0}" -eq 0 ]; then
  echo "⛔ channel_event_cursor 0 行（DB 未 seed cursor）——目标 '$TARGET'"
  exit 1
fi

# 备份一次（首跑），便于回滚。
BAK="${TARGET}.precursor.bak"
[ -f "$BAK" ] || cp "$TARGET" "$BAK" 2>/dev/null || true

# 回退：cursor 各行 last_event_seq = max(0, last_event_seq - DELTA)（落后但仍在 server
# 事件保留窗内 → hello 发 fromSeq=behind → server 回放 [behind, high-water] 区间真 increment 帧）。
# 仅回退 last_event_seq>0 的行（=0 的本就无 high-water 可回退·回退也只会 no_change）。
MAXBEFORE=$(sqlite3 "$TARGET" "SELECT COALESCE(max(last_event_seq),0) FROM channel_event_cursor;" 2>/dev/null || echo 0)
sqlite3 "$TARGET" "UPDATE channel_event_cursor SET last_event_seq = MAX(0, last_event_seq - ${SEED_BEHIND_DELTA}) WHERE last_event_seq > 0;" 2>&1
MAXAFTER=$(sqlite3 "$TARGET" "SELECT COALESCE(max(last_event_seq),0) FROM channel_event_cursor;" 2>/dev/null || echo 0)
BEHIND=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor WHERE last_event_seq > 0;" 2>/dev/null || echo 0)

echo "[OK] seed-behind-cursor: DB='$TARGET' channel=$CH cursor_rows=$ROWS delta=${SEED_BEHIND_DELTA} max(before→after)=${MAXBEFORE}→${MAXAFTER} behind_rows=$BEHIND backup=$BAK"
