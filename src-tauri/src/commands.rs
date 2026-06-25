//! Tauri `#[tauri::command]` 入口 —— 前端 invoke 收口（薄壳 → 引擎）。
//!
//! 命令把前端 camelCase 入参翻译成 helix-im 认的 snake_case `AppCommand` payload，
//! 经 `tick_tx` 喂同一条泵（与 WS 入站串行，零并发进 core）。**body 字段对齐
//! host-cli `cmd_parse::parse_send`**（`{channel_id, temporary_id, text}`）——即出站
//! HTTP `posts/create` 的真源（真机curl真源 §1）由 helix-im handle_send_message 兑现。

use bytes::Bytes;
use helix_core::tick::AppCommand;
use helix_core::Tick;
use tauri::State;

use crate::state::AppState;

/// 把 JSON 值打包成 `Tick::Command`（payload = JSON bytes，由 helix-im ACL-1 解析）。
fn command(name: &'static str, payload: serde_json::Value) -> Tick {
    let bytes = serde_json::to_vec(&payload).unwrap_or_default();
    Tick::Command(AppCommand::new(name, Bytes::from(bytes)))
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
) -> Result<(), String> {
    if channel_id.is_empty() {
        return Err("im_send: channelId 为空".into());
    }
    if temporary_id.is_empty() {
        return Err("im_send: temporaryId 为空（薄壳须生成）".into());
    }
    // type 缺省由 helix send_build 容错为 "TEXT"；DOCUMENT 等富媒体显式透传真值（UC-1.2）。
    let msg_type = msg_type.unwrap_or_else(|| "TEXT".into());
    let tick = command(
        "im_send_message",
        serde_json::json!({
            "channel_id": channel_id,
            "temporary_id": temporary_id,
            "text": text,
            "type": msg_type,
        }),
    );
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_send: 入泵失败（泵已退出？）：{e}"))
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
pub async fn im_read_channel(
    state: State<'_, AppState>,
    channel_id: String,
) -> Result<(), String> {
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
    let targets: Vec<String> = channel_ids.into_iter().filter(|c| !c.trim().is_empty()).collect();
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

/// UC-5.1 创建群聊：前端传 `displayName` + `memberIds`（其他成员真实 userId 列表）→ 本命令按
/// 真机curl真源 §4 拼 `channel/create` raw body 入泵 `im_create_channel`（helix-im
/// `CreateChannelCommand` 透传 args 到 `POST /api/cses/channel/create`）。
///
/// body 单一真源：`teamId` / 自身 `userId`（role=CREATOR）取自 AppState.identity（profile
/// companyId / cookieId），**不在前端 TS 硬编 creds**（守 src-tauri 纪律 3·身份单一真源）。
/// 其他成员（role=MEMBER）由前端供 `memberIds`（e2e 读 seeded channel_member 真实 userId）。
/// 形态锚真源 §4：`{teamId, displayName, orient:"", type:"P", users:[{id,teamId,role}],
/// picturetype:"USER", picture:{userIds:[...]}, forceCreate:true}`（全 camelCase）。
#[tauri::command]
pub async fn im_create_channel(
    state: State<'_, AppState>,
    display_name: String,
    member_ids: Vec<String>,
) -> Result<(), String> {
    if display_name.trim().is_empty() {
        return Err("im_create_channel: displayName 为空".into());
    }
    let team_id = state.identity.team_id.clone();
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_create_channel: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    // users[]：自己 CREATOR + 其他成员 MEMBER（真源 §4 三键 id/teamId/role 全 camelCase）。
    let mut users: Vec<serde_json::Value> = Vec::with_capacity(member_ids.len() + 1);
    let mut user_ids: Vec<String> = Vec::with_capacity(member_ids.len() + 1);
    users.push(serde_json::json!({
        "id": self_id,
        "teamId": team_id,
        "role": "CREATOR",
    }));
    user_ids.push(self_id.clone());
    for mid in member_ids.into_iter().filter(|m| !m.is_empty() && *m != self_id) {
        users.push(serde_json::json!({
            "id": mid,
            "teamId": team_id,
            "role": "MEMBER",
        }));
        user_ids.push(mid);
    }

    let body = serde_json::json!({
        "teamId": team_id,
        "displayName": display_name,
        "orient": "",
        "type": "P",
        "users": users,
        "picturetype": "USER",
        "picture": { "userIds": user_ids },
        "forceCreate": true,
    });

    let tick = command("im_create_channel", body);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_create_channel: 入泵失败（泵已退出？）：{e}"))
}

/// UC-5.2 创建话题（消息转话题）：前端传 `rootId`（话题挂载的根群 channelId）+ `postId`
/// （被转成话题的消息 server id）+ `displayName` + `memberIds`（其他成员真实 userId）→ 本命令按
/// 真机curl真源 §2 拼 `posts/makeTopic` raw body 入泵 `im_make_topic`（helix-im
/// `MakeTopicCommand` 校验 postId 后透传 args 到 `POST /api/cses/posts/makeTopic`）。
///
/// 形态锚真源 §2：`{rootId, teamId, postId, displayName, type:"T", users:[{id,teamId,role}],
/// picturetype:"USER", picture:{userIds:[...]}, forceCreate:true}`（全 camelCase）。与建群（§4
/// channel/create）同形态，差异：① endpoint posts/makeTopic ② 多 rootId+postId ③ type 固定 T
/// （话题·非 P 私聊群）④ 无 orient。`teamId` / 自身 `userId`（role=CREATOR）取自 AppState.identity
/// （profile companyId / cookieId）·身份单一真源·壳不臆造 creds。WS 回 `channel_created`（话题=新
/// channel）+ `post_update`（原消息挂 topicId）。
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
    let team_id = state.identity.team_id.clone();
    let self_id = state.identity.user_id.clone();
    if self_id.is_empty() {
        return Err("im_make_topic: 自身 userId 为空（profile cookieId 未注入）".into());
    }

    // users[]：自己 CREATOR + 其他成员 MEMBER（真源 §2 三键 id/teamId/role 全 camelCase）。
    let mut users: Vec<serde_json::Value> = Vec::with_capacity(member_ids.len() + 1);
    let mut user_ids: Vec<String> = Vec::with_capacity(member_ids.len() + 1);
    users.push(serde_json::json!({
        "id": self_id,
        "teamId": team_id,
        "role": "CREATOR",
    }));
    user_ids.push(self_id.clone());
    for mid in member_ids.into_iter().filter(|m| !m.is_empty() && *m != self_id) {
        users.push(serde_json::json!({
            "id": mid,
            "teamId": team_id,
            "role": "MEMBER",
        }));
        user_ids.push(mid);
    }

    let body = serde_json::json!({
        "rootId": root_id,
        "teamId": team_id,
        "postId": post_id,
        "displayName": display_name,
        "type": "T",
        "users": users,
        "picturetype": "USER",
        "picture": { "userIds": user_ids },
        "forceCreate": true,
    });

    let tick = command("im_make_topic", body);
    state
        .tick_tx
        .send(tick)
        .await
        .map_err(|e| format!("im_make_topic: 入泵失败（泵已退出？）：{e}"))
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
            "im_load_older_context: anchorPostId 为空（须当前最旧一条带 server id 的消息作 pivot）".into(),
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
