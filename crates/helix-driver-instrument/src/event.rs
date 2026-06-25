//! JSONL hop 事件 schema —— 自动修复 agent 的"眼睛"（CLAUDE.md §5）。
//!
//! 装饰器每跳吐一行 [`HopEvent`]；reducer 把同 `corr_key` 的四面聚成一束 + 与期望 diff，
//! 出「断在哪一跳」报告。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 四面契约里的"面"。
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

    if let Some(k) = probe(payload) {
        return Some(k);
    }
    if let Some(data) = payload.get("data") {
        if let Some(k) = probe(data) {
            return Some(k);
        }
    }
    // batch sync 出站（channels/load/increment）：channelId 嵌在 body.cursors[0]，
    // 顶层/`.data` 都抽不到 → 探 body.cursors[0] 取锚频道（UC-4.1 ① 与 per-channel
    // ② projection / ④ storage 同束的唯一 corr_key 来源；批次首元素代表本束）。
    if let Some(c0) = payload
        .get("body")
        .and_then(|b| b.get("cursors"))
        .and_then(|c| c.get(0))
    {
        if let Some(k) = probe(c0) {
            return Some(k);
        }
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
}
