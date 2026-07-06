//! Tauri `#[tauri::command]` 入口 —— 前端 invoke 收口（薄壳 → 引擎）。
//!
//! 命令把前端 camelCase 入参翻译成 helix-im 认的 snake_case `AppCommand` payload，
//! 经 `tick_tx` 喂同一条泵（与 WS 入站串行，零并发进 core）。**body 字段对齐
//! host-cli `cmd_parse::parse_send`**（`{channel_id, temporary_id, text}`）——即出站
//! HTTP `posts/create` 的真源（真机curl真源 §1）由 helix-im handle_send_message 兑现。

use bytes::Bytes;
use helix_core::tick::AppCommand;
use helix_core::Tick;
use helix_driver_instrument::TraceDirection;
use tauri::State;

use crate::state::AppState;
use crate::trace::normalize_trace_sidecar;

#[cfg(feature = "webdriver")]
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[cfg(feature = "webdriver")]
use helix_core::effect::HttpRequest;
#[cfg(feature = "webdriver")]
use helix_core::ports::HttpRequester;
#[cfg(feature = "webdriver")]
use helix_driver_host::{HostNetworkConfig, SharedHttpClient};
#[cfg(feature = "webdriver")]
use helix_driver_instrument::{Facet, Hop};

/// 把 JSON 值打包成 `Tick::Command`（payload = JSON bytes，由 helix-im ACL-1 解析）。
fn command(name: &'static str, payload: serde_json::Value) -> Tick {
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    Tick::Command(AppCommand::new(name, Bytes::from(bytes)))
}

fn send_payload(
    channel_id: String,
    text: String,
    temporary_id: String,
    msg_type: Option<String>,
) -> serde_json::Value {
    serde_json::json!({
        "channel_id": channel_id,
        "temporary_id": temporary_id,
        "text": text,
        "type": msg_type,
    })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImIdentityDto {
    user_id: String,
    team_id: String,
}

/// 当前主窗口身份（dev-local 默认 444）。前端只读展示/兜底作者名，不在壳内改登录态。
#[tauri::command]
pub fn im_identity(state: State<'_, AppState>) -> ImIdentityDto {
    ImIdentityDto {
        user_id: state.identity.user_id.clone(),
        team_id: state.identity.team_id.clone(),
    }
}

#[cfg(feature = "webdriver")]
fn l2_temp_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("l2debug{millis}")
}

#[cfg(feature = "webdriver")]
fn l2_actor(actor_user_id: Option<String>) -> String {
    match actor_user_id.as_deref().map(str::trim) {
        Some("444") => "444".to_string(),
        Some("678") => "678".to_string(),
        _ => "678".to_string(),
    }
}

#[cfg(feature = "webdriver")]
fn l2_api_base_dir(api_base: &str) -> String {
    let trimmed = api_base.trim();
    if trimmed.ends_with('/') {
        trimmed.to_string()
    } else {
        format!("{trimmed}/")
    }
}

#[cfg(feature = "webdriver")]
async fn l2_post(
    actor_user_id: &str,
    path: &str,
    body: serde_json::Value,
) -> Result<String, String> {
    let (_profile, cfg) = crate::config::load()?;
    let client = SharedHttpClient::new(
        HostNetworkConfig::new(l2_api_base_dir(&cfg.api_base), cfg.ws_url.clone())
            .with_timeout(Duration::from_secs(12))
            .with_user_agent("LoopForge-L2-Debug"),
    )
    .map_err(|e| format!("im_l2: HTTP client init failed: {e}"))?;
    let headers = client.headers();
    headers
        .set_header_sync("cookieId", actor_user_id)
        .map_err(|e| format!("im_l2: cookieId header failed: {e}"))?;
    headers
        .set_header_sync("companyId", &cfg.company_id)
        .map_err(|e| format!("im_l2: companyId header failed: {e}"))?;
    for (name, value) in [
        ("appType", "bct"),
        ("device", "IOS"),
        ("language", "zh"),
        ("content-type", "application/json"),
    ] {
        headers
            .set_header_sync(name, value)
            .map_err(|e| format!("im_l2: {name} header failed: {e}"))?;
    }

    let req = HttpRequest {
        method: "POST".to_string(),
        url: path.to_string(),
        headers: Vec::new(),
        body: Some(Bytes::from(
            serde_json::to_vec(&body).map_err(|e| format!("im_l2: encode body failed: {e}"))?,
        )),
    };
    let resp = client
        .request(req)
        .await
        .map_err(|e| format!("im_l2: POST {path} failed: {e}"))?;
    let text = String::from_utf8_lossy(&resp.body).into_owned();
    if !(200..300).contains(&resp.status) {
        return Err(format!("im_l2: POST {path} HTTP {}: {text}", resp.status));
    }
    Ok(text)
}

#[cfg(feature = "webdriver")]
fn l2_mentions(mention_user_id: Option<String>) -> Vec<String> {
    mention_user_id
        .filter(|v| !v.trim().is_empty())
        .map(|v| vec![v])
        .unwrap_or_default()
}

/// L2 debug: 以指定调试用户发消息，主窗口仍保持 444，靠后端 WS echo 验证多端联调。
#[cfg(feature = "webdriver")]
#[tauri::command]
pub async fn im_l2_send(
    state: State<'_, AppState>,
    channel_id: String,
    text: String,
    mention_user_id: Option<String>,
    actor_user_id: Option<String>,
) -> Result<String, String> {
    let ch = channel_id.trim();
    let msg = text.trim();
    if ch.is_empty() {
        return Err("im_l2_send: channelId 为空".into());
    }
    if msg.is_empty() {
        return Err("im_l2_send: text 为空".into());
    }
    let actor = l2_actor(actor_user_id);
    let tmp = l2_temp_id();
    let mentions = l2_mentions(mention_user_id);
    let team_id = state.identity.team_id.clone();
    let body = serde_json::json!({
        "viewers": ["all"],
        "message": msg,
        "mentions": mentions,
        "temporaryId": tmp,
        "type": "TEXT",
        "simpleMessage": msg,
        "channelId": ch,
        "userId": actor,
        "teamId": team_id.clone(),
        "userSnapshot": {
            "userId": actor,
            "teamId": team_id,
            "userName": actor,
        },
        "id": "",
        "props": {},
        "topicId": "",
        "revoke": false,
    });
    let mention_log = body
        .get("mentions")
        .cloned()
        .unwrap_or_else(|| serde_json::json!([]));
    state.ctx.log_ipc_in(
        "im_l2_send",
        serde_json::json!({
            "channelId": ch,
            "text": msg,
            "mentionUserId": mention_log,
            "actorUserId": actor,
            "temporaryId": tmp,
        }),
    );
    state.ctx.log(
        Facet::Outbound,
        Hop::HttpReq,
        serde_json::json!({
            "command": "im_l2_send",
            "url": "posts/create",
            "cookieId": actor,
            "body": body.clone(),
        }),
    );
    let result = l2_post(&actor, "posts/create", body).await;
    match &result {
        Ok(text) => state.ctx.log(
            Facet::WsRecv,
            Hop::HttpResp,
            serde_json::json!({
                "command": "im_l2_send",
                "status": "ok",
                "actorUserId": actor,
                "channelId": ch,
                "temporaryId": tmp,
                "body": serde_json::from_str::<serde_json::Value>(text)
                    .unwrap_or_else(|_| serde_json::json!(text)),
            }),
        ),
        Err(error) => state.ctx.log(
            Facet::WsRecv,
            Hop::HttpResp,
            serde_json::json!({
                "command": "im_l2_send",
                "status": "error",
                "actorUserId": actor,
                "channelId": ch,
                "temporaryId": tmp,
                "error": error,
            }),
        ),
    }
    result
}

/// L2 debug: 以指定调试用户标整个会话已读（channels/view）。
#[cfg(feature = "webdriver")]
#[tauri::command]
pub async fn im_l2_read_channel(
    channel_id: String,
    actor_user_id: Option<String>,
) -> Result<String, String> {
    let ch = channel_id.trim();
    if ch.is_empty() {
        return Err("im_l2_read_channel: channelId 为空".into());
    }
    let actor = l2_actor(actor_user_id);
    l2_post(
        &actor,
        "channels/view",
        serde_json::json!({ "channels": [{ "id": ch }] }),
    )
    .await
}

/// L2 debug: 以指定调试用户标单条消息已读。
#[cfg(feature = "webdriver")]
#[tauri::command]
pub async fn im_l2_read_post(
    channel_id: String,
    post_id: String,
    actor_user_id: Option<String>,
) -> Result<String, String> {
    let ch = channel_id.trim();
    let post = post_id.trim();
    if ch.is_empty() || post.is_empty() {
        return Err("im_l2_read_post: channelId/postId 为空".into());
    }
    let actor = l2_actor(actor_user_id);
    l2_post(
        &actor,
        "post/read",
        serde_json::json!({ "channelId": ch, "posts": [post] }),
    )
    .await
}

/// L2 debug: 以指定调试用户对一条消息发起加急，默认目标为主窗口当前 userId（444）。
#[cfg(feature = "webdriver")]
#[tauri::command]
pub async fn im_l2_urgent_post(
    state: State<'_, AppState>,
    channel_id: String,
    post_id: String,
    target_ids: Option<Vec<String>>,
    message: Option<String>,
    actor_user_id: Option<String>,
) -> Result<String, String> {
    let ch = channel_id.trim();
    let post = post_id.trim();
    if ch.is_empty() || post.is_empty() {
        return Err("im_l2_urgent_post: channelId/postId 为空".into());
    }
    let targets = target_ids
        .unwrap_or_else(|| vec![state.identity.user_id.clone()])
        .into_iter()
        .filter(|v| !v.trim().is_empty())
        .collect::<Vec<_>>();
    if targets.is_empty() {
        return Err("im_l2_urgent_post: targetIds 为空".into());
    }
    let mut body = serde_json::json!({
        "channelId": ch,
        "postId": post,
        "targetIds": targets,
    });
    if let Some(msg) = message.filter(|v| !v.trim().is_empty()) {
        body["message"] = serde_json::json!(msg);
    }
    let actor = l2_actor(actor_user_id);
    l2_post(&actor, "posts/urgentPost", body).await
}

#[cfg(all(test, feature = "webdriver"))]
mod tests {
    use super::{l2_actor, l2_api_base_dir};

    #[test]
    fn l2_actor_accepts_known_debug_users_and_defaults_to_678() {
        assert_eq!(l2_actor(None), "678");
        assert_eq!(l2_actor(Some("444".to_string())), "444");
        assert_eq!(l2_actor(Some("678".to_string())), "678");
        assert_eq!(l2_actor(Some("999".to_string())), "678");
    }

    #[test]
    fn l2_api_base_keeps_api_cses_as_directory() {
        assert_eq!(
            l2_api_base_dir("http://localhost:8066/api/cses"),
            "http://localhost:8066/api/cses/"
        );
        assert_eq!(
            l2_api_base_dir("http://localhost:8066/api/cses/"),
            "http://localhost:8066/api/cses/"
        );
    }
}

