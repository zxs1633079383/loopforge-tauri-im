---
id: C014
title: 每-UC 状态隔离（暖栈 spec 跑序无关·reload 复位 DOM/inflight/in-memory·自驱保 boot hop·禁 stale-cursor restore·#1 冷启前 seed-align-cursor 收口 channel 总数+对齐 cursor 消累积 proactive-resync 风暴·扇出∝channel数非gap）
status: active
created: 2026-06-27
recurrence_count: 4
---

## §1 触发场景
暖栈（`harness.sh up` 常驻 app）串行跑多个 spec：同一 UC **单独跑绿、跟在别 spec 后红**（跑序相关）。
实测 3 例：
- **UC-10.1**（内核自驱待办）：`spec 10.1` 跟在任意 spec 后 → ①② 红（`无出站命令体` / `无投影 emit`）。
- **UC-5.3**（关闭群）：`1.2→1.5→2.3→5.4` 链后 `spec 5.3` → DOM 行未移除超时红（单独跑绿）。
- **UC-1.4**（重发失败）：脏 DOM 残留 `[data-send-status=sending]` 行 → 抓错锚 tmp（间歇）。

**#1 全套退化（2026-06-28 新增·send 类 spec 跨「轮」累积红）**：
- 52 spec 顺序跑，每个建群 → 本地 DB `channel`/`channel_event_cursor` **跨多轮 run 累积**
  （实测 live DB 219 行·snapshot 仅 69）。其中 **196/219 cursor 行 `last_event_seq=0`** 但
  对应 `channel.last_event_seq>0`（客户端已知高水位>0·cursor 停在 0）。
- 冷启（`up` / `reload-app`）→ `lifecycle.start` Scan `channel_event_cursor` 灌全部 cursor →
  `handle_hello` 以这些 cursor 发 `/channels/load/increment` → server 视 cursor=0 为「从头全量」→
  几乎每 channel 都报「有新事件」→ `increment_fetched` 收 ~196 channel →
  `emit_proactive_resync_for` 逐 channel 发 `/channel/sync/notify`（SyncScheduler 有在途上限 K·
  但**队列长 200+**）→ WS 通道被 sync 占满 → 发消息 post echo 帧来不及到 →
  **send 类 spec（send-1 / 3.2-l2 等）「echo 未覆写」超窗红**。
- 单跑/小批绿（DB 干净）；全套退化（DB 累积 → cursor=0 风暴放大）。实测 baseline：
  storm DB 冷启后 `spec send-1 --warm` → `echo 未覆写（断在 WS post→reconcile→DOM）` 红。

