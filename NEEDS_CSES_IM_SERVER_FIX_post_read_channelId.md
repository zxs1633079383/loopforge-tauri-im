# NEEDS_CSES_IM_SERVER_FIX — post_read WS 帧缺 channelId（阻 L2 #14/#47 UC-3.2 单条已读）

> 协调件（让 main 协调 cses-im-server 仓·别在本仓改后端）。loop-Engine 数据面 drive·2026-06-28。

## 一句话 gap
cses-im-server 广播的 `post_read`(type6 已读回执) WS 帧 **不携带 channelId**（`data` 无 channelId·`broadcast.channelId=""`），但 helix `post_read` handler **硬要求 channelId**（缺则 no-op）→ A=444 收到帧也不 emit `im:post:read` → L2 read-receipt ②④③ 永红。

## 实证（raw-WS observe 444·本会话）
A=444 发消息(postId=amq1zmn76pbz3gdamawduy6tne) → B=678 `POST post/read` 标已读 → 444 raw-WS 收到 post_read 帧：
```json
{
  "v": ..., "action": "post_read", "seq": ...,
  "data": {"createAt":1782619679459,"postId":"amq1zmn76pbz3gdamawduy6tne","readMap":"11","updateAt":1782619679604},
  "broadcast": {"userId":"444","userIds":["444","678"],"channelId":"","teamId":"","omitUsers":null,...}
}
```
- ✅ 后端 **确实广播** post_read 给消息作者（broadcast.userId=444·routed by userId）—— fanout 正常。
- ❌ 帧 **缺 channelId**：`data` 无 channelId/channel_id 键·`broadcast.channelId` 是空串。

## helix 侧为何 no-op（非 helix bug·是契约缺字段）
`helix/crates/helix-im/src/ws/handlers/post_read.rs:51-58`：
```rust
let Some(channel_id) = data.get("channelId").or_else(|| data.get("channel_id"))
    .and_then(Value::as_str).and_then(ChannelId::from_str)
else { return Ok(()); };   // ← 缺 channelId 直接 no-op
```
helix 需要 channelId 做 per-channel cursor 推进 + emit 锚（spec §S1/§S4·type6 kind-aware gate）。post_read 帧不带 channelId → helix 无从推进哪个频道的 cursor → 静默 no-op。

## 期望后端改动（cses-im-server）
post_read 广播帧的 `data` **补 channelId 字段**（与 `post` 帧 data.channelId 同约定）。
- 改哪：cses-im-server 发 post_read WS 帧的构造处（handlers/post.go handle_read → 组 PostReadData 时带上 channelId·参 post 帧已携 channelId 的写法）。
- 期望帧：`data: {channelId, postId, readMap, createAt, updateAt}`（加一个 channelId 键即可）。
- 可选：同时把 `broadcast.channelId` 填上（非必需·helix 读 data.channelId）。

## 修复后本仓验证（artifacts 已就绪·一条命令转绿）
- `test/specs/uc-3.2-l2.e2e.mjs`（已 port·当场建带 678 频道·A 发→678 read-post→A 收 echo）
- `test/expect/uc-3.2-l2.expect.json`（① optional·② im:post:read fat·④ message·③ data-read-bits）
- 验证：`bash scripts/harness.sh spec 3.2-l2` → 应四面全绿（reducer 锚 sid=A 的 postId）。
- 守可证伪：spec 现红在 ②（waitUntil im:post:read 超时）= 真 gap·非掩盖（C008）。

## ⚠️ ROUND-2 复验（2026-06-28·后端已补 channelId·commit 6e6dbc3 后实测）
后端 round-2 确实修了 channelId（raw-WS 实证 post_read 帧 `data.channelId` 现非空）。**但 #14 仍红**——
更深一层 gap：

1. **post_read 帧仍缺 `event_seq`**（data 只有 channelId/postId/readMap/createAt/updateAt）。helix
   `ws/handlers/gate.rs:51` `gate_ingest_content_event` 走 channel gate（严格 +1 cursor 排序），
   `let Some(seq) = frame.event_seq() else { return no-op }`——`frame.event_seq()` 读 data.event_seq /
   props.channel_event_seq / channel_event_seq 均无 → None → **gate no-op·不 emit·不落库**。
2. **read 不产生 sequenced channel_event**（实测）：678 读 444 消息后，A sync 该频道仍 `nextSeq=2`
   （仅 join eventSeq=1 + A 消息 eventSeq=2）·**无 type6 read 事件**。即 read 是「无序号的旁路回执」·
   不参与频道事件序列 → 本就没有 event_seq 可带。

### 架构层 mismatch（main/人审决议·二选一）
- **A. helix 改（推荐·属引擎缺陷 C004·非冻结 oracle）**：post_read **不该走 cursor gate**。已读回执是
  对既存 message 的 **read_bits 幂等覆盖写**（readMap 是全量权威位图·非增量·天然 order-independent），
  无需 +1 序号排序。helix post_read handler 应**直接** apply_read_op（覆盖 read_bits）+ emit im:post:read·
  绕开 gate_ingest_content_event 的 event_seq 强校验。**此改在 helix 仓·跨仓+re-pin·建议 main 协调或
  专批授权**（本批 coordinator scope 限 loopforge+后端·未授 helix 引擎改）。
- **B. 后端改**：post_read 也建 sequenced channel_event（带 eventSeq）并入 sync 流。**不推荐**——每次已读
  =一条 channel_event 会让事件日志暴涨（hot-path 写放大·违 performance 铁律 normalized/O(1) 精神）。

### 现状
**#14/#47 留 OPEN·park**（连败 2 次：round-1 无 channelId·round-2 无 event_seq+gate mismatch·不 fake-green C011）。
spec/expect harness 就绪（test/specs/uc-3.2-l2.e2e.mjs + test/expect/uc-3.2-l2.expect.json）·按方案 A 改 helix 后
`harness.sh spec 3.2-l2` 即可转绿（守可证伪：现红在 ② waitUntil im:post:read 超时）。

## 关联
- issue #14（UC-3.2 单条已读·L2-pending）+ tracker #47（read-receipt）。**留 OPEN·park·不 fake-green**。
- 同族 #15（UC-3.1 会话已读·channels/view read echo）大概率同根因（read 旁路回执无 event_seq + 同 gate mismatch）。
