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

## ✅ ROUND-3 实施（2026-06-28·方案 A 已落地 helix）
按 round-2 方案 A 改 helix：`crates/helix-im/src/ws/handlers/post_read.rs` **绕开 channel gate** 走专用
直路——`apply_read_op`（覆盖 read_bits）+ `emit_post_read`（fat·event_seq=0），缺 event_seq 不再 no-op。
- helix 分支 `fix/im-post-read-bypass-gate` @ commit **2a6a0be**（base b707349·禁推/禁合 main·留人审）。
- helix 测试：`cargo check -p helix-im` PASS·`cargo test -p helix-im` 175+ 全绿（+1 新回归
  `post_read_without_event_seq_still_writes_and_emits_s1`）。
- loopforge re-pin：src-tauri/Cargo.toml + helix-driver-instrument/Cargo.toml branch →
  `fix/im-post-read-bypass-gate`·Cargo.lock → 2a6a0be。

### 四面 reducer 实测（`harness.sh spec 3.2-l2`·A 发 k6kc…→678 read→A 收 echo）
| 面 | 结果 | 证据 |
|---|---|---|
| ① 出站 | N/A·optional·**满足** | spec 直断 678 post/read → `{"status":"SUCCESS"}` |
| ② 投影 | ✅ **绿** | A run.jsonl emit `im:post:read` fat 17 键·`readBits:"11"`·event_seq=0（**root gap 已修**：缺 event_seq 现也 emit） |
| ③ DOM | ✅ **绿** | `[data-msg-id=k6kc…]` data-read-bits=11 已更新 |
| ④ 落库 | ❌ **红·仅 op 标签** | 实得 `op=batch_update`（`UPDATE message SET read_bits WHERE id`·keys=1）·oracle 期 `batch_upsert` |

### ④ 红 = 冻结 oracle 过时（C004·停下标人审·非实现缺陷）
read 是对**既存** message 行 read_bits 列的覆盖写 → `apply_read_op` 用 `BatchUpdate`（O(1) UPDATE·
helix channel.rs:453 注释明示「**不**用 ON CONFLICT(id)·message.id 无 UNIQUE 约束」）是**架构正确**形态。
`batch_upsert` 在此**不可行**（post_read wire 只带 {postId,readMap}·无整行·无 UNIQUE 约束无法 ON CONFLICT）。
- **证据 1**：expect.json storage._note 自述「**update** read_bits 列」——与自身 op 标签 `batch_upsert` 自相矛盾。
- **证据 2**：run.jsonl 对同 msg_id 确有一条 `batch_upsert`(rows=1)——但那是 **send INSERT**（bundle
  `UC-3.2-L2-send`·seq 4637）·非 read echo；read echo 是 `batch_update`（bundle `UC-3.2`·seq 4641）。
  oracle 作者疑似把「消息行被 send upsert」误当「read echo 落库」。
- **证据 3**：在线（post_read.rs）+ 离线（sync_effects.rs:115）read 双路径均 `apply_read_op`→batch_update。
- **证据 4**：reducer 已归一 `rows = rows ?? keys`（minRows≥1 用 keys=1 满足）——唯 op 字符串严格相等卡红。

**契约变更提案（交人审·禁 agent 自改冻结 oracle）**：
`test/expect/uc-3.2-l2.expect.json` + `test/expect/uc-3.2.expect.json`（L1 母本）storage.op
`batch_upsert` → **`batch_update`**（read 是 column overwrite·非 row upsert）。人审拍板后改 oracle →
`harness.sh spec 3.2-l2` 即四面全绿 → 关 #14/#47。**本批不自改 oracle·不 fake-green·#14 留 OPEN。**

## 关联
- issue #14（UC-3.2 单条已读·L2-pending）+ tracker #47（read-receipt）。**留 OPEN·park·不 fake-green**。
- 同族 #15（UC-3.1 会话已读·channels/view read echo）大概率同根因（read 旁路回执无 event_seq + 同 gate mismatch）。