## §2 背景（why）
暖栈 app 常驻 + DB 持久（`/tmp/loopforge-im.db?mode=rwc`）+ 单份 run.jsonl。三类耦合源：
1. **boot-hop 一次性**：内核自驱 UC（4.1/4.2/4.4/10.1）的 ①② 断言标的 hop（queryTodoList / gap-sync / 心跳补偿）只在 **app boot 时**流过一次。任何后继 spec 默认 truncate run.jsonl 即抹掉 → 永红。DOM ③ 因 in-memory 残留仍绿 → 假象「只差 ①②」。
2. **脏 DOM / inflight / in-memory**：命令型 UC（1.4/5.3）自锚新建数据，但前序 spec 残留的行 / 在途 HTTP / 漂移 cursor 干扰 → 间歇红。
3. **stale-cursor restore 反噬**（2026-06-27 实测）：full DB 快照 restore 把 cursor 一并还原到**冻结时旧水位** → reload 后 hello 见 local cursor 远落后 server → 触发冷启自愈 catch-up 同步风暴（app 日志 `stuck_channels=N` + 数十条 ws-send），风暴与本 UC 的 WS echo 抢道 → DOM 更新（如 5.3 关闭行移除）被埋/迟到 → 假红。**「复位 DB」反而比不复位更不确定**。
4. **累积 channel 冷启风暴**（#1·2026-06-28 实测）：跨多轮累积的 channel（live DB 219·snapshot 69）
   在冷启 `lifecycle.start → Scan channel_event_cursor` 全量灌入 → `handle_hello → increment →
   emit_proactive_resync` **逐 channel** 发 `/channel/sync/notify`。**实测此扇出按 channel 总数走，
   不按 cursor gap 走**（关键实证）：
   - 219 channel 冷启 → **221 http-req**（220 sync/notify 风暴）·`stuck_channels` 数十
   - 仅 cursor 对齐（cursor=0→高水位·`still_behind=0`）但**不 trim** → 冷启**仍 221 http-req**
     （`emit_proactive_resync` 遍历全部 channel·不 gate gap）→ 对齐**单独不足以消风暴**
   - trim 到 ~40 channel + 对齐 → **2 http-req**·`stuck_channels=1`（风暴消失）
   - trim 到 ~26 → **2 http-req**（同样无风暴）
   故 **#1 的根因是「冷启 proactive resync 扇出 ∝ 本地 channel 总数」**；累积的 cursor=0（196/219）
   只是放大器（让每个 channel 都报「从头全量」）。**修法 = ① TRIM 收口 channel 总数（主杠杆）
   + ② ALIGN cursor 前推抹 gap（次要·hygiene）**。这修正了任务初始假设与本卡草稿一度的误判
   「对齐 cursor 即可消风暴」——对齐必要但不充分，扇出是 count-driven 不是 gap-driven。

   ⚠️ **残留（交 #2·非测试污染）**：storm 消除后（39 channel·2 http-req·zero 风暴），send 类 spec
   **仍红**「echo 未覆写」——post create 返 HTTP 200 但**无 ws-recv post echo 帧回**（client 只收到
   hello inbound·之后零入站）。即 **WS post echo 不回**是独立的真架构问题（后端 WS push / helix 接收
   分发），与 DB 累积无关·本卡（#1 隔离）不负责·见 §5 末行。

## §3 Required / Forbidden
✅ flaky-prone UC（`ISOLATE_UCS="1.4 5.3 10.1 4.1 4.2 4.4"`）默认走**隔离路径**（即使纯 `spec <uc>`·满足判据「跟在别 spec 后稳定绿」）；其余已稳健 UC 默认暖栈快路径（~10s·开发内循环）。
✅ **内核自驱 UC** 隔离 = `reload-app`（起 app 即 truncate jsonl·boot hop 重流入）+ bootstrap-UC 归属（`LOOPFORGE_BOOTSTRAP_UC=UC-X`）+ **不二次 truncate**（boot hop 是 ①② 标的）；4.x 另 `seed-behind-cursor`（cursor 落后触发 gap 回放）。
✅ **命令型 UC** 隔离 = `reload-app`（清 DOM/inflight/in-memory·**保 live cursor** 跟 server 水位·无风暴）；自锚新建 id 跨跑序确定绿。
✅ `--fresh` 强隔离 / `--warm` 强暖栈快路径 / `--keep` 保 jsonl（手动覆盖）。
✅ **#1 冷启 DB 收口（trim + align·2026-06-28）**：每个冷启点（`up` / `reload-app` / `_spec_isolated` 非-behind 分支）在起 app **前**调 `seed-align-cursor.sh`，两步：
   - **① TRIM（主杠杆·消风暴）**：把本地 `channel`/`channel_event_cursor`/孤儿 `message` 收口到「最近 N 个 channel」（按 `created_at` 降序·默认 `LOOPFORGE_KEEP_CHANNELS=40`·C003 护栏保 ≥1）。冷启 `emit_proactive_resync` 扇出 ∝ channel 总数（**非** gap），故收口总数才是消风暴的关键（实测 219→40：221→2 http-req·`stuck_channels` 196→1）。被删频道 server 仍在·真活跃的下次冷启自然回灌（trim 到 10→冷启回灌 26=server 真实集·仍无风暴）。
   - **② ALIGN（次要·hygiene）**：剩余 cursor 前推 `MAX(自身, channel.last_event_seq)`（只前推不后退·无数据丢失·抹 cursor=0 的「从头全量」）。
   **免费**：复用既有冷启点·不给暖栈快路径 spec 引入额外冷启税（warm 路径不冷启→不风暴→无需收口）。属 C004 决策 A「改环境不改冻结 oracle」。
