#!/usr/bin/env bash
# scripts/seed-snapshot.sh —— 每-UC 状态隔离的「确定 seed 快照」基元（C014）。
#
# 命题（flaky-state 缺口）：暖栈 app 常驻 + DB 持久（/tmp/loopforge-im.db?mode=rwc）→
#   spec A 改了 DB / DOM / in-memory cursor / inflight → spec B 的前置被破坏 →
#   同一 UC 单独跑绿、跟在别 spec 后红（实测 UC-5.3 在 1.2→1.5→2.3→5.4 链后失败）。
#
# 本脚本：把「当前已知良好的 seeded DB」冻结成一份金标快照，供 `harness.sh spec <uc> --fresh`
#   在跑命令型 UC（1.4/5.3 等·自锚新建数据）前**复位到字节一致的确定基线**——杜绝 DB 行
#   随反复 create/send 无界增长（实测 channel 77→69 漂移），让起点跨跑序一致。
#
# ⚠️ 仅命令型 UC 用 restore；**内核自驱 UC（4.1/4.2/4.4/10.1）不 restore**——它们的
#   cursor 须跟 server 实时水位（seed-behind-cursor.sh 相对回退·避免冻结 cursor 落出 server
#   事件保留窗 → no_change 空增量）。自驱 UC 的确定性靠 reload + bootstrap-UC + --keep（已证）。
#
# 与 seed-behind-cursor.sh 的分工：
#   - seed-snapshot.sh = 整库 channel/message/cursor 字节复位（命令型 UC 基线）
#   - seed-behind-cursor.sh = 仅 cursor 相对回退（自驱 UC 触发 gap 回放）
#
# 子命令：
#   seed-snapshot.sh freeze            冻结当前 literal DB → test/fixtures/seed-snapshot.db（gitignored）
#   seed-snapshot.sh restore           还原快照 → literal DB（须 app 未持有句柄时调·配 reload）
#   seed-snapshot.sh status            报快照存在性 + 计数
#
# 用法：harness.sh spec <uc> --fresh 内部调用 restore；首次或 DB 漂移后手动 `freeze`。
set -uo pipefail
export LANG="${LANG:-en_US.UTF-8}" LC_ALL="${LC_ALL:-en_US.UTF-8}"
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib.sh"

# engine.rs 默认 db_path = /tmp/loopforge-im.db（env HELIX_DB 覆盖）。
DB_PATH="${HELIX_DB:-/tmp/loopforge-im.db}"
# engine.rs 用 open("sqlite:{db_path}?mode=rwc")，sqlx 把整串当字面文件名 → 真文件带 ?mode=rwc 后缀。
LITERAL="${DB_PATH}?mode=rwc"
SNAPSHOT="$REPO_ROOT/test/fixtures/seed-snapshot.db"

require_db() { command -v sqlite3 >/dev/null 2>&1 || die "需要 sqlite3"; }

# 解析 app 实际打开的 DB 文件（优先 literal·非空；退 plain）。
_resolve_live_db() {
  if [ -f "$LITERAL" ] && [ -s "$LITERAL" ]; then printf '%s' "$LITERAL"; return 0; fi
  if [ -f "$DB_PATH" ] && [ -s "$DB_PATH" ]; then printf '%s' "$DB_PATH"; return 0; fi
  return 1
}

_counts() {
  local db="$1"
  sqlite3 "$db" "SELECT 'channel='||count(*) FROM channel;" 2>/dev/null
  sqlite3 "$db" "SELECT 'message='||count(*) FROM message;" 2>/dev/null
  sqlite3 "$db" "SELECT 'cursor='||count(*) FROM channel_event_cursor;" 2>/dev/null
}

cmd_freeze() {
  require_db
  local live; live="$(_resolve_live_db)" || die "找不到非空 seeded DB（查过 '$LITERAL' 与 '$DB_PATH'）—— 先 seed DB（C003）"
  local ch; ch=$(sqlite3 "$live" "SELECT count(*) FROM channel;" 2>/dev/null || echo 0)
  [ "${ch:-0}" -gt 0 ] || die "live DB channel 0 行（未 seed）——拒绝冻结空库（C003）"
  # WAL checkpoint 后再拷贝（确保快照含全部已提交事务·不漏 -wal 中数据）。
  sqlite3 "$live" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null 2>&1 || true
  cp "$live" "$SNAPSHOT" || die "冻结失败：cp '$live' → '$SNAPSHOT'"
  ok "冻结金标快照：${SNAPSHOT}（$(_counts "$SNAPSHOT" | tr '\n' ' ')）"
  info "快照 gitignored（*.db）·DB 漂移后重跑 freeze 刷新"
}

cmd_restore() {
  require_db
  [ -f "$SNAPSHOT" ] && [ -s "$SNAPSHOT" ] || { warn "无金标快照（$SNAPSHOT）—— 跳过 restore（先 \`harness.sh seed-freeze\`）·--fresh 退化为纯 reload"; return 0; }
  # 还原到 app 实际打开的 literal 文件（app 须已停·否则句柄不一致）。
  cp "$SNAPSHOT" "$LITERAL" || die "还原失败：cp '$SNAPSHOT' → '$LITERAL'"
  # 清理可能残留的 WAL/SHM（旧句柄遗留·避免与还原文件不一致）。
  rm -f "${LITERAL}-wal" "${LITERAL}-shm" 2>/dev/null || true
  ok "还原金标快照 → ${LITERAL}（$(_counts "$LITERAL" | tr '\n' ' ')）"
}

cmd_status() {
  if [ -f "$SNAPSHOT" ] && [ -s "$SNAPSHOT" ]; then
    ok "快照存在：${SNAPSHOT}（$(_counts "$SNAPSHOT" | tr '\n' ' ')）"
  else
    warn "无快照（先 \`harness.sh seed-freeze\`）"
  fi
  local live; if live="$(_resolve_live_db)"; then info "live DB：${live}（$(_counts "$live" | tr '\n' ' ')）"; else warn "无 live DB"; fi
}

case "${1:-}" in
  freeze)  cmd_freeze ;;
  restore) cmd_restore ;;
  status)  cmd_status ;;
  *)       die "用法：seed-snapshot.sh {freeze | restore | status}" ;;
esac
