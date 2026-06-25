#!/usr/bin/env bash
# scripts/seed-behind-cursor.sh —— UC-4.1 专用 seed：把 seeded DB 的 channel_event_cursor
# 全部 last_event_seq 置 0，使 hello 握手产真 increment delta（fromSeq=0 → server 回放全量历史）。
#
# 背景（C003 / C004 决策 A · 人审通过）：
#   app 实际打开的 DB 是字面名文件 `/tmp/loopforge-im.db?mode=rwc`（engine.rs:101
#   open("sqlite:{db_path}?mode=rwc") → sqlx 把整串当文件名）；plain `/tmp/loopforge-im.db`
#   是 0 字节幽灵文件。本机 seeded DB 已是 current-cursor（67 行 last_event_seq>0），
#   hello 增量为空 → 引擎走 bulk-load → ②④ 与「冷启动增量-delta」契约失配。
#   决策 A = 重置 cursor 到落后态（改环境·不改冻结 oracle）。
#
# 幂等可重复：每次 run 前调用（hello 跑完会把 cursor 推进回 current → 复跑必须先重置）。
# run.sh / uc-4.1 spec 的 before-hook 应调用本脚本，让 UC-4.1 可重复绿（不留一次性手工态）。
#
# 用法：
#   bash scripts/seed-behind-cursor.sh                 # 重置默认 DB（含字面名兜底）
#   HELIX_DB=/path/to.db bash scripts/seed-behind-cursor.sh
set -uo pipefail

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

# 重置：全 cursor 落后到 0（fromSeq=0 → hello 产全量 increment delta）。
sqlite3 "$TARGET" "UPDATE channel_event_cursor SET last_event_seq = 0;" 2>&1
AFTER=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor WHERE last_event_seq = 0;" 2>/dev/null || echo 0)

echo "[OK] seed-behind-cursor: DB='$TARGET' channel=$CH cursor_rows=$ROWS set_to_zero=$AFTER backup=$BAK"
