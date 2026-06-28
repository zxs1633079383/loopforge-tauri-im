#!/usr/bin/env bash
# scripts/seed-behind-cursor.sh —— UC-4.1/4.2/4.4 专用 seed：把 channel_event_cursor 各行
# last_event_seq 回退到「相对落后但仍 >0」的态，使 hello 握手 / 心跳 ping 发 fromSeq=behind
# → server 回放离线区间真 increment_channel/post 帧 → ② im:channel:increment(4.1) /
# im:channel:update-by-post(4.2/4.4) + ④ batch_upsert 真 emit·四面转绿。
#
# ⚠️ 关键修正 v2（2026-06-28·实测沉淀·替代「固定 DELTA 减法」旧策略）：
#   旧策略 `last_event_seq = MAX(0, last_event_seq - DELTA)`（DELTA=2000）在**小序号**数据集上
#   把所有行 clamp 到 0（实测 cses-im-server 每频道 last_event_seq 仅 ~3-12·远小于 2000）→
#   behind_rows=0（按旧 `>0` 口径全归零）→ 命中「cursor=0 → server 视为从头全量同步 →
#   no_change 空增量」陷阱 → 无 gap → 内核不自驱 sync/notify(4.2)/心跳补偿(4.4) → 永红。
#
#   v2 改为**网关于 channel 高水位的 gap-relative 回退**·与序号量级无关：
#     对每个 channel.last_event_seq(HW) ≥ 2 的频道行：
#       cursor.last_event_seq = MAX(1, HW - DELTA)
#     · 结果恒落在 [1, HW-1] → **严格落后 HW**（真 gap）**且 >0**（绕开 cursor=0 全量陷阱）。
#     · 小序号（HW=12·DELTA=2000）→ MAX(1, -1988)=1 < 12 ✓ gap=11；
#       大序号（HW=10000·DELTA=2000）→ 8000 < 10000 ✓ gap=2000（兼容旧大序号场景）。
#     · HW ≤ 1 的频道无法造出「>0 且 < HW」的 cursor（gap 须 cursor=0）→ 跳过·不作锚。
#   gap 落点（fromSeq=cursor）须在 server 事件保留窗内：小序号场景全历史均在窗内 → 必回放。
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
#   bash scripts/seed-behind-cursor.sh                       # 回退默认 DELTA=2000（小序号→floor 到 1）
#   SEED_BEHIND_DELTA=1000 bash scripts/seed-behind-cursor.sh
#   LOOPFORGE_KEEP_CHANNELS=40 bash scripts/seed-behind-cursor.sh   # 0=不 trim（默认 40·协同 #1）
#   HELIX_DB=/path/to.db bash scripts/seed-behind-cursor.sh
set -uo pipefail

# 回退量（events）：cursor 拉回 MAX(1, HW - DELTA)（HW=channel.last_event_seq）。
# DELTA 大 → cursor floor 到 1（小序号场景·gap=HW-1）；DELTA 小 → cursor=HW-DELTA（大序号场景·gap=DELTA）。
# 无论量级·结果恒 ∈ [1, HW-1] → 严格落后且 >0。实测小序号(HW≤12)默认 2000 即 floor=1·gap 满。
SEED_BEHIND_DELTA="${SEED_BEHIND_DELTA:-2000}"

# 协同 #1（C014·trim 隔离）：4.x 路径只调本脚本（不调 seed-align·二者互斥）·故累积 DB 的
# cross-run 垃圾频道在此一并收口，避免 N 个无 gap 频道冷启 proactive-resync 噪声盖过 4.2/4.4 锚信号。
# KEEP=0 跳过 trim（只回退 cursor）。默认 40·与 seed-align 一致（保最近真实/活跃集·砍跨轮垃圾）。
SEED_BEHIND_KEEP="${LOOPFORGE_KEEP_CHANNELS:-40}"

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

# —— ① TRIM（协同 #1·C014）：收口到最近 KEEP 个 channel（按 created_at 降序）·砍 cross-run 垃圾 ——
# C003 护栏：trim 后须 ≥1 channel（active channel 根）。KEEP=0 或频道数 ≤ KEEP 时跳过。
if [ "${SEED_BEHIND_KEEP:-0}" -gt 0 ] && [ "${CH:-0}" -gt "$SEED_BEHIND_KEEP" ]; then
  sqlite3 "$TARGET" "
    CREATE TEMP TABLE _keep AS
      SELECT id FROM channel ORDER BY created_at DESC, id DESC LIMIT ${SEED_BEHIND_KEEP};
    DELETE FROM message              WHERE channel_id NOT IN (SELECT id FROM _keep);
    DELETE FROM channel_event_cursor WHERE channel_id NOT IN (SELECT id FROM _keep);
    DELETE FROM channel              WHERE id        NOT IN (SELECT id FROM _keep);
  " 2>&1
  CH=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel;" 2>/dev/null || echo 0)
  ROWS=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor;" 2>/dev/null || echo 0)
fi

# —— ② 回退（gap-relative·量级无关）：cursor.last_event_seq = MAX(1, HW - DELTA)·HW=channel.last_event_seq ——
# 仅回退 channel HW ≥ 2 的行（HW≤1 无法造「>0 且 <HW」的 cursor → 跳过·不作锚）。
# 结果恒 ∈ [1, HW-1]：严格落后 HW（真 gap）且 >0（绕开 cursor=0 全量 no_change 陷阱）。
MAXBEFORE=$(sqlite3 "$TARGET" "SELECT COALESCE(max(last_event_seq),0) FROM channel_event_cursor;" 2>/dev/null || echo 0)
sqlite3 "$TARGET" "
  UPDATE channel_event_cursor
  SET last_event_seq = MAX(1,
        COALESCE((SELECT c.last_event_seq FROM channel c WHERE c.id = channel_event_cursor.channel_id), 0)
        - ${SEED_BEHIND_DELTA}
      )
  WHERE channel_id IN (SELECT id FROM channel WHERE last_event_seq >= 2);" 2>&1
MAXAFTER=$(sqlite3 "$TARGET" "SELECT COALESCE(max(last_event_seq),0) FROM channel_event_cursor;" 2>/dev/null || echo 0)
# behind_rows = 真 gap 行数（cursor < channel 高水位·v2 口径·非旧 `cursor>0`）。0 即未造出落后态。
BEHIND=$(sqlite3 "$TARGET" "
  SELECT count(*) FROM channel_event_cursor cec JOIN channel c ON c.id=cec.channel_id
  WHERE cec.last_event_seq < c.last_event_seq;" 2>/dev/null || echo 0)
GT0=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor WHERE last_event_seq > 0;" 2>/dev/null || echo 0)

echo "[OK] seed-behind-cursor: DB='$TARGET' channel=$CH cursor_rows=$ROWS keep=${SEED_BEHIND_KEEP} delta=${SEED_BEHIND_DELTA} max(before→after)=${MAXBEFORE}→${MAXAFTER} behind_rows=$BEHIND cursor_gt0=$GT0 backup=$BAK"
if [ "${BEHIND:-0}" -eq 0 ]; then
  echo "⚠️ behind_rows=0：未造出任何「cursor < HW」的真 gap（全频道 HW≤1?·检查 DB 是否含真事件）——4.2/4.4 将无自驱产出"
fi