/// UC-send-1 出站发送：前端生成 `temporaryId` 乐观上屏后调本命令。
///
/// 入参 camelCase（Tauri 自动 snake↔camel）；内部转 snake_case 对齐 helix-im。
/// 不在此做业务（落库/出站 HTTP/echo 对账全在 helix-im handle_send_message），
/// 本命令只「翻译 + 入泵」——薄壳纪律。
#[tauri::command]
pub async fn im_send(
    state: State<'_, AppState>,
    channel_id: String,
    text: String,
    temporary_id: String,
    msg_type: Option<String>,
    __trace: Option<serde_json::Value>,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_send: channelId 为空".into());
    }
    if temporary_id.is_empty() {
        return Err("im_send: temporaryId 为空（薄壳须生成）".into());
    }
    // P0b ⓪ IpcIn tee（test-only·webdriver feature 闸·release --no-default-features 去掉）：落「壳
    // 收到的原始 invoke 入参」(pre-shaping)，与 Inbound（TeeTickSender 进引擎指令）配对量化 C013 纯壳
    // 不变量 IpcIn.args ≡ Inbound.args（reducer casing 归一后逐字段相等）。竖切 = UC-1.1 发消息。
    // msg_type 原值透传（None→null·不在此处默认）：让纯壳不变量诚实暴露「壳是否做了 type 默认 shaping」。
    #[cfg(feature = "webdriver")]
    state.ctx.log_ipc_in(
        "im_send",
        serde_json::json!({
            "channel_id": &channel_id,
            "text": &text,
            "temporary_id": &temporary_id,
            "type": &msg_type,
        }),
    );
    if let Some(raw_trace) = __trace.as_ref() {
        match normalize_trace_sidecar(raw_trace) {
            Ok(trace) => {
                state.ctx.trace_with_ids(
                    "pc.tauri.invoke.in",
                    "pc.tauri",
                    TraceDirection::In,
                    Some(trace.traceparent.as_str()),
                    serde_json::json!({
                        "cmd": "im_send",
                        "args": {
                            "channelId": &channel_id,
                            "text": &text,
                            "temporaryId": &temporary_id,
                            "type": &msg_type,
                            "__trace": trace,
                        }
                    }),
                );
                tracing::debug!(
                    traceparent = %trace.traceparent,
                    baggage_present = trace.baggage.is_some(),
                    "im_send trace sidecar accepted at IPC boundary"
                );
            }
            Err(error) => {
                tracing::warn!(
                    ?error,
                    "im_send trace sidecar ignored; business command continues"
                );
            }
        }
    }
    // type 原值透传（None→null·壳零默认 shaping·issue #53 C013 纯渲染壳）：默认 "TEXT" 由
    // helix 兜底——出站 send_build.rs（空→TEXT）+ 入站 parser.rs（空→TEXT）双端下沉。壳不补 type →
    // 纯壳不变量 IpcIn.args ≡ Inbound.args 成立（旧「壳补 TEXT 致 ipc-in.type=null ≠ inbound」已消除）。
    // DOCUMENT 等富媒体仍显式透传真值（UC-1.2·msg_type=Some("DOCUMENT")）。
    let tick = command(
        "im_send_message",
        send_payload(channel_id, text, temporary_id, msg_type),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_send: 入泵失败（泵已退出？）：{e}"))
}

#[cfg(feature = "webdriver")]
#[tauri::command]
pub fn trace_record_event(
    state: State<'_, AppState>,
    event: serde_json::Value,
) -> Result<(), String> {
    let name = event
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("pc.trace.event")
        .to_string();
    let layer = event
        .get("layer")
        .and_then(|v| v.as_str())
        .unwrap_or("pc.ui")
        .to_string();
    let direction = match event.get("direction").and_then(|v| v.as_str()) {
        Some("out") => TraceDirection::Out,
        Some("internal") => TraceDirection::Internal,
        _ => TraceDirection::In,
    };
    let traceparent = event
        .get("traceparent")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned);
    state
        .ctx
        .trace_with_ids(&name, &layer, direction, traceparent.as_deref(), event);
    Ok(())
}

#[cfg(test)]
mod command_tests {
    use super::send_payload;

    #[test]
    fn send_payload_never_contains_trace_sidecar() {
        let payload = send_payload(
            "c1".to_string(),
            "hello".to_string(),
            "tmp1".to_string(),
            Some("DOCUMENT".to_string()),
        );

        assert_eq!(
            payload.get("channel_id").and_then(|v| v.as_str()),
            Some("c1")
        );
        assert_eq!(
            payload.get("temporary_id").and_then(|v| v.as_str()),
            Some("tmp1")
        );
        assert_eq!(payload.get("text").and_then(|v| v.as_str()), Some("hello"));
        assert_eq!(
            payload.get("type").and_then(|v| v.as_str()),
            Some("DOCUMENT")
        );
        assert!(
            payload.get("__trace").is_none(),
            "__trace must stay outside Tick::Command business payload"
        );
    }

    #[test]
    fn send_payload_still_never_contains_trace_sidecar_after_trace_ingress() {
        let payload = send_payload(
            "c1".to_string(),
            "hello".to_string(),
            "tmp1".to_string(),
            Some("TEXT".to_string()),
        );
        assert!(payload.get("__trace").is_none());
    }
}