✅ **align/trim vs behind 互斥**：`seed-align-cursor.sh`（trim+前推·消风暴·命令型/send/自驱-plain 用）与 `seed-behind-cursor.sh`（后退·造 gap·触发回放·自驱-behind 4.x 用）按 UC 类型择一；**禁在 4.1/4.2/4.4 路径调 seed-align-cursor**（会抹平其回放触发条件）。
⚠️ **#2 残留交接**：trim+align 把 #1 测试污染风暴清零后，send 类 spec 仍红 = **WS post echo 不回**（真架构问题·post create 200 但无 ws-recv 回声）→ 不在本卡（#1）职责内·交 #2 agent。
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

# 2b. #1 冷启 DB 收口基元存在 + 接到每个冷启点
test -x scripts/seed-align-cursor.sh
grep -q 'seed-align-cursor' scripts/harness.sh             # up / reload-app / _spec_isolated 三处接入
bash -n scripts/seed-align-cursor.sh                       # 语法
# 收口有效性（铁证·须 app 停 + seeded DB）：trim 到 N + 对齐 → behind=0
bash scripts/seed-align-cursor.sh                          # 末行：channel(before-after)=219/40 behind=N/0
# 风暴消除（铁证·须冷启）：trim 前 219 channel → run.jsonl http-req ~221；trim 后 ~40 → http-req ≤个位数
#   bash scripts/harness.sh reload-app && grep -c '"hop":"http-req"' /tmp/loopforge/run.jsonl
#   app 日志 stuck_channels：196 → 1

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
| 2026-06-28 | (本卡) | #1 全套顺序跑 send-1/3.2-l2 等超窗红（单跑绿） | 跨轮累积 DB（219 channel）冷启 `emit_proactive_resync` **逐 channel** 扇出 220 条 sync/notify → 占满 WS → post echo 抢不到道 → 「echo 未覆写」。**扇出 ∝ channel 总数·非 gap**：仅对齐 cursor 仍 221 http-req；trim 到 40 → 2 http-req·stuck 196→1。修 = 冷启前 `seed-align-cursor.sh`（trim 收口 + cursor 对齐）|
| 2026-06-28 | (交 #2) | storm 清零后 send 类仍红「echo 未覆写」 | **WS post echo 不回**（post create 200·无 ws-recv 回声·仅 hello inbound）= 真架构问题（后端 WS push / helix 接收分发）·与测试污染无关·#1 不负责 |

## §6 关联
- 上游：C003（seeded DB·active channel 根）· C004（改环境不改 oracle·决策 A）· C002（就绪 probe 解耦）
- 兄弟：`seed-behind-cursor.sh`（cursor 相对**后退**·造 gap·自驱-behind 4.x 触发回放）vs `seed-align-cursor.sh`（cursor **前推**对齐高水位·抹 gap·消冷启风暴·#1）vs `seed-snapshot.sh`（整库字节复位·命令型显式复位工具）—— 三者按场景择一，align 与 behind 互斥
- 下游：所有 UC rollout 串行/批量跑（C006 闭环）· autonomous overnight runbook
- 机制：`harness.sh spec <uc> [--fresh|--warm|--keep]` + `seed-freeze` + `ISOLATE_UCS` env

## §7 历史与演进
- drafting→active：2026-06-27 抓 1.4/5.3/10.1 三次同根因（达三铁律 ≥3 门槛）→ 即时新建。
- 关键演进：DB restore 从「默认开」→「默认关 opt-in」——实测 stale-cursor restore 引发同步风暴，
  比「reload 保 live cursor」更不确定；隔离的确定性核心是 **reload 复位易失态（DOM/inflight/in-memory）
  + 保 live cursor**，而非「DB 字节复位」。这修正了任务初始假设「每 spec 复位 DB 快照」。
