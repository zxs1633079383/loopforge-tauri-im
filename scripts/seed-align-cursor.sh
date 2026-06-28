#!/usr/bin/env bash
# scripts/seed-align-cursor.sh —— 测试隔离基元（#1 修复·C014）：把累积 DB「收口」到有界小频道集
# + cursor 前推对齐高水位，消除冷启 sync 风暴。两步合一（trim + align），冷启「前」调用。
#
# 命题（#1 测试污染·全套退化·实测沉淀 2026-06-28）：
#   52 spec 顺序跑，每个建群 → 本地 DB channel/channel_event_cursor **跨多轮 run 累积**
#   （实测 live DB 219 行·snapshot 仅 69）。冷启时 lifecycle.start → Scan channel_event_cursor
#   灌入全部 cursor → handle_hello → increment → `emit_proactive_resync` **逐 channel** 发
#   /channel/sync/notify。实测此扇出**按 channel 总数走·不按 cursor gap 走**：
#     · 219 channel DB 冷启 → 221 http-req（220 条 sync/notify 风暴）
#     · 26  channel DB 冷启 →   2 http-req（无风暴）
#   风暴占满 WS 通道 → 发消息 post echo 帧抢不到道 → send 类 spec「echo 未覆写」超窗红。
#   单跑/小批绿（DB 干净）；全套退化（DB 累积 → 扇出放大）。
#
# 修复（改环境·不改冻结 oracle·C004 决策 A）·两步：
#   ① TRIM：把本地 channel 收口到「最近 N 个」（默认 N=40·env LOOPFORGE_KEEP_CHANNELS 覆盖），
#      按 created_at 降序保留（最新建的=当前 run 在用的·跨 spec 依赖「后序复用前序」靠保留最近 N
#      覆盖）；删除更旧的跨轮累积垃圾频道 + 其 cursor + 孤儿 message。实测 server 真实活跃集 ~26·
#      故 N=40 留足余量（保所有真实/最近频道·只砍 cross-run 垃圾）。被删频道 server 仍在·下次冷启
#      若真活跃会自然回灌（实测 trim 到 10 → 冷启回灌到 26 = server 真实集·且无风暴）。
#   ② ALIGN：剩余 cursor 前推到 MAX(自身, channel.last_event_seq)（= client 本地已知高水位）→
#      increment 报 0/极少新事件（cursor 只前推不后退·MAX 保证·无数据丢失·语义=「已追平本地已知位置」）。
#
# 安全性 / 适用：
#   - 仅在冷启「前」调用（app 未持有 DB 写锁时）；复用既有冷启点（up / reload-app / 命令型隔离），
#     **不给暖栈快路径 spec 引入额外冷启税**（warm 路径不冷启→不风暴→无需收口）。
#   - 与 seed-behind-cursor.sh **互斥**：behind = 后退造 gap 触发回放（自驱 4.1/4.2/4.4 需要）；
#     本脚本 = 前推抹 gap + trim 消风暴（命令型/send/自驱-plain 用）。**禁在 4.x 路径调本脚本**。
#   - 幂等可重复：已收口则 trim 无可删、align 无可推（MAX 不动）。
#
# 用法：
#   bash scripts/seed-align-cursor.sh                       # trim 到最近 40 + 对齐 /tmp/loopforge-im.db
#   LOOPFORGE_KEEP_CHANNELS=20 bash scripts/seed-align-cursor.sh
#   LOOPFORGE_KEEP_CHANNELS=0  bash scripts/seed-align-cursor.sh   # 0 = 跳过 trim·只对齐
#   HELIX_DB=/path/to.db bash scripts/seed-align-cursor.sh
set -uo pipefail
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"

# 保留最近 N 个 channel（按 created_at 降序）。0 = 不 trim（只对齐）。默认 40（留足真实活跃集余量）。
KEEP="${LOOPFORGE_KEEP_CHANNELS:-40}"
# engine.rs 默认 db_path = /tmp/loopforge-im.db（env HELIX_DB 覆盖）。
DB_PATH="${HELIX_DB:-/tmp/loopforge-im.db}"

command -v sqlite3 >/dev/null 2>&1 || { echo "⛔ 需要 sqlite3"; exit 1; }

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

CH_BEFORE=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel;" 2>/dev/null || echo 0)
ROWS=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel_event_cursor;" 2>/dev/null || echo 0)

# —— ① TRIM：收口到最近 KEEP 个 channel（按 created_at 降序）——
# C003 护栏：trim 后必须 ≥1 channel（active channel 根·否则 send 族无目标）；KEEP 太小或 0 跳过。
if [ "${KEEP:-0}" -gt 0 ] && [ "${CH_BEFORE:-0}" -gt "$KEEP" ]; then
  sqlite3 "$TARGET" "
    CREATE TEMP TABLE _keep AS
      SELECT id FROM channel ORDER BY created_at DESC, id DESC LIMIT ${KEEP};
    DELETE FROM message              WHERE channel_id NOT IN (SELECT id FROM _keep);
    DELETE FROM channel_event_cursor WHERE channel_id NOT IN (SELECT id FROM _keep);
    DELETE FROM channel              WHERE id        NOT IN (SELECT id FROM _keep);
  " 2>&1
fi
CH_AFTER=$(sqlite3 "$TARGET" "SELECT count(*) FROM channel;" 2>/dev/null || echo 0)
if [ "${CH_AFTER:-0}" -eq 0 ]; then
  echo "⛔ trim 后 channel 0 行（违反 C003·active channel 根）——目标 '$TARGET'（KEEP=$KEEP）"
  exit 1
fi

# —— ② ALIGN：剩余 cursor 前推到 MAX(自身, channel.last_event_seq)——
BEHIND_BEFORE=$(sqlite3 "$TARGET" "
  SELECT count(*) FROM channel_event_cursor cec JOIN channel c ON c.id=cec.channel_id
  WHERE cec.last_event_seq < c.last_event_seq;" 2>/dev/null || echo 0)
sqlite3 "$TARGET" "
  UPDATE channel_event_cursor
  SET last_event_seq = MAX(
        last_event_seq,
        COALESCE((SELECT c.last_event_seq FROM channel c WHERE c.id = channel_event_cursor.channel_id), 0)
      )
  WHERE channel_id IN (SELECT id FROM channel);" 2>&1
BEHIND_AFTER=$(sqlite3 "$TARGET" "
  SELECT count(*) FROM channel_event_cursor cec JOIN channel c ON c.id=cec.channel_id
  WHERE cec.last_event_seq < c.last_event_seq;" 2>/dev/null || echo 0)

echo "[OK] seed-align-cursor: DB='${TARGET}' channel(before-after)=${CH_BEFORE}/${CH_AFTER} KEEP=${KEEP}" \
     "cursor_rows=${ROWS} behind(before-after)=${BEHIND_BEFORE}/${BEHIND_AFTER} (behind=0 即冷启零 gap·扇出随 channel 数收口)"
