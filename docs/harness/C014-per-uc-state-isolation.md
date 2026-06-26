---
id: C014
title: 每-UC 状态隔离（暖栈 spec 跑序无关·reload 复位 DOM/inflight/in-memory·自驱保 boot hop·禁 stale-cursor restore）
status: active
created: 2026-06-27
recurrence_count: 3
---

## §1 触发场景
暖栈（`harness.sh up` 常驻 app）串行跑多个 spec：同一 UC **单独跑绿、跟在别 spec 后红**（跑序相关）。
实测 3 例：
- **UC-10.1**（内核自驱待办）：`spec 10.1` 跟在任意 spec 后 → ①② 红（`无出站命令体` / `无投影 emit`）。
- **UC-5.3**（关闭群）：`1.2→1.5→2.3→5.4` 链后 `spec 5.3` → DOM 行未移除超时红（单独跑绿）。
- **UC-1.4**（重发失败）：脏 DOM 残留 `[data-send-status=sending]` 行 → 抓错锚 tmp（间歇）。

## §2 背景（why）
暖栈 app 常驻 + DB 持久（`/tmp/loopforge-im.db?mode=rwc`）+ 单份 run.jsonl。三类耦合源：
1. **boot-hop 一次性**：内核自驱 UC（4.1/4.2/4.4/10.1）的 ①② 断言标的 hop（queryTodoList / gap-sync / 心跳补偿）只在 **app boot 时**流过一次。任何后继 spec 默认 truncate run.jsonl 即抹掉 → 永红。DOM ③ 因 in-memory 残留仍绿 → 假象「只差 ①②」。
2. **脏 DOM / inflight / in-memory**：命令型 UC（1.4/5.3）自锚新建数据，但前序 spec 残留的行 / 在途 HTTP / 漂移 cursor 干扰 → 间歇红。
3. **stale-cursor restore 反噬**（2026-06-27 实测）：full DB 快照 restore 把 cursor 一并还原到**冻结时旧水位** → reload 后 hello 见 local cursor 远落后 server → 触发冷启自愈 catch-up 同步风暴（app 日志 `stuck_channels=N` + 数十条 ws-send），风暴与本 UC 的 WS echo 抢道 → DOM 更新（如 5.3 关闭行移除）被埋/迟到 → 假红。**「复位 DB」反而比不复位更不确定**。

## §3 Required / Forbidden
✅ flaky-prone UC（`ISOLATE_UCS="1.4 5.3 10.1 4.1 4.2 4.4"`）默认走**隔离路径**（即使纯 `spec <uc>`·满足判据「跟在别 spec 后稳定绿」）；其余已稳健 UC 默认暖栈快路径（~10s·开发内循环）。
✅ **内核自驱 UC** 隔离 = `reload-app`（起 app 即 truncate jsonl·boot hop 重流入）+ bootstrap-UC 归属（`LOOPFORGE_BOOTSTRAP_UC=UC-X`）+ **不二次 truncate**（boot hop 是 ①② 标的）；4.x 另 `seed-behind-cursor`（cursor 落后触发 gap 回放）。
✅ **命令型 UC** 隔离 = `reload-app`（清 DOM/inflight/in-memory·**保 live cursor** 跟 server 水位·无风暴）；自锚新建 id 跨跑序确定绿。
✅ `--fresh` 强隔离 / `--warm` 强暖栈快路径 / `--keep` 保 jsonl（手动覆盖）。
❌ 隔离路径**禁二次 truncate run.jsonl**：app 刚 boot 仍异步 flush 增量 hop，截断正被 append 的文件 → app 文件 offset 越过 EOF → 稀疏 null 空洞 → reducer parseErrors 暴涨（实测 26 行 null 垃圾·5.3 假红）。靠「起 app 时一次 truncate」+ corr-key 认领隔离即可。
❌ 命令型 UC **默认禁 full DB restore**（stale cursor → 同步风暴·见 §2.3）；restore 仅作显式「DB 行复位」工具（`LOOPFORGE_RESTORE_DB=1` opt-in·须接受随之一次风暴）。
❌ 自驱 UC **禁 restore DB**（cursor 须跟 server 实时水位）。

## §4 Verification
```bash
# 1. 隔离路径存在 + 分类表 + 禁二次-truncate 注释
grep -q 'ISOLATE_UCS=' scripts/harness.sh
grep -q '_spec_isolated' scripts/harness.sh
grep -q '不二次 truncate' scripts/harness.sh

# 2. 快照基元存在 + restore 默认关
grep -q 'LOOPFORGE_RESTORE_DB' scripts/harness.sh          # restore env-gated（默认 0）
test -x scripts/seed-snapshot.sh

# 3. 跑序无关（铁证·须 cses-im-server :8066 起 + 暖栈 up）：
#    同一 flaky UC 跟在不同前序后跑·均绿
bash scripts/harness.sh spec 2.1 --warm && bash scripts/harness.sh spec 5.3   # 5.3 隔离绿
bash scripts/harness.sh spec 5.4 --warm && bash scripts/harness.sh spec 10.1  # 10.1 隔离绿
# 回归：暖栈快路径 UC 不退化
bash scripts/harness.sh spec send-1 --warm && bash scripts/harness.sh spec 2.1 --warm
```

## §5 Recurrence Log
| 日期 | commit | 现象 | 根因 |
|---|---|---|---|
| 2026-06-27 | (本卡) | UC-10.1 跟别 spec 后 ①② 红 | boot-hop 被后继 spec truncate 抹掉 |
| 2026-06-27 | (本卡) | UC-5.3 在 5-spec 链后 DOM 行未移除超时 | 脏 in-memory/inflight 累积·间歇 |
| 2026-06-27 | (本卡) | UC-1.4 抓错锚 tmp（脏 sending 行） | 前序残留 `[data-send-status=sending]` |
| 2026-06-27 | (本卡) | 隔离首版 5.3 restore 后 26 行 parseErrors / DOM 行未移除 | ① 二次 truncate 截断 append 中文件成 null 空洞 ② stale-cursor restore 触发同步风暴 |

## §6 关联
- 上游：C003（seeded DB·active channel 根）· C004（改环境不改 oracle·决策 A）· C002（就绪 probe 解耦）
- 兄弟：`seed-behind-cursor.sh`（仅 cursor 相对回退·自驱触发）vs `seed-snapshot.sh`（整库字节复位·命令型显式复位工具）
- 下游：所有 UC rollout 串行/批量跑（C006 闭环）· autonomous overnight runbook
- 机制：`harness.sh spec <uc> [--fresh|--warm|--keep]` + `seed-freeze` + `ISOLATE_UCS` env

## §7 历史与演进
- drafting→active：2026-06-27 抓 1.4/5.3/10.1 三次同根因（达三铁律 ≥3 门槛）→ 即时新建。
- 关键演进：DB restore 从「默认开」→「默认关 opt-in」——实测 stale-cursor restore 引发同步风暴，
  比「reload 保 live cursor」更不确定；隔离的确定性核心是 **reload 复位易失态（DOM/inflight/in-memory）
  + 保 live cursor**，而非「DB 字节复位」。这修正了任务初始假设「每 spec 复位 DB 快照」。
