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
