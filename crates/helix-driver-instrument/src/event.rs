//! JSONL hop 事件 schema —— 自动修复 agent 的"眼睛"（CLAUDE.md §5）。
//!
//! 装饰器每跳吐一行 [`HopEvent`]；reducer 把同 `corr_key` 的四面聚成一束 + 与期望 diff，
//! 出「断在哪一跳」报告。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 四面契约里的"面"。
///
/// P0b 6 面扩展（test-only·6-facet-oracle.md）在四面之上补**输入侧两个面** [`Facet::IpcIn`] +
/// [`Facet::Inbound`]，使能机器断言「壳在 invoke→helix 之间零加工」（C013 纯壳不变量）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Facet {
    /// ① 出站命令体（HTTP body / WS 出站帧）—— 对照真机curl真源。
    Outbound,
    /// ② 投影 envelope（EventSink emit）—— 对照 projection-schema。
    Projection,
    /// ④ DB 落库行（Storage 写）。
    Storage,
    /// 入站 WS 帧（go 主动推；驱动投影的输入，供 reducer 串 corr_key）。
    WsRecv,
    /// ⓪ IPC 输入面（test-only）：src-tauri command 层 tee `{command, args}`——壳收到的原始 invoke
    /// 入参。与 [`Facet::Inbound`] 配对量化 C013 纯壳不变量（IpcIn.args ≡ Inbound.args）。kebab=`ipc-in`。
    IpcIn,
    /// 进引擎指令面（test-only）：command-dispatch 装饰器 tee `{command, args}`——进引擎泵的指令。
    /// 与 [`Facet::IpcIn`] 比对证明「壳零中间 shaping」（reducer 纯壳不变量）。kebab=`inbound`。
    Inbound,
}

/// 链路上的"哪一跳"（reducer 定位"断在哪一跳"用）。
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Hop {
    /// 出站 WS 帧。
    WsSend,
    /// 出站 HTTP 请求。
    HttpReq,
    /// HTTP 响应（go 回的）。
    HttpResp,
    /// 入站 WS 帧。
    WsRecv,
    /// 投影 emit。
    Projection,
    /// 存储写。
    Storage,
    /// 连接生命周期（connect/close）。
    Lifecycle,
    /// ⓪ IPC 输入（src-tauri command 层 tee·test-only）。kebab=`ipc-in`。
    IpcIn,
    /// 进引擎指令（command-dispatch 装饰器 tee·test-only）。kebab=`inbound`。
    Inbound,
}

/// 一条结构化 hop 日志。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HopEvent {
    /// 一次进程 run 的 id（同一 tape/会话）。
    pub run_id: String,
    /// 当前 UC id（harness 在每个 UC 前 set；静默期为 `"__quiescence__"`）。
    pub uc_id: String,
    /// 领域键（channelId + tmp_id/server_id + event_seq 的最佳努力抽取）；reducer 可覆盖。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corr_key: Option<String>,
    /// 四面之一。
    pub facet: Facet,
    /// 哪一跳。
    pub hop: Hop,
    /// 单调发射序号（同一 run 内排序，不依赖墙钟，守 HX-C011 禁墙钟断言）。
    pub seq: u64,
    /// 原始 payload（JSON 优先，便于 reducer 抽键与 diff）。
    pub payload: Value,
}

