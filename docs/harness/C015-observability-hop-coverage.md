# C015 — 可观测性逐跳覆盖闸（每 port 边界/旁路必有 hop 探针·缺一跳即诊断盲点）

> 状态：active · 立于 2026-06-29（echo gate-gap 整类根治复盘沉淀）

## §1 触发场景

诊断"某动作端到端不生效"（消息不上屏 / echo 不到 / 投影不渲）时，**失败可能落在 4 跳的任一跳**：
```
① 后端出站(cses 广播帧) → ② helix 收到(WS recv) → ③ helix 输出(投影/gate emit) → ④ UI 渲染(DOM)
```
本卡适用于：任何"看不见的链路"排查；新增 WS handler / Tick 旁路 / 自驱 effect；reducer 报"断在哪一跳"但中间跳无数据。

## §2 背景（why·真实代价）

2026-06-29 echo gate-gap 根治时实测：**WS 入站帧走 native `engine_loop` 的 `Tick::Inbound` 直泵 helix-im·绕过了 `Recording::recv()` 的 tee** → run.jsonl **永无 ws-recv 事件 = ② 跳是诊断盲点**。

后果：UI 不显示一条消息，从外面看，三种根因**长得一模一样**：
- (a) 后端没广播（帧没发）  (b) helix 收到但没 emit（帧到了·gate buffer）  (c) helix 没收到（投递/路由）

只有 ①③④ 没 ②，**无法区分这三个 → 只能猜**。实测代价：send-echo 一个 bug 连猜 ~5 个 agent（"零广播"错 /"HoL 晚到"错·真相是 gate buffer-gap）。**盲点的代价不是丢 1/4 信息，是丢掉大部分诊断力**——它制造的歧义横跨多个假设。

补常驻 `HOP2`（helix 收到 `{action,seq,cursor}`）+ `HOP3`（gate 决策 `apply-emit|dup-drop|buffer-gap`）后，**同类 bug 一遍定位**（"HOP2 收到 seq=12·HOP3 cursor=2 buffer-gap"→ 帧到了被缓冲·秒懂）。

**通用原理**：装饰器/port 模式下，**只要有一条旁路代码路径不走被装饰的 port，instrumentation 就有洞**。每条旁路（`Tick::Inbound` 直泵 / `Tick::Command` 出站 / 内核自驱 effect / 直接 emit）= 一个潜在盲点。

## §3 Required / Forbidden

**Required**：
- 4 跳每跳必有结构化 hop（corr_key 串联）：① outbound（http-req/ws-send）② ws-recv / **HOP2**（helix 入站）③ projection / **HOP3**（gate 决策·须区分 apply-emit vs buffer-gap vs dup-drop）④ DOM（e2e 注入）。
- 任何绕过 `Recording` 装饰器的旁路（`Tick::Inbound`/`Tick::Command`/自驱 effect/直泵）**新增或改动时必须同步补对应 hop 探针**。
- 新增 WS handler / 新 emit 路径 PR：必须带其 hop 日志。

**Forbidden**：
- ❌ 只埋端点（①④）不埋中间（②③）——失败时"没发/没收/收了没吐"三态不可分。
- ❌ 假设"走了装饰 port 就一定被 tee"——先确认没有旁路绕过（`Tick::Inbound` 就是反例）。
- ❌ 诊断难得不成比例时硬猜逻辑——**先怀疑可观测性盲点，再怀疑逻辑复杂**（C015 第一反应）。

## §4 Verification（可执行）

```bash
# 1) 旁路覆盖：每个 Tick/直泵入站处理点必须有 HOP tracing（无则盲点）
#    入站处理点 grep（helix-im）vs HOP2 探针数 —— 处理点不得多于探针
grep -rn "Tick::Inbound\|dispatch_ws\|fn handle.*Inbound" \
  /System/Volumes/Data/workspace/rust/helix/crates/helix-im/src/ | wc -l
grep -rn "HOP2\|tracing::.*HOP2" \
  /System/Volumes/Data/workspace/rust/helix/crates/helix-im/src/ws/ | wc -l   # ≥ 入站处理点

# 2) gate 决策可见：buffer-gap 分支必须有 HOP3（否则"收到但没吐"不可观测）
grep -rn "buffer.*gap\|buffer_and_arm_gate" \
  /System/Volumes/Data/workspace/rust/helix/crates/helix-im/src/ | head
grep -rn "HOP3\|apply-emit\|buffer-gap" \
  /System/Volumes/Data/workspace/rust/helix/crates/helix-im/src/ | wc -l     # >0

# 3) 四跳完整性：一次绿 send-1 的日志必须含全 4 跳（任一缺 = 盲点回归）
bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
for hop in '"facet":"outbound"' 'HOP2\|ws-recv' 'HOP3\|"facet":"projection"' 'data-msg-id'; do
  grep -qE "$hop" /tmp/loopforge/run-app.log /tmp/loopforge/run.jsonl \
    && echo "✅ hop present: $hop" || echo "🔴 BLIND SPOT: $hop 缺"
done
```
（CI/gate 可把第 3 步固化为"绿 run 必含 4 hop"断言；第 1 步固化为"入站处理点数 ≤ HOP2 探针数"不变量。）

## §5 Recurrence Log

- 2026-06-29 ②盲点（`Tick::Inbound` 绕过 `Recording::recv`）→ send-echo 误诊 ~5 agent → 补 HOP2/HOP3 常驻 tracing → 同类 post_update gate-gap 一遍定位。立卡。

## §6 关联

- C005 reducer 跨形态归一（reducer 聚 hop·本卡保证 hop 齐全）
- C008 测试可证伪（hop 是证伪的证据源）
- C009 reducer 裁定（裁定靠 hop·盲点 = 裁定失据）
- 与 autonomous loop-engine `diagnosis-router`（红→三段日志→route()）强相关：**路由正确性依赖 hop 完整**·盲点 → 路由错（实测前期修错几次）。
- helix `crates/helix-im/src/ws/registry.rs`（HOP2）/ `channel.rs` `ingest`（HOP3）。

## §7 历史与演进

立卡即 active（2026-06-29）。**分层落地**：通用原则「可观测性逐跳完整 / 诊断不成比例先查盲点」已上提为 **helix 项目级 rule**（`helix/CLAUDE.md` + `AGENTS.md` §1 核心开发理念 第 5 条·2026-06-29 用户拍板·不放全局）；具体"审 `Recording` 旁路 + 补 HOP2/HOP3 + 4-hop 完整性断言"的工程机制留本卡。后续：CI 固化本卡 §4 的"绿 run 必含 4 hop"+"入站处理点 ≤ HOP2 探针数"两不变量。