/// UC-1.5 撤回：前端传 `postId`（Tauri 自动 camel→snake 到 `post_id`）→ pump `im_revoke`
/// 命令，payload snake `{post_id}`（helix posts_existing.rs `require_str("post_id")`）→ helix
/// 兑现出站 `POST posts/revoke {postId}`（真机curl真源 §3）。薄壳只翻译入泵，不臆造 body。
#[tauri::command]
pub async fn im_revoke(state: State<'_, AppState>, post_id: String) -> Result<(), String> {
    if post_id.is_empty() {
        return Err("im_revoke: postId 为空".into());
    }
    let tick = command("im_revoke", serde_json::json!({ "post_id": post_id }));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_revoke: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.9 加急消息（阶段①）：前端传 `channelId` + `postId`（已发送消息 server id）+
/// `targetIds`（目标用户 server id 数组·非空）+ 可选 `message` → 本命令转 snake_case 入泵
/// `im_urgent_post`（helix-im `outbound/urgent.rs` `UrgentPostCommand` 校验后兑现出站
/// `POST posts/urgentPost {channelId, postId, targetIds, message?}`·全 camelCase·真机curl真源
/// §1-7 UrgentPostVO）。WS 回 `post_update`（加急标记）→ 投影 `im:post:updated` → DOM data-urgent=1。
///
/// 薄壳纪律：只翻译入参 + 入泵，body camelCase 化 + targetIds 非空校验全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_urgent_post(
    state: State<'_, AppState>,
    channel_id: String,
    post_id: String,
    target_ids: Vec<String>,
    message: Option<String>,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_urgent_post: channelId 为空".into());
    }
    if post_id.is_empty() {
        return Err("im_urgent_post: postId 为空".into());
    }
    if target_ids.is_empty() {
        return Err("im_urgent_post: targetIds 为空（须指定目标成员·后端 Validate 拒空）".into());
    }
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "post_id": post_id,
        "target_ids": target_ids,
    });
    if let Some(msg) = message.filter(|m| !m.is_empty()) {
        payload["message"] = serde_json::json!(msg);
    }
    let tick = command("im_urgent_post", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_urgent_post: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.9 确认收到加急（阶段②）：前端传 `postId` + `channelId` → 本命令转 snake_case 入泵
/// `im_urgent_confirm`（helix-im `outbound/urgent.rs` `UrgentConfirmCommand` 兑现出站
/// `POST posts/urgentConfirm {postId, channelId}`·camelCase·真机curl真源 §1-10）。WS 回
/// `post_update` → 投影 `im:post:updated`。薄壳只翻译入泵，body camelCase 化在 helix-im。
#[tauri::command]
pub async fn im_urgent_confirm(
    state: State<'_, AppState>,
    post_id: String,
    channel_id: String,
) -> Result<(), String> {
    if post_id.is_empty() {
        return Err("im_urgent_confirm: postId 为空".into());
    }
    if channel_id.is_empty() {
        return Err("im_urgent_confirm: channelId 为空".into());
    }
    let tick = command(
        "im_urgent_confirm",
        serde_json::json!({ "post_id": post_id, "channel_id": channel_id }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_urgent_confirm: 入泵失败（泵已退出？）：{e}"))
}

/// UC-3.2 单条已读：前端传 `postId`（被标记已读的消息 server id）+ `channelId` → 本命令转
/// snake_case 入泵 `im_post_read`（helix-im `outbound/posts_existing.rs` `PostReadCommand` 兑现出站
/// `POST post/read {channelId, posts:[postId]}`·posts 列表模式标单条·真机curl真源 partials/6 UC-3.2
/// + entity.PostRead.Posts `json:"posts,omitempty"`·post.go:527-536）。WS 回 `post_read`（type6，≤2 人）
/// → 投影 `im:post:read`（fat·含 readBits）→ message.read_bits 落库 + DOM data-read-bits 更新。
///
/// 薄壳纪律：只翻译入参 + 把 postId 包成 `posts:[postId]` 单元素数组（对齐 helix posts 列表模式
/// 标单条·非区间模式）+ 入泵，endpoint / camelCase 化 / 区间 vs 列表分支全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_mark_read(
    state: State<'_, AppState>,
    post_id: String,
    channel_id: String,
) -> Result<(), String> {
    if post_id.trim().is_empty() {
        return Err("im_mark_read: postId 为空（须指定被标记已读的消息 server id）".into());
    }
    if channel_id.trim().is_empty() {
        return Err("im_mark_read: channelId 为空".into());
    }
    // posts 列表模式标单条（UC-3.2）：单元素数组 → helix PostReadCommand 注入 wire `posts:[postId]`。
    let tick = command(
        "im_post_read",
        serde_json::json!({ "channel_id": channel_id, "posts": [post_id] }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_mark_read: 入泵失败（泵已退出？）：{e}"))
}

/// UC-3.1 会话已读：前端进/看会话 → 标整个会话已读 → 入泵 `im_channels_view`（helix-im
/// `outbound/channel_change_dedicated.rs` `ViewChannelsCommand`）→ 兑现出站
/// `POST channels/view {channels:[{id:channelId}]}`（fire-and-forget·无 HTTP 返回处理）。Go 写
/// `channelmembers.last_read_seq` → 多设备 echo `event_type=6` → 在线走 WS read echo → helix
/// 投影 `im:post:read`（fat·含 readBits）→ message.read_bits 单调覆盖落库 + DOM data-read-bits 更新。
/// 真源 full-map/partials/6--client-usecases.md:136-140（onChannelRead({channels:[{id}]})）。
///
/// **与 UC-3.2 `im_mark_read` 的区别**：3.2 走 `post/read` posts 列表模式标**单条**（{channelId,
/// posts:[postId]}）；3.1 走 `channels/view` **会话级**标整会话（{channels:[{id}]}）。不同 endpoint、
/// 不同 body 形态。注：纯 `post/read {channelId}` 被 Go 拒『post read is empty』（区间读须带
/// startTime/endTime 或 posts），故会话已读走 channels/view 而非 post/read。
///
/// 薄壳纪律：只翻译入参（channelId）→ 包成 `channels:[{id:channelId}]`（对齐 helix ViewChannelsCommand
/// 透传 channels 数组·元素键 camelCase id）+ 入泵 `im_channels_view`，endpoint / casing 全在 helix-im。
#[tauri::command]
pub async fn im_read_channel(state: State<'_, AppState>, channel_id: String) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_read_channel: channelId 为空".into());
    }
    // 会话级已读：channels 数组单元素 {id:channelId}（helix ViewChannelsCommand 透传·元素键 wire camelCase）。
    let tick = command(
        "im_channels_view",
        serde_json::json!({ "channels": [{ "id": channel_id }] }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_read_channel: 入泵失败（泵已退出？）：{e}"))
}

/// UC-4.2 按需 sync notify：触发引擎重连 → 重跑 hello 握手 → 重检 per-channel needSync gap →
/// 对落后频道（cursor 落后于 server high-water）自驱出站 `POST channel/sync/notify`，body
/// `{cursors:[{channelId, fromSeq}]}`（per-channel·真源 sync_http_effects.rs::sync_notify）→
/// server 回放离线区间事件 → helix-im 兑现 im:post:received（fat 增量行）+ im:channel:update-by-post
/// （瘦 badge 信号）+ message 落库 + channel_event_cursor 跳空洞。
///
/// 薄壳纪律：本命令无 payload（控制信号），入泵 helix-im 认的 `im_reconnect`（module.rs:304
/// emit `im:net:reconnect_requested` → driver 观察后重连 NativeTransport·连接生命周期归 driver）。
/// sync gap 检测 + sync/notify 出站全在 helix-im sans-IO 内核·壳不臆造 sync 逻辑。
#[tauri::command]
pub async fn im_sync_channels(state: State<'_, AppState>) -> Result<(), String> {
    // 无参控制信号：helix-im `im_reconnect` 分支 payload 无须解析（module.rs:304）。
    let tick = command("im_reconnect", serde_json::json!({}));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_sync_channels: 入泵失败（泵已退出？）：{e}"))
}

/// UC-3.3 模板已收到回执：前端传 `postId`（模板消息 server id）→ 本命令把它打包成
/// **camelCase** `{postId}` 入泵 `im_template_received`（helix-im `outbound/template_received.rs`
/// `TemplateReceivedCommand` 兑现出站 `POST post/templateReceived {postId}`·**`/post` 单数前缀**
/// 命名陷阱·真机curl真源 partials/6 UC-3.3 + posts.go:721 匿名 struct `{postId}`）。
///
/// ⚠️ **payload 键必须 camelCase `postId`**（非 snake `post_id`）：helix builder
/// `require_str(args, "postId")` 读 camel（template_received.rs:27·前端 message.service.ts:528 发
/// camel·bridge 字节透传不转 snake）。本壳发 snake `post_id` 会 `ImError::Parse` 永久失败——
/// 故本命令与其它 snake 命令不同·入泵 payload **保留 camelCase**（expect.bodyForbidden 锚 snake 泄漏）。
///
/// WS 回 `post_update`（EventKind::PostEdit·props.template.userIds 含 self）→ gate edit_content_op
/// patch message 行（保留本地 read_bits）→ 投影 `im:post:updated`（fat）→ DOM data-template-received。
/// 薄壳纪律：只翻译入参 + 入泵，endpoint / body 形态全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_template_received(
    state: State<'_, AppState>,
    post_id: String,
) -> Result<(), String> {
    if post_id.trim().is_empty() {
        return Err("im_template_received: postId 为空（须指定模板消息 server id）".into());
    }
    // payload 保留 camelCase postId（helix TemplateReceivedCommand 读 camel·snake 会 Parse 失败）。
    let tick = command(
        "im_template_received",
        serde_json::json!({ "postId": post_id }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_template_received: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.7 转发/合并转发：前端传 `posts`（待转发的 Post 对象数组·已从本地行构造）+ `channelIds`
/// （目标 channel 字符串数组·N≥1）→ 本命令转 snake_case 入泵 `im_create_posts`（helix-im
/// `outbound/posts_relay.rs` `CreatePostsCommand` 校验两数组非空后兑现出站
/// `POST posts/createPosts {posts, channelIds}`·全 camelCase·真机curl真源 附录A）。
///
/// 后端 App 层遍历 channelIds × posts 在每个目标 channel 建消息 → 逐 channel WS `post`（new_post）
/// echo → helix 投影 `im:post:received`（fat·各 channel 独立·channel_id/msg_id/event_seq 各异）→
/// 各目标 channel message 表落库 ×N。
///
/// 薄壳纪律：只翻译入参（posts 数组 + channel_ids 数组）+ 入泵，body camelCase 化（posts/channelIds）
/// + 两数组非空校验全在 helix-im（CreatePostsCommand `require_nonempty_array`），本壳不臆造 body。
/// posts 元素 = 前端从本地消息行构造的 Post 对象（透传·不在壳重组）。
#[tauri::command]
pub async fn im_relay_messages(
    state: State<'_, AppState>,
    posts: Vec<serde_json::Value>,
    channel_ids: Vec<String>,
) -> Result<(), String> {
    if posts.is_empty() {
        return Err("im_relay_messages: posts 为空（须指定待转发消息·非空数组）".into());
    }
    let targets: Vec<String> = channel_ids
        .into_iter()
        .filter(|c| !c.trim().is_empty())
        .collect();
    if targets.is_empty() {
        return Err("im_relay_messages: channelIds 为空（须指定目标频道·非空数组）".into());
    }
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_relay_messages: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    // **身份单一真源**：每个待转发 Post 对象补 userId（= 发送者·身份取自 identity·壳不臆造 creds）。
    // 关键：后端 postSender 消费者 `PrePostSend` 在 UserId=="" 时直接拒并 Ack-drop（user id is nil·
    // post_core.go），转发副本不带 userId 会被静默丢弃 → 目标频道无新消息（实测 createPosts 返
    // SUCCESS 但目标频道无落库/无投影）。故 Post 对象必须携 userId·与现网 sendRelayMessages 透传
    // 完整 Post 对象（含 userId）一致。createBy 缺省由后端 CreateCsesPost 从 userId 兜底。
    let enriched: Vec<serde_json::Value> = posts
        .into_iter()
        .map(|mut p| {
            if let serde_json::Value::Object(ref mut map) = p {
                map.entry("userId")
                    .or_insert_with(|| serde_json::json!(self_id));
            }
            p
        })
        .collect();
    // helix CreatePostsCommand 读 snake `posts` / `channel_ids`（require_nonempty_array），
    // 内部翻成 wire camelCase `{posts, channelIds}`。壳透传 posts 元素（前端已构造的 Post 对象·补 userId）。
    let tick = command(
        "im_create_posts",
        serde_json::json!({ "posts": enriched, "channel_ids": targets }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_relay_messages: 入泵失败（泵已退出？）：{e}"))
}

/// 会话列表 bootstrap：拉本地 `channel` 表 dialogList（helix emit `im:channels:projection`）。
///
/// 最简壳只靠增量流冒频道，而增量是严格 cursor delta——清/旧 DB 无新活动时拿不到 active
/// channel，send 族 UC 全卡。本命令低频按需 Scan 本地 channel 表（off hot-path），前端就绪后
/// 调一次设 activeChannel，为发送提供**决定性目标**（不依赖后端是否恰有新活动）。payload 可空
/// （全量拉），对齐 helix `build_dialog_list_query`（limit 缺省走默认）。
#[tauri::command]
pub async fn im_query_dialog_list(state: State<'_, AppState>) -> Result<(), String> {
    let tick = command("im_query_dialog_list", serde_json::json!({}));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_query_dialog_list: 入泵失败（泵已退出？）：{e}"))
}

/// UC-2.1 切群首屏（读族·纯本地 Scan·无 HTTP 出站）：前端切换频道时调一次，传 `channelId`
/// + 可选 `limit`（首屏条数）→ 本命令转 snake_case 入泵 `im_query_messages_by_channel`
/// （helix-im `query_dispatch` 吐 `Scan(message, filter=channel_id, order=create_at DESC)` +
/// 注册 MessageQuery corr 上下文；PortReply 回报后 `port_reply` emit `im:messages:query_result`
/// 投影·projection-schema §1 query::emit_message_query_result·外层 {channel_id, messages}）。
///
/// 薄壳纪律：只翻译入参 + 入泵；engine `build_message_query` 认 snake `channel_id`/`limit`，
/// 本壳不臆造 body。读族纯本地 Scan，不产 HTTP 出站（facet ① 为空·本 UC 仅 ②③④ 三面）。
#[tauri::command]
pub async fn im_query_messages_by_channel(
    state: State<'_, AppState>,
    channel_id: String,
    limit: Option<u32>,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_query_messages_by_channel: channelId 为空".into());
    }
    let mut payload = serde_json::json!({ "channel_id": channel_id });
    if let Some(l) = limit {
        payload["limit"] = serde_json::json!(l);
    }
    let tick = command("im_query_messages_by_channel", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_query_messages_by_channel: 入泵失败（泵已退出？）：{e}"))
}

/// UC-2.4 一级回复列表（读族 request-response）：前端传 `replyId`（回复链根 server postId）+
/// 可选分页 `pageNumber`/`pageSize` + 可选 `revoke` + `reqId`（前端 bridge 生成的关联 id）→
/// 本命令转 snake_case 入泵 `im_get_replies`（helix-im `outbound/posts_read.rs` `GetRepliesCommand`
/// 兑现出站 `POST posts/getReplies {replyId, pageNumber, pageSize, revoke?}`·全 camelCase·真机curl真源
/// partial 1 §15 GetPostOpts+ReplyId）。读族无 WS 回声：HTTP 200 响应体经 helix `read_relay::
/// emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵，body camelCase 化（replyId/pageNumber/pageSize）在 helix-im build，
/// 本壳不臆造 wire body；`req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_get_replies(
    state: State<'_, AppState>,
    reply_id: String,
    req_id: String,
    page_number: Option<i64>,
    page_size: Option<i64>,
    revoke: Option<bool>,
) -> Result<(), String> {
    if reply_id.is_empty() {
        return Err("im_get_replies: replyId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_get_replies: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let mut payload = serde_json::json!({
        "reply_id": reply_id,
        "req_id": req_id,
        "page_number": page_number.unwrap_or(0),
        "page_size": page_size.unwrap_or(20),
    });
    if let Some(rv) = revoke {
        payload["revoke"] = serde_json::json!(rv);
    }
    let tick = command("im_get_replies", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_get_replies: 入泵失败（泵已退出？）：{e}"))
}

/// UC-2.4 二级回复分支（读族 request-response）：前端传 `replyFirstLevelId`（一级回复 server postId）
/// + 可选分页 `pageNumber`/`pageSize` + 可选 `revoke` + `reqId` → 本命令转 snake_case 入泵
/// `im_get_reply_branch`（helix-im `GetReplyBranchCommand` 兑现出站 `POST posts/getReplyBranch
/// {replyFirstLevelId, pageNumber, pageSize, revoke?}`·全 camelCase·真机curl真源 partial 1 §16
/// GetPostOpts+ReplyFirstLevelId）。同 getReplies 走 `im:read:result{req_id, body}` 透传回灌。
///
/// 注：前端 UI 层翻页用 `offset` 概念（partial 6 §129 queryReplyBranchMessage），但**后端 wire**
/// body 是 `GetPostOpts.pageNumber`（partial 1 §16 嵌 PageOpts·posts.go:261）——offset 是 UI 表征·
/// pageNumber 是 wire 真相·壳/helix 出站发 pageNumber（page_body helper 实证）。
#[tauri::command]
pub async fn im_get_reply_branch(
    state: State<'_, AppState>,
    reply_first_level_id: String,
    req_id: String,
    page_number: Option<i64>,
    page_size: Option<i64>,
    revoke: Option<bool>,
) -> Result<(), String> {
    if reply_first_level_id.is_empty() {
        return Err("im_get_reply_branch: replyFirstLevelId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_get_reply_branch: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let mut payload = serde_json::json!({
        "reply_first_level_id": reply_first_level_id,
        "req_id": req_id,
        "page_number": page_number.unwrap_or(0),
        "page_size": page_size.unwrap_or(20),
    });
    if let Some(rv) = revoke {
        payload["revoke"] = serde_json::json!(rv);
    }
    let tick = command("im_get_reply_branch", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_get_reply_branch: 入泵失败（泵已退出？）：{e}"))
}

/// UC-6.4 成员快照/全量·分支 A（按 channelIds 拉成员·自愈）：前端传 `channelIds`（≥1·≤200）+
/// `reqId` → 本命令转 snake_case 入泵 `im_channels_members_by_ids`（helix-im `MembersByIdsCommand`
/// 兑现出站 `POST channels/member/byIds {channelIds:[]}`·全 camelCase·真源 partial 2 §5 内联
/// `{channelIds:[]string}`）。读族无 WS 回声：HTTP 200 响应体（map[channelId][]IdWithCompanyExt）经
/// helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵（channelIds 透传·body camelCase 化在 helix-im build）·本壳不臆造
/// wire body；`req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_members_by_ids(
    state: State<'_, AppState>,
    channel_ids: Vec<String>,
    req_id: String,
) -> Result<(), String> {
    if channel_ids.iter().all(|c| c.is_empty()) {
        return Err("im_members_by_ids: channelIds 为空（非空字符串数组·1..200）".into());
    }
    if channel_ids.len() > 200 {
        return Err("im_members_by_ids: channelIds 超 200（后端校验 len≤200）".into());
    }
    if req_id.is_empty() {
        return Err("im_members_by_ids: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({
        "channel_ids": channel_ids,
        "req_id": req_id,
    });
    let tick = command("im_channels_members_by_ids", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_members_by_ids: 入泵失败（泵已退出？）：{e}"))
}

/// UC-6.4 成员快照/全量·分支 B（时间范围成员快照）：前端传 `channelId` + `startTime`/`endTime`
/// （int64 毫秒·必填）+ `reqId` → 本命令转 snake_case 入泵 `im_channel_member_snapshot`（helix-im
/// `MemberSnapshotCommand` 兑现出站 `POST channel/member/snapshot {channelId, startTime, endTime}`·
/// 全 camelCase·真源 partial 2 §6 `entity.GetMembersSnapshotParam`·startTime/endTime int64）。同
/// byIds 走 `im:read:result{req_id, body}` 透传回灌（body=[]GetMembersSnapshotDto·透传不冻结）。
#[tauri::command]
pub async fn im_member_snapshot(
    state: State<'_, AppState>,
    channel_id: String,
    start_time: i64,
    end_time: i64,
    req_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_member_snapshot: channelId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_member_snapshot: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({
        "channel_id": channel_id,
        "start_time": start_time,
        "end_time": end_time,
        "req_id": req_id,
    });
    let tick = command("im_channel_member_snapshot", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_member_snapshot: 入泵失败（泵已退出？）：{e}"))
}

/// UC-4.5 陌生 channel 兜底（进入未加载过的频道触发单频道增量同步）：前端传 `channelId` + `reqId`
/// → 本命令转 snake_case 入泵 `im_channel_load_increment_by_channel_id`（helix-im `outbound/channel_read.rs`
/// `LoadIncrementByChannelIdCommand` 兑现出站 `POST channel/load/incrementByChannelId {channelId}`·
/// 真源内联 `{channelId}`·全 camelCase·partial 8 §2 / http.rs:47）。读族注册（`is_read=true`·HTTP
/// 直返单条 *IncrementChannel·不推送）：HTTP 200 响应体经 helix `read_relay::emit_read_result` 透传
/// 回灌 `im:read:result{req_id, body}`（projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵（channelId 透传·body camelCase 化在 helix-im build）·本壳不臆造
/// wire body；`req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_ensure_channel_loaded(
    state: State<'_, AppState>,
    channel_id: String,
    req_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_ensure_channel_loaded: channelId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_ensure_channel_loaded: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({
        "channel_id": channel_id,
        "req_id": req_id,
    });
    let tick = command("im_channel_load_increment_by_channel_id", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_ensure_channel_loaded: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.8 条件查频道（条件分页查询）：前端传 `condition`（object·频道查询条件 map·已 camelCase·
/// 平铺进顶层 wire body·空则不带条件字段）+ 分页 `pageNumber`/`pageSize`/`offset`（i64·缺省 0）+
/// `reqId` → 本命令转 snake_case 入泵 `im_channel_query`（helix-im `outbound/channel_read.rs`
/// `ChannelQueryCommand` 兑现出站 `POST channel/query`·真源 partial 2 §2 内联匿名 struct
/// {entity.Channel; entity.PageOpts} 同层 merge·全 camelCase）。读族注册（`is_read=true`）：HTTP 200
/// 响应体经 helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`
/// （projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵（condition 透传·不臆造条件字段·body camelCase 化由前端构造）·
/// `req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_channel_query(
    state: State<'_, AppState>,
    condition: serde_json::Value,
    page_number: Option<i64>,
    page_size: Option<i64>,
    offset: Option<i64>,
    req_id: String,
) -> Result<(), String> {
    if req_id.is_empty() {
        return Err("im_channel_query: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    // condition 必须是 object（平铺进顶层 wire body）；缺省空对象（仅带分页字段）。
    let condition = match condition {
        serde_json::Value::Object(_) => condition,
        serde_json::Value::Null => serde_json::json!({}),
        _ => return Err("im_channel_query: condition 必须是 object（频道查询条件 map）".into()),
    };
    let payload = serde_json::json!({
        "condition": condition,
        "page_number": page_number.unwrap_or(0),
        "page_size": page_size.unwrap_or(0),
        "offset": offset.unwrap_or(0),
        "req_id": req_id,
    });
    let tick = command("im_channel_query", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_query: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.7 频道成员在线状态（批量查在线）：前端传 `channelIds`（≥1 真频道 id 字符串数组）+ `reqId`
/// → 本命令转 snake_case 入泵 `im_channel_online_status`（helix-im `outbound/channel_read.rs`
/// `ChannelOnlineStatusCommand` 兑现出站 `POST channel/onlineStatus`·真源 partial 2 §28 内联匿名
/// struct `{ChannelIds []string \`json:"channelIds"\`}`·全 camelCase·data=[]ChannelOnlineStatusGroup·
/// 无 WS 回声）。读族注册（`is_read=true`）：HTTP 200 响应体经 helix `read_relay::emit_read_result`
/// 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2·body 透传不冻结）。
///
/// 薄壳纪律：只翻译入参 + 入泵（channelIds 透传·body camelCase 化在 helix-im build）·本壳不臆造
/// wire body；`req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_channel_online_status(
    state: State<'_, AppState>,
    channel_ids: Vec<String>,
    req_id: String,
) -> Result<(), String> {
    if channel_ids.iter().all(|c| c.is_empty()) {
        return Err("im_channel_online_status: channelIds 为空（非空字符串数组·≥1）".into());
    }
    if req_id.is_empty() {
        return Err("im_channel_online_status: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({
        "channel_ids": channel_ids,
        "req_id": req_id,
    });
    let tick = command("im_channel_online_status", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_online_status: 入泵失败（泵已退出？）：{e}"))
}

/// UC-10.3 获取全部功能模块（拉会话分组模块）：前端仅传 `reqId` → 本命令转 snake_case 入泵
/// `im_get_all_modules`（helix-im `outbound/user_misc.rs` `GetAllModulesCommand` 兑现出站
/// `POST modules/getAll`·真源 partial 3 §8 / modules.go:14 **不解析请求体** → 出站 wire body 为空
/// `{}`·无字段·全 camelCase 约定）。读族注册（`is_read=true`）：HTTP 200 响应体经 helix
/// `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（projection-schema §1.2·
/// body = dto.CommonRes 信封 data=[]*ent.Modules 原样透传）。
///
/// 薄壳纪律：只翻译入参 + 入泵（无 body·不臆造分页/condition 等字段）·`req_id` 经 payload 透传
/// （helix `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_modules_get_all(state: State<'_, AppState>, req_id: String) -> Result<(), String> {
    if req_id.is_empty() {
        return Err("im_modules_get_all: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    // modules/getAll 无请求结构（handler 不解析 body）→ 出站 wire body 为空·仅透传 req_id 锚回灌。
    let payload = serde_json::json!({
        "req_id": req_id,
    });
    let tick = command("im_get_all_modules", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_modules_get_all: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6r 公告·接受列表（读族 request-response）：前端传 `postId`（公告消息 server id）+ `reqId`
/// → 本命令转 snake_case 入泵 `im_announcement_accept_list`（helix-im `outbound/posts_read_ext.rs`
/// `im_announcement_accept_list`·`is_read=true` 兑现出站 `POST post/announcement/acceptList {postId}`·
/// **`/post` 单数前缀**·全 camelCase·真源 partial 1 §28 `{postId string}`）。读族无 WS 回声：HTTP 200
/// 响应体（公告接受记录列表）经 helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id,
/// body}`（projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵（postId 透传·body camelCase 化在 helix-im build·`req_id` 经 payload
/// 透传供 `module::read_req_id` 抠出注册回灌上下文·非 wire 字段不泄漏进出站 body）·本壳不臆造。
#[tauri::command]
pub async fn im_announcement_accept_list(
    state: State<'_, AppState>,
    post_id: String,
    req_id: String,
) -> Result<(), String> {
    if post_id.is_empty() {
        return Err("im_announcement_accept_list: postId 为空".into());
    }
    if req_id.is_empty() {
        return Err(
            "im_announcement_accept_list: reqId 为空（前端 bridge 须生成·回灌关联）".into(),
        );
    }
    let payload = serde_json::json!({
        "post_id": post_id,
        "req_id": req_id,
    });
    let tick = command("im_announcement_accept_list", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_accept_list: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6r 公告·列表查询（读族 request-response）：前端传 `channelId`（目标频道）+ 可选 `postId`
/// （ChannelId 空时 server 回退用 postId 当 channelID）+ `reqId` → 本命令转 snake_case 入泵
/// `im_announcement_list`（helix-im `posts_read_ext.rs` `im_announcement_list`·`is_read=true` 兑现出站
/// `POST post/announcement/list {channelId[, postId]}`·全 camelCase·真源 partial 1 §30
/// `{channelId string, postId string}`）。读族无 WS 回声：HTTP 200 响应体（公告列表）经
/// `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。
///
/// 薄壳纪律：只翻译入参 + 入泵·body camelCase 化在 helix-im build·本壳不臆造。
#[tauri::command]
pub async fn im_announcement_list(
    state: State<'_, AppState>,
    channel_id: String,
    req_id: String,
    post_id: Option<String>,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_announcement_list: channelId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_announcement_list: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "req_id": req_id,
    });
    if let Some(pid) = post_id.filter(|p| !p.is_empty()) {
        payload["post_id"] = serde_json::json!(pid);
    }
    let tick = command("im_announcement_list", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_list: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6r 公告·详情（读族 request-response）：前端传 `postIds`（公告 server id 数组）+ `reqId` →
/// 本命令转 snake_case 入泵 `im_announcement_detail`（helix-im `posts_read_ext.rs`
/// `im_announcement_detail`·`is_read=true` 兑现出站 `POST post/announcement/detail {postIds:[]}`·全
/// camelCase·真源 partial 1 §31 `{postIds []string}`）。读族无 WS 回声：HTTP 200 响应体（公告表行）经
/// `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。
///
/// 薄壳纪律：只翻译入参 + 入泵·body camelCase 化在 helix-im build·本壳不臆造。
#[tauri::command]
pub async fn im_announcement_detail(
    state: State<'_, AppState>,
    post_ids: Vec<String>,
    req_id: String,
) -> Result<(), String> {
    if post_ids.iter().all(|p| p.is_empty()) {
        return Err("im_announcement_detail: postIds 为空（非空字符串数组）".into());
    }
    if req_id.is_empty() {
        return Err("im_announcement_detail: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({
        "post_ids": post_ids,
        "req_id": req_id,
    });
    let tick = command("im_announcement_detail", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_detail: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6w 公告·保存（写族 WS post_update 回声）：前端传 `channelId` + `type`（消息类型·go 仅校验
/// 非空）+ `message`（公告正文）→ 本命令补 `userId`（AppState.identity·身份单一真源·壳不臆造 creds·
/// go `PrePostSend` 在 UserId=="" 拒并 Ack-drop）→ 打包 **camelCase** `{channelId, type, message,
/// userId}` 入泵 `im_announcement_save`（helix-im `outbound/posts_announcement.rs`
/// `AnnouncementSaveCommand`·后端要完整 Post → build = 整个 args **透传**·不裁字段 → 出站
/// `POST post/announcement/save`·真源 partial 1 §26 + 9--gap-posts §26）。
///
/// ⚠️ **payload 键必须 camelCase**（非 snake）：helix save build 直 `args.clone()` 当 wire body·壳发
/// snake 会让出站 body snake 化 → expect.bodyForbidden 锚 `channel_id`/`user_id` 即 ① 红。故本命令
/// 在壳内重建 camelCase Post（同 im_template_received camelCase 例外）。`type` 是 Rust 关键字·用
/// 原始标识符 `r#type` 接收（Tauri 2 macro `.unraw()` → JS 键 `type`·tauri-macros wrapper.rs:440）。
///
/// WS 回 `post_update`（按 channelId 广播·EventKind::PostEdit）→ 投影 `im:post:updated`（fat）→
/// edit_content_op patch message 行（保留本地 read_bits）。**⛔ 当前阻于后端 WS 业务广播链（切 cses-im-server 后待复验）·
/// ① 出站经 cses-im-server 可真跑·②④ 待复验**。薄壳纪律：只翻译入参 + 补身份 + 入泵·endpoint
/// 全在 helix-im·本壳不臆造 body。
#[tauri::command]
pub async fn im_announcement_save(
    state: State<'_, AppState>,
    channel_id: String,
    r#type: String,
    message: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_announcement_save: channelId 为空".into());
    }
    if r#type.trim().is_empty() {
        return Err("im_announcement_save: type 为空（go 校验消息类型非空）".into());
    }
    let user_id = state.identity.user_id.clone();
    if user_id.is_empty() {
        return Err("im_announcement_save: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    // payload 保留 camelCase（helix AnnouncementSaveCommand 直 args.clone() 当 wire body·snake 会污染
    // 出站·expect.bodyForbidden 锚 snake 泄漏）。补 userId（身份单一真源·go PrePostSend 拒空 UserId）。
    let payload = serde_json::json!({
        "channelId": channel_id,
        "type": r#type,
        "message": message,
        "userId": user_id,
    });
    let tick = command("im_announcement_save", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_save: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6w 公告·确认收到（写族 WS post_update 回声）：前端传 `postId`（公告消息 server id）+
/// `channelId` → 本命令转 snake_case 入泵 `im_announcement_read`（helix-im `posts_announcement.rs`
/// `AnnouncementReadCommand`·读 snake `post_id`/`channel_id` → 翻 camel 兑现出站
/// `POST post/announcement/read {postId, channelId}`·真源 partial 1 §27 verbatim `{PostId json:postId,
/// ChannelId json:channelId}`）。
///
/// WS 回 `post_update`（co-tx + 按 channelId 广播·EventKind::PostEdit）→ 投影 `im:post:updated`（fat）→
/// edit_content_op patch message 行。**⛔ 当前阻于后端 WS 业务广播链（切 cses-im-server 后待复验）·① 出站经 cses-im-server 可真跑·②④ 待复验**。
/// 薄壳纪律：只翻译入参 + 入泵·endpoint/casing 全在 helix-im·本壳不臆造。
#[tauri::command]
pub async fn im_announcement_read(
    state: State<'_, AppState>,
    post_id: String,
    channel_id: String,
) -> Result<(), String> {
    if post_id.is_empty() {
        return Err("im_announcement_read: postId 为空".into());
    }
    if channel_id.is_empty() {
        return Err("im_announcement_read: channelId 为空".into());
    }
    let payload = serde_json::json!({
        "post_id": post_id,
        "channel_id": channel_id,
    });
    let tick = command("im_announcement_read", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_read: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.6w 公告·删除（写族 WS post_update 回声）：前端传 `postIds`（待删公告 server id 数组）→ 本命令
/// 转 snake_case 入泵 `im_announcement_delete`（helix-im `posts_announcement.rs`
/// `AnnouncementDeleteCommand`·读 snake `post_ids` → 兑现出站 `POST post/announcement/delete {postIds,
/// postId}` **两字段同值数组**·兼容后端单/复数命名差异·真源 partial 1 §29 verbatim `{PostIds []string
/// json:postIds}`）。
///
/// WS 回 `post_update`（gap §69 announcement* → post_update ✅·删除过期公告广播）→ 投影
/// `im:post:updated`（fat）→ edit_content_op patch message 行。**⛔ 当前阻于后端 WS 业务广播链（切 cses-im-server 后待复验）·① 出站经
/// cses-im-server 可真跑·②④ 待复验**。薄壳纪律：只翻译入参 + 入泵·body 双字段成形全在 helix-im·本壳不臆造。
#[tauri::command]
pub async fn im_announcement_delete(
    state: State<'_, AppState>,
    post_ids: Vec<String>,
) -> Result<(), String> {
    if post_ids.iter().all(|p| p.is_empty()) {
        return Err("im_announcement_delete: postIds 为空（非空字符串数组）".into());
    }
    let payload = serde_json::json!({
        "post_ids": post_ids,
    });
    let tick = command("im_announcement_delete", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_announcement_delete: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.5b 消息置顶（写族 WS post_pin 回声）：前端传 `channelId`（目标频道）+ `postId`（被置顶消息
/// server id）→ 本命令转 snake_case 入泵 helix-im `im_set_message_top`（`outbound/channel_pinned.rs`
/// `SetMessageTopCommand`·读 snake `channel_id`/`post_id` → 翻 camel 兑现出站
/// `POST channel/add/postPinned {channelId, postId}`·全 camelCase·真源 partial 2 §21
/// `command.ChannelPostPinnedCommand{Id,ChannelId,PostId}`·helix 仅发 channelId+postId 两键·Id 由
/// handler 侧覆盖不在出站体）。
///
/// 注：loopforge 命令名 `im_post_pin`（task/spec 命名）→ 接 helix 既有 `im_set_message_top` build
/// （endpoint channel/add/postPinned·同一出站契约·见 uc-5.5b.expect.json `_note`）。
///
/// WS 回 `post_pin`（cses_channel.go:1840 NewWebSocketEvent(WebsocketEventPostPin)·broadcast channelId·
/// payload=pinned post 信息）→ 实现 phase 经 emit_post_updated 投出 `im:post:updated`（pinned 态·
/// post-targeted sid 锚·用户拍板 2026-06-26）→ patch message 行 pinned 态 + DOM data-pinned。**⛔ 当前
/// 阻于后端 WS 业务广播链（切 cses-im-server 后待复验）·① 出站经 cses-im-server 可真跑·②③④ 待复验**。薄壳纪律：只翻译入参
/// + 入泵·endpoint/casing 全在 helix-im·本壳不臆造。
#[tauri::command]
pub async fn im_post_pin(
    state: State<'_, AppState>,
    channel_id: String,
    post_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_post_pin: channelId 为空".into());
    }
    if post_id.is_empty() {
        return Err("im_post_pin: postId 为空（须指定被置顶消息 server id）".into());
    }
    let payload = serde_json::json!({
        "channel_id": channel_id,
        "post_id": post_id,
    });
    let tick = command("im_set_message_top", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_post_pin: 入泵失败（泵已退出？）：{e}"))
}

/// UC-9.x 书签·收藏消息：前端传 `channelId` + `postIds`（被收藏消息 server_id 列表）+ `reqId`
/// → 本命令补 `userId`（取自 AppState.identity·身份单一真源·壳不臆造 creds）→ 转 snake_case
/// 入泵 helix-im `im_bookmark_create`（`BookmarkCreateCommand` 兑现出站 `POST post/bookmark/create`
/// body `{channelId, userId, postIds:[]}`·全 camelCase·真源 partial 1 §33 `createPostBookmark`
/// L55-59）。读族注册（`is_read=true`）：HTTP 200 响应体经 helix `query::emit_read_result` 透传回灌
/// `im:read:result{req_id, body}`（projection-schema §1.2）。`req_id` 经 payload 透传（helix
/// `module::read_req_id` 抠出注册回灌上下文）。
#[tauri::command]
pub async fn im_bookmark_create(
    state: State<'_, AppState>,
    channel_id: String,
    post_ids: Vec<String>,
    req_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_bookmark_create: channelId 为空".into());
    }
    if post_ids.iter().all(|p| p.is_empty()) {
        return Err("im_bookmark_create: postIds 为空（非空字符串数组）".into());
    }
    if req_id.is_empty() {
        return Err("im_bookmark_create: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let user_id = state.identity.user_id.clone();
    if user_id.is_empty() {
        return Err("im_bookmark_create: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    let payload = serde_json::json!({
        "channel_id": channel_id,
        "user_id": user_id,
        "post_ids": post_ids,
        "req_id": req_id,
    });
    let tick = command("im_bookmark_create", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_bookmark_create: 入泵失败（泵已退出？）：{e}"))
}

/// UC-9.x 书签·取消收藏：前端传 `postId`（被取消的消息 server_id）+ `reqId` → 本命令补 `userId`
/// （AppState.identity）→ 入泵 helix-im `im_bookmark_delete`（`BookmarkDeleteCommand` 兑现出站
/// `POST post/bookmark/delete` body `{userId, postId}`·真源 partial 1 §34 `deletePostBookmark`
/// L37-40）。同 create 走 `im:read:result{req_id, body}` 透传回灌。
#[tauri::command]
pub async fn im_bookmark_delete(
    state: State<'_, AppState>,
    post_id: String,
    req_id: String,
) -> Result<(), String> {
    if post_id.is_empty() {
        return Err("im_bookmark_delete: postId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_bookmark_delete: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let user_id = state.identity.user_id.clone();
    if user_id.is_empty() {
        return Err("im_bookmark_delete: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    let payload = serde_json::json!({
        "user_id": user_id,
        "post_id": post_id,
        "req_id": req_id,
    });
    let tick = command("im_bookmark_delete", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_bookmark_delete: 入泵失败（泵已退出？）：{e}"))
}

/// UC-9.x 书签·加载收藏列表：前端传 `channelId` + 可选 `pageSize`/`pageNumber`/`offset`（分页）+
/// `reqId` → 本命令补 `userId`（AppState.identity）→ 入泵 helix-im `im_bookmark_load`
/// （`BookmarkLoadCommand` 兑现出站 `POST post/bookmark/load` body `{channelId, userId} + 扁平
/// PageOpts`·真源 partial 1 §35 `loadPostBookmark` L18-22 内嵌 `entity.PageOpts`）。响应体（收藏
/// 消息列表）经 `query::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。
#[tauri::command]
pub async fn im_bookmark_load(
    state: State<'_, AppState>,
    channel_id: String,
    page_size: Option<i64>,
    page_number: Option<i64>,
    offset: Option<i64>,
    req_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_bookmark_load: channelId 为空".into());
    }
    if req_id.is_empty() {
        return Err("im_bookmark_load: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let user_id = state.identity.user_id.clone();
    if user_id.is_empty() {
        return Err("im_bookmark_load: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    let mut payload = serde_json::Map::new();
    payload.insert("channel_id".into(), serde_json::json!(channel_id));
    payload.insert("user_id".into(), serde_json::json!(user_id));
    payload.insert("req_id".into(), serde_json::json!(req_id));
    if let Some(v) = page_size {
        payload.insert("page_size".into(), serde_json::json!(v));
    }
    if let Some(v) = page_number {
        payload.insert("page_number".into(), serde_json::json!(v));
    }
    if let Some(v) = offset {
        payload.insert("offset".into(), serde_json::json!(v));
    }
    let tick = command("im_bookmark_load", serde_json::Value::Object(payload));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_bookmark_load: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.1 创建群聊：前端传 `displayName` + `memberIds`（其他成员真实 userId 列表）→ 本命令把
/// 身份（`teamId`/`selfId`）+ 结构化列表入泵 `im_create_channel`，wire body 成形 + role 业务赋值
/// （self CREATOR + 他人 MEMBER）由 helix-im `CreateChannelCommand` 兑现出站
/// `POST /api/cses/channel/create`（形态锚真源 §4）。
///
/// 身份单一真源：`teamId` / 自身 `userId` 取自 AppState.identity（profile companyId / cookieId），
/// **不在前端 TS 硬编 creds**（守 src-tauri 纪律 5）。薄壳纪律：只翻译入参 + 解析身份 + 入泵结构化
/// args（`{display_name, team_id, self_id, member_ids}`），body camelCase 化 + role 赋值全在 helix-im。
#[tauri::command]
pub async fn im_create_channel(
    state: State<'_, AppState>,
    display_name: String,
    member_ids: Vec<String>,
) -> Result<(), String> {
    if display_name.trim().is_empty() {
        return Err("im_create_channel: displayName 为空".into());
    }
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_create_channel: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    let tick = command(
        "im_create_channel",
        serde_json::json!({
            "display_name": display_name,
            "team_id": state.identity.team_id.clone(),
            "self_id": self_id,
            "member_ids": member_ids,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_create_channel: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.2 创建话题（消息转话题）：前端传 `rootId`（话题挂载的根群 channelId）+ `postId`
/// （被转成话题的消息 server id）+ `displayName` + `memberIds`（其他成员真实 userId）→ 本命令把
/// 身份 + 结构化列表入泵 `im_make_topic`，wire body 成形 + role 业务赋值由 helix-im
/// `MakeTopicCommand` 兑现出站 `POST /api/cses/posts/makeTopic`（形态锚真源 §2·type=T 话题）。
///
/// `teamId` / 自身 `userId` 取自 AppState.identity（profile companyId / cookieId）·身份单一真源·壳不
/// 臆造 creds。WS 回 `channel_created`（话题=新 channel）+ `post_update`（原消息挂 topicId）。薄壳
/// 纪律：只翻译入参 + 解析身份 + 入泵结构化 args（`{root_id, post_id, display_name, team_id,
/// self_id, member_ids}`），body camelCase 化 + role 赋值全在 helix-im。
#[tauri::command]
pub async fn im_make_topic(
    state: State<'_, AppState>,
    root_id: String,
    post_id: String,
    display_name: String,
    member_ids: Vec<String>,
) -> Result<(), String> {
    if root_id.trim().is_empty() {
        return Err("im_make_topic: rootId 为空（话题须挂根群 channelId）".into());
    }
    if post_id.trim().is_empty() {
        return Err("im_make_topic: postId 为空（须指定被转话题的消息 server id）".into());
    }
    if display_name.trim().is_empty() {
        return Err("im_make_topic: displayName 为空".into());
    }
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_make_topic: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    let tick = command(
        "im_make_topic",
        serde_json::json!({
            "root_id": root_id,
            "post_id": post_id,
            "display_name": display_name,
            "team_id": state.identity.team_id.clone(),
            "self_id": self_id,
            "member_ids": member_ids,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_make_topic: 入泵失败（泵已退出？）：{e}"))
}

/// UC-11.1 维护公司大群：前端传 `displayName` + `memberIds`（公司大群成员真实 userId 列表）→ 本命令
/// 把身份 + 结构化列表入泵 `im_team_upsert`，`CreateChannelSpecifyOwner` team 对象成形 + role/owner
/// 业务赋值（self CREATOR + 他人 MEMBER）由 helix-im `TeamUpsertCommand` 兑现出站
/// `POST /api/cses/teams/upsert`（真源 partials/3 §4·非 team 表·只维护公司大群）。
///
/// **建群路径**（`id` 缺/空 → server `UpsertTeam` 走 `CreateCsesChannel`）：WS 回 `channel_created`
/// + `channel_member_update` → helix 投影 `im:channel:created` → ③ CL 新行 + ④ channel 表新行。helix-im
/// 不携 `id` → server 必走建群分支（避开现网 ID!="" 二次 decode io.Reader 已耗尽 bug·真源 §4 注记）。
///
/// 身份单一真源：`teamId` / 自身 `userId` 取自 AppState.identity（profile companyId / cookieId）·**不在
/// 前端 TS 硬编 creds**（守 src-tauri 纪律 5）。teams/* 走 `rejectPersonalUser`·dev-local profile 为公司
/// 用户·非 personal·不触 403。薄壳纪律：只翻译入参 + 解析身份 + 入泵结构化 args（`{display_name,
/// team_id, self_id, member_ids}`），team 对象 camelCase 化 + owner/role 赋值全在 helix-im。
#[tauri::command]
pub async fn im_team_upsert(
    state: State<'_, AppState>,
    display_name: String,
    member_ids: Vec<String>,
) -> Result<(), String> {
    if display_name.trim().is_empty() {
        return Err("im_team_upsert: displayName 为空".into());
    }
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_team_upsert: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    let tick = command(
        "im_team_upsert",
        serde_json::json!({
            "display_name": display_name,
            "team_id": state.identity.team_id.clone(),
            "self_id": self_id,
            "member_ids": member_ids,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_team_upsert: 入泵失败（泵已退出？）：{e}"))
}

/// UC-11.2 退出公司：退出当前 team 下所有 channel。身份单一真源——`user_id`（自身 cookieId）+
/// `team_id`（companyId）取自 AppState.identity（**不在前端 TS 硬编 creds**·守 src-tauri 纪律 5）→
/// 转 snake_case 入泵 `im_team_quit`（helix-im `TeamQuitCommand`·`outbound/user_misc.rs`·真源
/// QuitTeamReq{userId,teamId}·quit_team.go:3-6）兑现出站 `DELETE /api/cses/teams/member/quit`
/// （registry method=DELETE·body `{userId, teamId}` 仍带·现网 Methods("DELETE") 且 body 透传）。
///
/// **成功无响应体**（现网源 bug·helix 透传·partials/3 §6）。服务端 `LeaveAllChannelsForTeam` 单 tx
/// 退所有群 + 推 WS `quit_company`（`{channels:[]ChannelMemberMinimal}`·多播受影响 userIds·含自身）。
/// helix `quit_company` handler 对齐真源 graceful no-op（router 默认 vec![]·无独立投影/落库副作用）；
/// 离群本地态由配套 `channel_close` / `channel_member_update` 覆盖（见 quit_company.rs 注记）。
///
/// 薄壳纪律：只翻译身份 + 入泵；出站 endpoint/method/body camelCase 化全在 helix-im·本壳不臆造 body。
#[tauri::command]
pub async fn im_team_quit(state: State<'_, AppState>) -> Result<(), String> {
    let team_id = state.identity.team_id.clone();
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_team_quit: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    // helix TeamQuitCommand require_str(user_id) + require_str(team_id)（snake_case 入泵）。
    let tick = command(
        "im_team_quit",
        serde_json::json!({ "user_id": self_id, "team_id": team_id }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_team_quit: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.4 群属性修改（改群名）：前端传 `channelId`（目标频道）+ `displayName`（新群名）→ 转
/// snake_case 入泵 `im_channel_change_display_name`（helix-im `outbound/channel_change_dedicated.rs`
/// `ChangeDisplayNameCommand` 兑现出站 `POST channel/change/displayName {id, displayName}`·全
/// camelCase·真机curl真源 partials/6 UC-5.4）。
///
/// WS 回 `update_channel`（path2 PATCH·collect_present 收 displayName 列）→ ④ channel 表 PATCH
/// + ② `im:channel:update`（thin·{channel_id}·increment_channel_end 批次结束触发）→ ③ DOM
/// data-channel-display-name 回读。薄壳纪律：只翻译入参 + 入泵，body camelCase 化 + endpoint
/// 全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_channel_change_display_name(
    state: State<'_, AppState>,
    channel_id: String,
    display_name: String,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_change_display_name: channelId 为空".into());
    }
    if display_name.trim().is_empty() {
        return Err("im_channel_change_display_name: displayName 为空（改名须非空）".into());
    }
    let tick = command(
        "im_channel_change_display_name",
        serde_json::json!({
            "channel_id": channel_id,
            "display_name": display_name,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_change_display_name: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.4 群属性修改（改公告）：前端传 `channelId`（目标频道）+ `noticeText`（公告文本）→ 本命令
/// 把文本包成 helix 认的 `notice` map（`{text}`·真源 `command.ChangeChannelNotice.notice` 是
/// `*map[string]any`）转 snake_case 入泵 `im_channel_change_notice`（helix-im
/// `outbound/channel_change.rs` `ChangeNoticeCommand` 兑现出站 `POST channel/change/notice
/// {id, notice}`·真机curl真源 partials/6 UC-5.4）。
///
/// WS 回 `update_channel`/`update_channel_notice`（notice 列 PATCH）→ ④ channel 表 PATCH +
/// ② `im:channel:update`（thin）→ ③ DOM data-channel-notice 回读。薄壳纪律：只翻译入参 + 包
/// notice map + 入泵，endpoint 全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_channel_change_notice(
    state: State<'_, AppState>,
    channel_id: String,
    notice_text: String,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_change_notice: channelId 为空".into());
    }
    let tick = command(
        "im_channel_change_notice",
        serde_json::json!({
            "channel_id": channel_id,
            "notice": { "text": notice_text },
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_change_notice: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.5 频道置顶（per-member 对话置顶）：前端传 `channelId`（目标频道）+ `top`（bool·置顶/取消）→
/// 转 snake_case 入泵 `im_channel_change_top`（helix-im `outbound/channel_change.rs`
/// `ChangeTopCommand` 兑现出站 `POST channel/change/top {channelId, top}`·全 camelCase·真机curl真源
/// partials/6 UC-5.5）。
///
/// WS 回 `update_channel`（path2 PATCH·collect_present 收 channelIsTop→is_top 列）→ ④ channel 表
/// PATCH（is_top 列）+ ② `im:channel:update`（thin·{channel_id}·increment_channel_end 批次结束触发）
/// → ③ DOM data-channel-top 回读。薄壳纪律：只翻译入参 + 入泵，body camelCase 化 + endpoint
/// 全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_channel_change_top(
    state: State<'_, AppState>,
    channel_id: String,
    top: bool,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_change_top: channelId 为空".into());
    }
    let tick = command(
        "im_channel_change_top",
        serde_json::json!({
            "channel_id": channel_id,
            "top": top,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_change_top: 入泵失败（泵已退出？）：{e}"))
}

/// UC-6.3 改群昵称：前端传 `channelId`（目标频道）+ `userId`（被改昵称的成员·缺省则 Go 侧用
/// session 自身）+ `nickname`（新昵称·trim 空 → Go 侧清空昵称·故不在壳强校非空）→ 转 snake_case
/// 入泵 `im_update_member_nickname`（helix-im `outbound/channel_existing.rs` `UpdateNicknameCommand`
/// 兑现出站 `POST channel/member/change/nickname {channelId, nickname[, userId]}`·真机curl真源
/// partials/6 UC-6.3 + Go command.UpdateChannelMemberNickname）。
///
/// WS 回 `update_channel_member_nickName`（broadcast 到 channelId·{channelId, userId, nickName}·
/// camelN）→ ④ channel_member 表 BatchUpsert（复合 PK channel_id,user_id·仅改 nick_name 列）+
/// ② `im:channel:memberNickname`（{channelId, userId, nickName}·to_effect_s1::emit_member_nickname）
/// → ③ DOM data-nickname 回读。薄壳纪律：只翻译入参 + 入泵，body camelCase 化 + endpoint 全在
/// helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_update_member_nickname(
    state: State<'_, AppState>,
    channel_id: String,
    user_id: Option<String>,
    nickname: String,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_update_member_nickname: channelId 为空".into());
    }
    // nickname 允许空（Go 侧 trim 空 → 清空昵称）；userId 缺省 → helix outbound 不带该字段 →
    // Go 侧用 session 自身 userId 覆盖（真源 channel.go:539-541）。
    let mut args = serde_json::json!({
        "channel_id": channel_id,
        "nickname": nickname,
    });
    if let Some(uid) = user_id {
        if !uid.trim().is_empty() {
            args["user_id"] = serde_json::Value::String(uid);
        }
    }
    let tick = command("im_update_member_nickname", args);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_update_member_nickname: 入泵失败（泵已退出？）：{e}"))
}

/// UC-6.1 拉/踢人：前端传 `channelId`（目标频道）+ `joinUserIds`（拉进群的成员 userId 列表）+
/// `leaveUserIds`（踢出群的成员 userId 列表·两者可同时非空）→ 本命令把身份 + 结构化 userId 列表入泵
/// `im_channel_member_change`，joinUsers/leaveUsers 数组成形 + role=MEMBER 业务赋值 + join 排除自身由
/// helix-im `MemberChangeCommand` 兑现出站 `POST /api/cses/channel/member/change`（形态锚真源 §5：
/// `{channelId, joinUsers?:[{id,teamId,role}], leaveUsers?:[...]}`·空集省略字段）。
///
/// `teamId` / 自身 `userId` 取自 AppState.identity（profile companyId / cookieId·身份单一真源·不在前端
/// TS 硬编 creds）。WS 回 `channel_member_update`（broadcast 到 channelId·channel 全量帧含
/// memberChange.join/leave）→ ④ channel_member 表 BatchUpsert/BatchDelete + ② `im:channel:member-updated`
/// → ③ DOM data-members 回读。薄壳纪律：只翻译入参 + 解析身份 + 入泵结构化 args（`{channel_id, team_id,
/// self_id, join_user_ids, leave_user_ids}`），body camelCase 化 + role 赋值 + 自身过滤全在 helix-im。
#[tauri::command]
pub async fn im_channel_member_change(
    state: State<'_, AppState>,
    channel_id: String,
    join_user_ids: Option<Vec<String>>,
    leave_user_ids: Option<Vec<String>>,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_member_change: channelId 为空".into());
    }

    let tick = command(
        "im_channel_member_change",
        serde_json::json!({
            "channel_id": channel_id,
            "team_id": state.identity.team_id.clone(),
            "self_id": state.identity.user_id.clone(),
            "join_user_ids": join_user_ids.unwrap_or_default(),
            "leave_user_ids": leave_user_ids.unwrap_or_default(),
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_member_change: 入泵失败（泵已退出？）：{e}"))
}

/// UC-6.2 设/撤管理员：前端传 `channelId`（目标频道）+ `userId`（被设/撤管理员的成员）+
/// `set`（true=设管理员·false=撤管理员）→ 本命令把身份 + `set` 标志入泵 `im_channel_set_manger`，
/// role 业务赋值（set→ADMIN/MEMBER）+ endpoint 路由（`channel/add/manger` / `channel/remove/manger`）
/// + users 单成员定点 `{id,name,role,teamId}` 拼装全由 helix-im
/// `outbound/channel_change_dedicated.rs` `SetMangerCommand` 兑现（真机curl真源 partials/6 §19/§20·
/// 全 camelCase）。既有 `AddMangerCommand`/`RemoveMangerCommand` helix 仍保留注册·壳不再用·无害。
///
/// `teamId` 取自 AppState.identity（profile companyId·身份单一真源·不在前端 TS 硬编 creds）。
/// `name` 留空串（Go 侧 manger 仅按 id 鉴定·name 仅展示·真源示例非空但 id 才是定点键）；`role`=
/// 目标角色（设=ADMIN·撤=MEMBER·与 WS `channel_member_role_updated` echo 的 data.role 对齐）。
///
/// **WS 现实（迁移注意点·真源 channel_change_dedicated.rs §19/§20）**：add/remove manger 后端 WS
/// 已注释（仅 GrpcInvoke 对端），操作者实际收 `channel_member_role_updated`（{channelId, userIds, role}·
/// helix `ws/handlers/channel_member_role_updated.rs` graceful no-op·真源 cses-client router.rs
/// 落 vec![]·角色态由后续全量 `channel_member_update` 帧覆盖）。故本 UC L1 单账号**仅 ① 出站可观测**；
/// ② emit_channel_member_updated / ④ channel_member 全量落库须 `channel_member_update` 广播帧（结构性
/// 须第二账号触发·见 L2 issue #45）。薄壳纪律：只翻译入参 + 入泵，endpoint + camelCase body 在 helix-im。
#[tauri::command]
pub async fn im_channel_set_manger(
    state: State<'_, AppState>,
    channel_id: String,
    user_id: String,
    set: bool,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_set_manger: channelId 为空".into());
    }
    if user_id.trim().is_empty() {
        return Err("im_channel_set_manger: userId 为空".into());
    }
    // role 业务赋值（set=true→ADMIN·set=false→MEMBER）+ endpoint 路由（add/remove manger）+ users
    // 单成员定点拼装全下沉 helix-im SetMangerCommand·壳只传结构化 args `{channel_id, user_id,
    // team_id, set}`。
    let tick = command(
        "im_channel_set_manger",
        serde_json::json!({
            "channel_id": channel_id,
            "user_id": user_id,
            "team_id": state.identity.team_id.clone(),
            "set": set,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_set_manger: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.3 关闭/退出群：前端传 `channelId`（目标频道）→ 转 snake_case 入泵 `im_channel_close`
/// （helix-im `outbound/channel_existing.rs` `ChannelCloseCommand` 兑现出站 `POST channel/close
/// {channelId}`·真机curl真源 §6）。
///
/// WS 回 `channel_close`（broadcast 到 channelId·自己也收）→ ④ channel 表 batch_update
/// （delete_at + is_active=0 定点 patch·channel_close.rs handle）+ ② `im:channel:closed`
/// （{channelId, deleteAt}·独立 broadcast 推送·非批次结束 thin）→ ③ DOM channel 行移除（壳消费
/// 投影把该频道行从 CL 区删除）。薄壳纪律：只翻译入参 + 入泵，body camelCase 化 + endpoint 全在
/// helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_channel_close(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_channel_close: channelId 为空".into());
    }
    let tick = command(
        "im_channel_close",
        serde_json::json!({
            "channel_id": channel_id,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_channel_close: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.8 快捷回复 emoji：前端传 `postId`（被回复消息 server id）+ `emoji`（用户选的表情）→
/// 本命令补上自身 `userId`（AppState.identity·身份单一真源·壳不臆造 creds）转 snake_case 入泵
/// `im_quick_reply`（helix-im `outbound/quick_reply.rs` `QuickReplyCommand` 兑现出站
/// `POST posts/quickReply {postId, emoji, userId}`·全 camelCase·真机curl真源 partials/6 UC-1.8）。
///
/// WS 回 `post_update`（quickReply patch 进 props）→ 投影 `im:post:updated`（fat）→ DOM
/// data-reactions（emoji→userIds 聚合）。薄壳纪律：只翻译入参 + 补身份 + 入泵，body camelCase
/// 化 + endpoint 全在 helix-im，本壳不臆造。
#[tauri::command]
pub async fn im_send_quick_reply(
    state: State<'_, AppState>,
    post_id: String,
    emoji: String,
) -> Result<(), String> {
    if post_id.trim().is_empty() {
        return Err("im_send_quick_reply: postId 为空（须指定被回复消息 server id）".into());
    }
    if emoji.trim().is_empty() {
        return Err("im_send_quick_reply: emoji 为空".into());
    }
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_send_quick_reply: 自身 userId 为空（profile cookieId 未注入）".into());
    }
    // user_id 透传给 helix（QuickReplyCommand 把它写进 body.userId·真源 {postId,userId,emoji}）。
    let tick = command(
        "im_quick_reply",
        serde_json::json!({ "post_id": post_id, "emoji": emoji, "user_id": self_id }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_send_quick_reply: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.10 定时消息 create：前端传 `channelId` + `message`（定时正文）+ `schedulePostAt`
/// （int64 毫秒戳·未来发送时刻）+ 可选 `temporaryId` → 本命令转 snake_case 入泵 `im_create_schedule`
/// （helix-im `outbound/posts_existing.rs` `CreateScheduleCommand` 兑现出站
/// `POST posts/createSchedule {post:{channelId,message,temporaryId?}, schedulePostAt}`·真机curl真源
/// partials/6 UC-1.10 CreateSchedulePostReq）。WS 回 `post_schedule_created` → 投影
/// `im:channel:schedule-created {channelId, hasSchedulePost}` → channel 表 has_schedule_post=true
/// 落库 + DOM data-has-schedule-post=true。
///
/// 薄壳纪律：只翻译入参 + 入泵，body 嵌套 post 对象 + endpoint 全在 helix-im，本壳不臆造 body。
#[tauri::command]
pub async fn im_create_schedule(
    state: State<'_, AppState>,
    channel_id: String,
    message: String,
    schedule_post_at: i64,
    temporary_id: Option<String>,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_create_schedule: channelId 为空".into());
    }
    if message.trim().is_empty() {
        return Err("im_create_schedule: message 为空（定时正文）".into());
    }
    if schedule_post_at <= 0 {
        return Err("im_create_schedule: schedulePostAt 须为正 int64 毫秒戳".into());
    }
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "message": message,
        "schedule_post_at": schedule_post_at,
    });
    if let Some(tmp) = temporary_id.filter(|t| !t.is_empty()) {
        payload["temporary_id"] = serde_json::json!(tmp);
    }
    let tick = command("im_create_schedule", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_create_schedule: 入泵失败（泵已退出？）：{e}"))
}

/// UC-1.10 取消定时（issue #72）：前端只传 `channelId`（当前活动频道）→ 本命令转 snake_case 入泵
/// `im_cancel_schedule`（helix-im `outbound/posts_existing.rs` `CancelScheduleCommand` 兑现出站
/// `POST posts/cancelSchedule {channelId}`·真源 `CancelSchedulePostReq{ChannelId}`·userId 取 session）。
/// WS 回 `post_schedule_canceled` → 投影 `im:channel:schedule-canceled {channelId, hasSchedulePost:false}`
/// → channel 表 has_schedule_post=false 落库 + DOM data-has-schedule-post 清空。
///
/// 薄壳纪律：只翻译入参 + 入泵，body{channelId} + endpoint 全在 helix-im，本壳不臆造 body。
#[tauri::command]
pub async fn im_cancel_schedule(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_cancel_schedule: channelId 为空".into());
    }
    let payload = serde_json::json!({ "channel_id": channel_id });
    let tick = command("im_cancel_schedule", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_cancel_schedule: 入泵失败（泵已退出？）：{e}"))
}

/// UC-2.2 上拉加载更早历史（读族 request-response 编排）：前端滚到顶触发 → 传 `channelId` +
/// `anchorPostId`（当前已加载最旧一条带 server id 的消息·作 pivot）+ `anchorCreateAt`（该锚
/// createAt int64 毫秒·严格更早过滤基准）+ 可选 `limit`（目标条数·缺省 20·clamp 1..=100）→ 本命令
/// 转 snake_case 入泵 `im_load_older_context`（helix-im `older_context.rs` `LoadOlderState` 编排：
/// 每轮兑现出站 `POST posts/postContext {postId, before}`·全 camelCase·真源 http.rs:96·回报推进
/// anchor·凑够 target / 服务端无更早 / pivot 卡住 / 轮数耗尽 → emit `im:messages:older_loaded`
/// {channelId, messages[], hasMore}·升序 wire Post 透传供前端 prepend·projection-schema §1.3）。
///
/// 读族编排无 WS 回声：多轮 postContext HTTP 200 经 helix port_reply ingest 推进 → 收尾 emit。
/// 薄壳纪律：只翻译入参（channel_id/anchor_post_id/anchor_create_at/limit）+ 入泵；endpoint /
/// body camelCase 化（{postId,before}）/ 多轮翻页编排全在 helix-im，本壳不臆造 wire body。
#[tauri::command]
pub async fn im_load_older_context(
    state: State<'_, AppState>,
    channel_id: String,
    anchor_post_id: String,
    anchor_create_at: i64,
    limit: Option<u32>,
) -> Result<(), String> {
    if channel_id.trim().is_empty() {
        return Err("im_load_older_context: channelId 为空".into());
    }
    if anchor_post_id.trim().is_empty() {
        return Err(
            "im_load_older_context: anchorPostId 为空（须当前最旧一条带 server id 的消息作 pivot）"
                .into(),
        );
    }
    if anchor_create_at <= 0 {
        return Err("im_load_older_context: anchorCreateAt 须为正 int64 毫秒戳".into());
    }
    let mut payload = serde_json::json!({
        "channel_id": channel_id,
        "anchor_post_id": anchor_post_id,
        "anchor_create_at": anchor_create_at,
    });
    if let Some(l) = limit {
        payload["limit"] = serde_json::json!(l);
    }
    let tick = command("im_load_older_context", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_load_older_context: 入泵失败（泵已退出？）：{e}"))
}

// ── UC-8.x 投票 CRUD（vote/score 第二网关 :3399·partials/6 集合八）──────────────
//
// 五命令对 helix-im outbound registry（vote_score.rs）：
//   im_vote_create → `POST vote/createVote`（写族·整 args 透传·body=fields 字面 camelCase wire）
//   im_vote_do     → `POST vote/vote`        （写族·{id, postId?, indexes:[]}）
//   im_vote_read   → `POST vote/readVote`     （读族 is_read=true·{id}·im:read:result{req_id, body} 回灌）
//   im_vote_close  → `POST vote/closeVote`    （写族·{id}）
//   im_vote_delete → `POST vote/deleteVote`   （写族·{id}）
//
// 薄壳纪律：仅翻译入参 + 入泵；出站 wire body / 落库 / WS 回声全在 helix-im。
// **req_id 投放纪律**：写族（create/do/close/delete）是 fire-and-forget（is_read=false·无读族回灌）→
//   payload **不**带 req_id（尤其 createVote 整 args 透传·带 req_id 会泄漏进 wire body 污染 ① 出站）。
//   仅读族 im_vote_read payload 带 req_id（helix id_body 只取 id·req_id 不泄漏·read_req_id 抠出注册回灌）。

/// UC-8.x 投票·发起：前端组好 camelCase wire fields（fromUserId/fromUserName/title/content/votes/
/// isReal/finishTime/options[]/orgIds[]/source? 等·真源 partials/6 集合八 §createVote）→ 本壳整对象
/// 透传入泵 `im_vote_create`（helix `VoteCreateCommand` 整 args 透传出站 `POST vote/createVote`·
/// 字面 camelCase·不重列字段防漏）。写族 fire-and-forget（数据走 server WS post_updated 回声）·
/// 不带 req_id（防泄漏进透传 body）。
#[tauri::command]
pub async fn im_vote_create(
    state: State<'_, AppState>,
    fields: serde_json::Value,
) -> Result<(), String> {
    if !fields.as_object().is_some_and(|o| !o.is_empty()) {
        return Err("im_vote_create: fields 须为非空 object（camelCase wire 字段集）".into());
    }
    let tick = command("im_vote_create", fields);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_vote_create: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 投票·提交：前端传 `id`（投票卡 id）+ `indexes`（选项序号字符串数组）+ 可选 `postId`
/// → 入泵 `im_vote_do`（helix `VoteDoCommand` 出站 `POST vote/vote` body `{id, indexes:[], postId?}`·
/// 真源 partials/6 §vote）。写族·不带 req_id。
#[tauri::command]
pub async fn im_vote_do(
    state: State<'_, AppState>,
    id: String,
    indexes: Vec<String>,
    post_id: Option<String>,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_vote_do: id 为空（投票卡 id）".into());
    }
    let mut payload = serde_json::Map::new();
    payload.insert("id".into(), serde_json::json!(id));
    payload.insert("indexes".into(), serde_json::json!(indexes));
    if let Some(p) = post_id {
        if !p.is_empty() {
            payload.insert("postId".into(), serde_json::json!(p));
        }
    }
    let tick = command("im_vote_do", serde_json::Value::Object(payload));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_vote_do: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 投票·读详情（读族 is_read=true）：前端传 `id` + `reqId` → 入泵 `im_vote_read`
/// （helix `VoteReadCommand` 出站 `POST vote/readVote` body `{id}`·真源 partials/6 §readVote）。
/// HTTP 响应体经 `query::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（reqId 经 payload
/// 透传·helix `read_req_id` 抠出·`id_body` 只取 id 不泄漏 reqId）。
#[tauri::command]
pub async fn im_vote_read(
    state: State<'_, AppState>,
    id: String,
    req_id: String,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_vote_read: id 为空（投票卡 id）".into());
    }
    if req_id.is_empty() {
        return Err("im_vote_read: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({ "id": id, "req_id": req_id });
    let tick = command("im_vote_read", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_vote_read: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 投票·截止：前端传 `id` → 入泵 `im_vote_close`（helix `VoteCloseCommand` 出站
/// `POST vote/closeVote` body `{id}`·真源 partials/6 §closeVote）。写族·不带 req_id。
#[tauri::command]
pub async fn im_vote_close(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_vote_close: id 为空（投票卡 id）".into());
    }
    let tick = command("im_vote_close", serde_json::json!({ "id": id }));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_vote_close: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 投票·删除：前端传 `id` → 入泵 `im_vote_delete`（helix `VoteDeleteCommand` 出站
/// `POST vote/deleteVote` body `{id}`·真源 partials/6 §deleteVote）。写族·不带 req_id。
#[tauri::command]
pub async fn im_vote_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_vote_delete: id 为空（投票卡 id）".into());
    }
    let tick = command("im_vote_delete", serde_json::json!({ "id": id }));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_vote_delete: 入泵失败（泵已退出？）：{e}"))
}

// ── UC-8.x 平均分 CRUD（vote/score 第二网关 :3399·partials/6 集合八）──────────────
//
// 五命令对 helix-im outbound registry（vote_score.rs）：
//   im_average_publish → `POST average/publish`（写族·整 args 透传·body=fields 字面 camelCase wire）
//   im_average_attend  → `POST average/attend` （写族·{id, score:number, postId?}）
//   im_average_read    → `POST average/read`    （读族 is_read=true·{id}·im:read:result{req_id, body} 回灌）
//   im_average_close   → `POST average/close`   （写族·{id, postId?}）
//   im_average_delete  → `POST average/delete`  （写族·{id}）
//
// 薄壳纪律 + req_id 投放纪律同投票族（见上）：写族不带 req_id（尤其 publish 整 args 透传·带 req_id
//   会泄漏进 wire body 污染 ① 出站）；仅读族 im_average_read payload 带 req_id（helix id_body 只取 id·
//   req_id 不泄漏·read_req_id 抠出注册回灌）。

/// UC-8.x 平均分·发布：前端组好 camelCase wire fields（title/content/maxScore/minScore/isDelMaxMin/
/// isAnonymous/cutoff/members[]/hasDecimal?/decimalPlaces?/source? 等·真源 partials/6 集合八
/// §average/publish）→ 本壳整对象透传入泵 `im_average_publish`（helix `AveragePublishCommand` 整 args
/// 透传出站 `POST average/publish`·字面 camelCase·不重列字段防漏）。写族 fire-and-forget·不带 req_id。
#[tauri::command]
pub async fn im_average_publish(
    state: State<'_, AppState>,
    fields: serde_json::Value,
) -> Result<(), String> {
    if !fields.as_object().is_some_and(|o| !o.is_empty()) {
        return Err("im_average_publish: fields 须为非空 object（camelCase wire 字段集）".into());
    }
    let tick = command("im_average_publish", fields);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_average_publish: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 平均分·提交评分：前端传 `id`（平均分卡 id）+ `score`（数值评分）+ 可选 `postId`
/// → 入泵 `im_average_attend`（helix `AverageAttendCommand` 出站 `POST average/attend` body
/// `{id, score:number, postId?}`·真源 partials/6 §average/attend）。写族·不带 req_id。
#[tauri::command]
pub async fn im_average_attend(
    state: State<'_, AppState>,
    id: String,
    score: f64,
    post_id: Option<String>,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_average_attend: id 为空（平均分卡 id）".into());
    }
    let mut payload = serde_json::Map::new();
    payload.insert("id".into(), serde_json::json!(id));
    payload.insert("score".into(), serde_json::json!(score));
    if let Some(p) = post_id {
        if !p.is_empty() {
            payload.insert("postId".into(), serde_json::json!(p));
        }
    }
    let tick = command("im_average_attend", serde_json::Value::Object(payload));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_average_attend: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 平均分·读详情（读族 is_read=true）：前端传 `id` + `reqId` → 入泵 `im_average_read`
/// （helix `AverageReadCommand` 出站 `POST average/read` body `{id}`·真源 partials/6 §average/read）。
/// HTTP 响应体经 `query::emit_read_result` 透传回灌 `im:read:result{req_id, body}`（reqId 经 payload
/// 透传·helix `read_req_id` 抠出·`id_body` 只取 id 不泄漏 reqId）。
#[tauri::command]
pub async fn im_average_read(
    state: State<'_, AppState>,
    id: String,
    req_id: String,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_average_read: id 为空（平均分卡 id）".into());
    }
    if req_id.is_empty() {
        return Err("im_average_read: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let payload = serde_json::json!({ "id": id, "req_id": req_id });
    let tick = command("im_average_read", payload);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_average_read: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 平均分·截止：前端传 `id` + 可选 `postId` → 入泵 `im_average_close`（helix
/// `AverageCloseCommand` 出站 `POST average/close` body `{id, postId?}`·真源 partials/6 §average/close）。
/// 写族·不带 req_id。
#[tauri::command]
pub async fn im_average_close(
    state: State<'_, AppState>,
    id: String,
    post_id: Option<String>,
) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_average_close: id 为空（平均分卡 id）".into());
    }
    let mut payload = serde_json::Map::new();
    payload.insert("id".into(), serde_json::json!(id));
    if let Some(p) = post_id {
        if !p.is_empty() {
            payload.insert("postId".into(), serde_json::json!(p));
        }
    }
    let tick = command("im_average_close", serde_json::Value::Object(payload));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_average_close: 入泵失败（泵已退出？）：{e}"))
}

/// UC-8.x 平均分·删除：前端传 `id` → 入泵 `im_average_delete`（helix `AverageDeleteCommand` 出站
/// `POST average/delete` body `{id}`·真源 partials/6 §average/delete）。写族·不带 req_id。
#[tauri::command]
pub async fn im_average_delete(state: State<'_, AppState>, id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("im_average_delete: id 为空（平均分卡 id）".into());
    }
    let tick = command("im_average_delete", serde_json::json!({ "id": id }));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_average_delete: 入泵失败（泵已退出？）：{e}"))
}

/// UC-12.1 健康探针（读族 request-response·连通性 ① 面）：前端传 `reqId` → 本命令转 snake_case
/// 入泵 `im_health`（helix-im `outbound/user_misc.rs` `HealthCommand` 兑现出站 `GET /api/cses/health`·
/// **无请求体**·不走业务信封·真源 partials/3 §15 healthCheck → 裸 `{"status":"OK"}`）。读族无 WS
/// 回声：HTTP 200 响应体经 helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`
/// （body=`{status:"OK"}`·projection-schema §1.2）。
///
/// 薄壳纪律：只翻译入参 + 入泵，endpoint/method（GET health·空 body）在 helix-im 注册表兑现，
/// 本壳不臆造 wire；`req_id` 经 payload 透传（helix `module::read_req_id` 抠出注册回灌上下文）。
/// 本 UC 验收仅 ① 面（出站 GET health + 200 连通性）；②投影为读族回灌副产（非冻结业务面）。
#[tauri::command]
pub async fn im_health(state: State<'_, AppState>, req_id: String) -> Result<(), String> {
    if req_id.is_empty() {
        return Err("im_health: reqId 为空（前端 bridge 须生成·回灌关联）".into());
    }
    let tick = command("im_health", serde_json::json!({ "req_id": req_id }));
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_health: 入泵失败（泵已退出？）：{e}"))
}

/// 就绪 probe：前端轮询此命令直到返回 `true`（increment 流动 + 静默窗口达成）。
///
/// 返回值真精确度的边界见 `state::ReadinessProbe` 注释 + integration_todos（inflight==0
/// 当前用「bus 静默」近似，不冒充精确计数）。
#[tauri::command]
pub fn im_ready(state: State<'_, AppState>) -> bool {
    state.probe.is_ready()
}

/// 录放/认领专用：注入当前 UC id（透传 `InstrumentCtx::set_uc`）。
///
/// 仅 `webdriver` feature（默认开）编译进二进制；release `--no-default-features` 去掉
/// （无录放 / 无 webdriver / 无此命令，守 CLAUDE.md §2.4）。
#[cfg(feature = "webdriver")]
#[tauri::command]
pub fn set_uc(state: State<'_, AppState>, uc: String) -> Result<(), String> {
    state.ctx.set_uc(uc);
    Ok(())
}
