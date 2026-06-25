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