/// 从 payload 最佳努力抽领域键（顶层 + `.data` 两处找常见键）。
/// 抽不到返回 None —— 由 reducer 用更强的领域规则补。
pub fn extract_corr_key(payload: &Value) -> Option<String> {
    let probe = |obj: &Value| -> Option<String> {
        let pick = |keys: &[&str]| -> Option<String> {
            for k in keys {
                if let Some(v) = obj.get(*k) {
                    if v.is_string() {
                        return v.as_str().map(|s| s.to_string());
                    }
                    if v.is_number() {
                        return Some(v.to_string());
                    }
                }
            }
            None
        };
        let ch = pick(&["channelId", "channel_id", "channelID"]);
        let tmp = pick(&["temporaryId", "temporary_id"]);
        // msg_id：投影 envelope（im:post:received/updated）携 server post id 的键——加入 sid 别名
        // 使「投影(msg_id) ↔ 出站(postId) ↔ 落库(id)」三面经 sid 聚同束（UC-1.9 加急·与 reducer
        // corr-key.mjs sid 别名同步）。tmp 仍为 send 主事件首选锚·msg_id 入 sid 为附加锚。
        let sid = pick(&["id", "postId", "post_id", "serverId", "server_id", "msg_id"]);
        let seq = pick(&["eventSeq", "event_seq", "seq"]);
        // 任一维度命中即组键；全空返回 None。
        if ch.is_none() && tmp.is_none() && sid.is_none() && seq.is_none() {
            return None;
        }
        let mut parts: Vec<String> = Vec::new();
        if let Some(c) = ch {
            parts.push(format!("ch={c}"));
        }
        if let Some(t) = tmp {
            parts.push(format!("tmp={t}"));
        }
        if let Some(s) = sid {
            parts.push(format!("sid={s}"));
        }
        if let Some(q) = seq {
            parts.push(format!("seq={q}"));
        }
        Some(parts.join(";"))
    };

    // URL 感知归一（UC-5.4 ① 群属性修改出站 channel/change/*）：出站 body = {id, displayName}
    // / {id, notice} 等——此处 `id` == **channelId**（helix outbound channel_change*.rs 真源
    // `{ "id": channel_id, ... }`），非 server post id。但 `id` 在 sid 别名里会被误抽成 sid →
    // 与 ② im:channel:update（ch 锚）/ ④ channel PATCH（ch 锚）不并束。专探：当出站 url 含
    // `channel/change/` 且 body.id 是非空字符串 → 组 ch 键，使 ① 与 ②④ 同束。
    // 契约不变（URL+body-shape 没变·仅抽键探针增强·与 reducer corr-key.mjs::extractDims 同步）。
    if let Some(url) = payload.get("url").and_then(|v| v.as_str()) {
        if url.contains("channel/change/") {
            if let Some(id) = payload
                .get("body")
                .and_then(|b| b.get("id"))
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                return Some(format!("ch={id}"));
            }
        }
    }

    // 表感知归一（UC-4.1 ④ storage channel 落库）：channel 表主键 `id` == channelId（非 server
    // post id）→ 必抽成 ch 而非 sid，使 ④ 与 ② im:channel:increment（ch 锚）同束。
    // 判据：payload.table == "channel" 且无独立 channel_id（落库 payload {id,op,table,rows} 形态）。
    // 与 reducer corr-key.mjs::extractDims 表感知规则对齐（spec §2 抽键须两侧同步）。
    if payload.get("table").and_then(|t| t.as_str()) == Some("channel")
        && payload.get("channel_id").is_none()
        && payload.get("channelId").is_none()
    {
        if let Some(id) = payload.get("id").and_then(|v| v.as_str()) {
            if !id.is_empty() {
                return Some(format!("ch={id}"));
            }
        }
    }

    // UC-3.2 单条已读出站 `post/read`：body = {channelId, posts:[postId]}。posts 是 string 数组
    // （元素非对象·pick 取不到 sid）→ 单 probe 只抽到 ch，与投影 im:post:read（ch+sid(msg_id)+seq）
    // 经 ch-only 聚不上束（reducer sameEvent 要求两侧全 scoped）。补 sid：obj.posts[0] 是非空字符串
    // （postId == 投影 msg_id 同一 server post id）→ 追加 sid，使出站经 sid 与投影/落库同束。
    // 契约不变（URL+body-shape 没变·仅抽键探针增强·与 reducer corr-key.mjs::extractDims 同步）。
    let augment_posts = |k: String, obj: &Value| -> String {
        if k.contains("sid=") {
            return k;
        }
        if let Some(pid) = obj
            .get("posts")
            .and_then(|p| p.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return format!("{k};sid={pid}");
        }
        k
    };

    if let Some(k) = probe(payload) {
        return Some(augment_posts(k, payload));
    }
    if let Some(data) = payload.get("data") {
        if let Some(k) = probe(data) {
            return Some(augment_posts(k, data));
        }
    }
    // P0b ⓪ IpcIn/Inbound tee payload 形态 {command, args:{...}}：领域键嵌在 `.args`（顶层只有
    // command/args）→ 探 args 取 ch/tmp/sid/seq，使纯壳两面与发送束聚同 corr_key（6-facet-oracle §3·
    // 与 reducer corr-key.mjs::extractDims `.args` 探针同步）。
    if let Some(args) = payload.get("args") {
        if let Some(k) = probe(args) {
            return Some(augment_posts(k, args));
        }
    }
    // 出站 HTTP body 嵌在 `payload.body`（http.rs::req_payload）：channelId/posts 等领域键在此层
    // （顶层只有 method/url/headers/body）。探 body 取 ch + posts[0] sid（UC-3.2 post/read ① 面·
    // 使出站与 per-post ② projection / ④ storage 经 sid 同束）。
    if let Some(body) = payload.get("body") {
        if let Some(k) = probe(body) {
            return Some(augment_posts(k, body));
        }
    }
    // batch sync 出站（channels/load/increment）：channelId 嵌在 body.cursors[0]，
    // 顶层/`.data`/`body`(顶层无 channelId) 都抽不到 → 探 body.cursors[0] 取锚频道（UC-4.1 ① 与
    // per-channel ② projection / ④ storage 同束的唯一 corr_key 来源；批次首元素代表本束）。
    if let Some(c0) = payload
        .get("body")
        .and_then(|b| b.get("cursors"))
        .and_then(|c| c.get(0))
    {
        if let Some(k) = probe(c0) {
            return Some(k);
        }
    }
    // 会话已读出站（channels/view·UC-3.1）：body = {channels:[{id:channelId}]}。channels[0].id 是
    // **channelId**（非 server post id）——probe 会把 `id` 误抽成 sid，故专探：取 channels[0].id 组
    // ch 键，使 ① 出站与 per-channel ② projection / ④ storage（ch 锚）同束。批次首元素代表本束
    // （会话已读单频道·与 reducer corr-key.mjs::extractDims channels[0].id→ch 规则同步）。
    if let Some(id) = payload
        .get("body")
        .and_then(|b| b.get("channels"))
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|e| e.get("id"))
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
    {
        return Some(format!("ch={id}"));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_from_top_level() {
        let p = json!({"channelId": "c1", "temporaryId": "t9", "eventSeq": 40114});
        assert_eq!(
            extract_corr_key(&p).as_deref(),
            Some("ch=c1;tmp=t9;seq=40114")
        );
    }

    #[test]
    fn extracts_from_nested_data() {
        let p = json!({"action": "post", "data": {"channel_id": "c2", "id": "s7"}});
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=c2;sid=s7"));
    }

    #[test]
    fn none_when_no_keys() {
        assert_eq!(extract_corr_key(&json!({"foo": 1})), None);
    }

    #[test]
    fn channel_storage_id_extracts_as_ch_not_sid() {
        // UC-4.1 ④：channel 落库 payload {id, op, table:'channel', rows}。
        // id == channelId（非 server post id）→ 抽 ch，使 ④ 与 ② im:channel:increment(ch) 同束。
        let p = json!({"id": "a1rz6", "op": "batch_upsert", "table": "channel", "rows": 1});
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=a1rz6"));
    }

    #[test]
    fn message_storage_id_still_sid() {
        // 回归：message 落库 id 仍是 server post id → 抽 sid（table != channel）。
        let p = json!({"id": "s7", "op": "batch_upsert", "table": "message", "rows": 1});
        assert_eq!(extract_corr_key(&p).as_deref(), Some("sid=s7"));
    }

    #[test]
    fn projection_msg_id_extracts_as_sid() {
        // UC-1.9 加急：im:post:updated 投影 data 携 server post id 用 `msg_id`（非 id）。
        // msg_id 入 sid 别名 → 投影与出站(postId)/落库(id) 经 sid 聚同束（缺则投影只抽 ch/tmp/seq·④ 永红）。
        let p = json!({"channelId": "c", "msg_id": "3acq", "temporaryId": "ec39", "event_seq": 42});
        // tmp 仍在·sid 附加：ch + tmp + sid + seq 全命中。
        assert_eq!(
            extract_corr_key(&p).as_deref(),
            Some("ch=c;tmp=ec39;sid=3acq;seq=42")
        );
    }

    #[test]
    fn extracts_from_batch_cursors_first_element() {
        // channels/load/increment 出站：channelId 嵌在 body.cursors[0]，
        // 顶层 + .data 都抽不到 → 探 cursors[0] 取锚频道（UC-4.1 ① 面）。
        let p = json!({
            "method": "POST",
            "url": "https://x/channels/load/increment",
            "body": {"timestamp": 0, "cursors": [{"channelId": "cAnchor", "fromSeq": 0}]}
        });
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=cAnchor"));
    }

    #[test]
    fn channel_change_outbound_body_id_extracts_as_ch() {
        // UC-5.4 ① 群属性修改出站 channel/change/displayName：body = {id, displayName}·id == channelId
        // （非 server post id）。url 含 channel/change/ → 须把 body.id 抽成 ch（非 sid），使 ① 与
        // ② im:channel:update（ch 锚）/ ④ channel PATCH（ch 锚）同束（否则 id 误抽成 sid·聚不上束）。
        let p = json!({
            "method": "POST",
            "url": "http://x/api/cses/channel/change/displayName",
            "headers": [],
            "body": {"id": "ch5p4abcdefghijklmnopqrstu", "displayName": "新群名"}
        });
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=ch5p4abcdefghijklmnopqrstu"));
    }

    #[test]
    fn channel_change_notice_outbound_body_id_extracts_as_ch() {
        // UC-5.4 改公告 channel/change/notice：body = {id, notice:{...}}·id == channelId·同上抽 ch。
        let p = json!({
            "method": "POST",
            "url": "http://x/api/cses/channel/change/notice",
            "headers": [],
            "body": {"id": "ch5p4abcdefghijklmnopqrstu", "notice": {"text": "公告内容"}}
        });
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=ch5p4abcdefghijklmnopqrstu"));
    }

    #[test]
    fn post_read_posts_first_extracts_as_sid() {
        // UC-3.2 单条已读出站 post/read：body = {channelId, posts:[postId]}。posts 是 string 数组
        // → probe 顶层只抽到 ch（pick 取不到 sid）→ 补 posts[0] string 作 sid，使出站经 sid 与
        // 投影 im:post:read（msg_id）/落库（id）同束（缺则出站只有 ch·与投影聚不上束 ②/④ 永红）。
        let p = json!({"channelId": "c9", "posts": ["postZZZ"]});
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=c9;sid=postZZZ"));
    }

    #[test]
    fn post_read_outbound_body_nested_extracts_ch_and_sid() {
        // UC-3.2 ① 面真形态（http.rs::req_payload）：channelId/posts 嵌在 payload.body·顶层只有
        // method/url/headers/body → 须探 body 取 ch + posts[0] sid（否则 ① 出站无 corr_key·与投影聚不上束）。
        let p = json!({
            "method": "POST",
            "url": "http://x/api/cses/post/read",
            "headers": [],
            "body": {"channelId": "15gcg", "posts": ["pgn6uy"]}
        });
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=15gcg;sid=pgn6uy"));
    }

    #[test]
    fn post_read_posts_falsifiable_empty_no_sid() {
        // 可证伪对偶（HX-C011）：posts 为空数组 / 非字符串元素 → 不补 sid（保持只 ch·不臆造束）。
        let empty = json!({"channelId": "c9", "posts": []});
        assert_eq!(extract_corr_key(&empty).as_deref(), Some("ch=c9"));
        let non_str = json!({"channelId": "c9", "posts": [{"id": "x"}]});
        assert_eq!(extract_corr_key(&non_str).as_deref(), Some("ch=c9"));
    }

    #[test]
    fn channels_view_outbound_body_extracts_ch() {
        // UC-3.1 会话已读 ① 面（http.rs::req_payload）：body = {channels:[{id:channelId}]}。
        // channels[0].id 是 channelId（非 post id）→ 专探取 ch（否则 probe 把 id 误抽 sid·与 ②④
        // ch 锚聚不上束 → ① 永红）。顶层只有 method/url/headers/body。
        let p = json!({
            "method": "POST",
            "url": "http://x/api/cses/channels/view",
            "headers": [],
            "body": {"channels": [{"id": "chView"}]}
        });
        assert_eq!(extract_corr_key(&p).as_deref(), Some("ch=chView"));
    }

    #[test]
    fn ipc_in_inbound_facet_serialize_kebab() {
        // P0b ⓪：新增两面序列化为 kebab——与 reducer facet 字符串（'ipc-in'/'inbound'）逐字对齐。
        assert_eq!(serde_json::to_string(&Facet::IpcIn).unwrap(), "\"ipc-in\"");
        assert_eq!(serde_json::to_string(&Facet::Inbound).unwrap(), "\"inbound\"");
        assert_eq!(serde_json::to_string(&Hop::IpcIn).unwrap(), "\"ipc-in\"");
        assert_eq!(serde_json::to_string(&Hop::Inbound).unwrap(), "\"inbound\"");
        // 回归：旧四面序列化不变（叠加面零破坏）。
        assert_eq!(serde_json::to_string(&Facet::Outbound).unwrap(), "\"outbound\"");
        assert_eq!(serde_json::to_string(&Facet::WsRecv).unwrap(), "\"ws-recv\"");
    }

    #[test]
    fn ipc_in_inbound_facet_roundtrip() {
        // 可证伪：序列化往返恒等（reducer 写出的 ipc-in/inbound 帧能被 Rust 侧反序列化回同一面）。
        for f in [Facet::IpcIn, Facet::Inbound, Facet::Outbound, Facet::WsRecv] {
            let s = serde_json::to_string(&f).unwrap();
            let back: Facet = serde_json::from_str(&s).unwrap();
            assert_eq!(f, back);
        }
    }

    #[test]
    fn extracts_from_args_for_ipc_in_inbound() {
        // P0b ⓪ tee payload {command, args:{...}}：领域键嵌 .args（顶层无 ch/tmp）→ 须从 args 抽。
        // IpcIn（camel）：
        let ipc = json!({"command": "im_send", "args": {"channelId": "c1", "temporaryId": "t9"}});
        assert_eq!(extract_corr_key(&ipc).as_deref(), Some("ch=c1;tmp=t9"));
        // Inbound（snake·进引擎指令）：
        let inb = json!({"command": "im_send_message", "args": {"channel_id": "c1", "temporary_id": "t9"}});
        assert_eq!(extract_corr_key(&inb).as_deref(), Some("ch=c1;tmp=t9"));
    }

    #[test]
    fn args_probe_falsifiable_no_domain_key() {
        // 可证伪对偶：args 无任一领域维 → None（不臆造束·保持纯壳两面落 unkeyed 仍可被 reducer 按面找）。
        let p = json!({"command": "im_health", "args": {"foo": 1}});
        assert_eq!(extract_corr_key(&p), None);
    }

    #[test]
    fn channels_view_falsifiable_empty_no_key() {
        // 可证伪对偶：channels 空数组 / 元素无 id → 不组 ch 键（不臆造束·保 None）。
        let empty = json!({"method": "POST", "url": "http://x/channels/view", "body": {"channels": []}});
        assert_eq!(extract_corr_key(&empty), None);
        let no_id = json!({"method": "POST", "url": "http://x/channels/view", "body": {"channels": [{"foo": 1}]}});
        assert_eq!(extract_corr_key(&no_id), None);
    }
}
