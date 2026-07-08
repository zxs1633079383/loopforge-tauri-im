//! loopforge-tauri-im —— 最小可测 Tauri IM 宿主（内嵌真实 helix 引擎 · debug 仪表化）。
//!
//! 三层（CLAUDE.md §1）：前端薄壳 → 本壳（Tauri IPC + helix-driver-native 装配）→ helix 引擎。
//! 唯一新缝 = `helix-driver-instrument` 的 port 装饰器（投影面 tee）；helix 引擎零改。
//!
//! ## 仪表化范围（W1 现实边界，诚实记录）
//!
//! native `EngineConfig` 字段是具体 ports（非泛型）→ Record/Replay tape 所需的
//! Transport/Http/Storage/Clock/IdSource **被装饰 port 注入引擎**当前不可达（要么改 helix
//! 违零改铁律，要么走 driver-host `BatchSink` 泛型缝补 ffi 同款装饰）。故 W1 落地的是：
//! **投影面（facet ②）** 在 broadcast 消费 loop tee 日志 + `app.emit(im:__bus__)` 透传 +
//! 就绪 probe。其余三面 + tape 录放是后续集成项（见 README / 任务 integration_todos）。

mod commands;
mod config;
mod engine;
mod state;
mod tick_tee;
mod trace;
mod ws_reconnect;

use std::sync::Arc;

use helix_driver_instrument::{
    default_trace_jsonl_path, InstrumentCtx, LogSink, Mode, Tape, TraceEmitter, TraceJsonlSink,
};
use state::{AppState, ReadinessProbe};
use tauri::Manager;

/// 默认 tape 路径（`LOOPFORGE_TAPE` 未设时）：UC-send-1 金标帧。
const DEFAULT_TAPE: &str = "test/fixtures/uc-send-1.tape.json";

/// 解析运行模式 + tape：`LOOPFORGE_MODE` ∈ {live,record,replay}（默认 live）。
///
/// - live：空 tape（不录不放，透传真 go + tee 日志）。
/// - record：空 tape（透传真 go + 旁路录帧/时钟/id；退出时 save_tape）。
/// - replay：从 `LOOPFORGE_TAPE`（或默认）load 金标 tape（不碰网络，入站/响应/时钟/id 从 tape 供）。
///
/// tape 路径：`LOOPFORGE_TAPE` 覆盖 > 默认 [`DEFAULT_TAPE`]。
fn resolve_mode_tape() -> (Mode, Tape, String) {
    let mode = match std::env::var("LOOPFORGE_MODE")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "record" => Mode::Record,
        "replay" => Mode::Replay,
        _ => Mode::Live,
    };
    let tape_path = std::env::var("LOOPFORGE_TAPE").unwrap_or_else(|_| DEFAULT_TAPE.into());
    let tape = match mode {
        // Replay：load 金标 tape（失败 → 空 tape + warn，让 app 仍起，断言会照出缺帧）。
        Mode::Replay => Tape::load(&tape_path).unwrap_or_else(|e| {
            tracing::warn!(error = %e, %tape_path, "Replay tape 加载失败，回退空 tape");
            Tape::new()
        }),
        // Live/Record：空 tape 起步（Record 退出时 save 到 tape_path）。
        _ => Tape::new(),
    };
    (mode, tape, tape_path)
}

/// JSONL hop 日志落点（env 覆盖 > 默认 /tmp）。失败回退 stdout（fail-soft，不让日志崩 app）。
fn build_log_sink() -> LogSink {
    let path =
        std::env::var("HELIX_RUN_JSONL").unwrap_or_else(|_| "/tmp/loopforge/run.jsonl".into());
    LogSink::to_file(&path).unwrap_or_else(|e| {
        tracing::warn!(error = %e, %path, "JSONL 日志文件创建失败，回退 stdout");
        LogSink::to_writer(Box::new(std::io::stdout()))
    })
}

fn build_trace_emitter(run_id: &str) -> TraceEmitter {
    let path = std::env::var("LOOPFORGE_TRACE_JSONL")
        .unwrap_or_else(|_| default_trace_jsonl_path().to_string());
    let sink = TraceJsonlSink::to_file(&path).unwrap_or_else(|e| {
        tracing::warn!(error = %e, %path, "trace JSONL 创建失败，回退 stdout");
        TraceJsonlSink::to_writer(Box::new(std::io::stdout()))
    });
    TraceEmitter::new(run_id.to_string(), sink)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // 仪表上下文：模式 + tape 经 LOOPFORGE_MODE / LOOPFORGE_TAPE 注入（①④ rewire 后接通）。
    // live=透传真 go / record=透传 + 录 tape / replay=不碰网络从 tape 供。
    let run_id = std::env::var("LOOPFORGE_RUN_ID").unwrap_or_else(|_| "loopforge-w1".into());
    let (mode, tape, tape_path) = resolve_mode_tape();
    tracing::info!(?mode, %tape_path, "仪表运行模式");
    let trace = build_trace_emitter(&run_id);
    let ctx = InstrumentCtx::new(run_id, mode, build_log_sink(), tape).with_trace(trace);
    let probe = Arc::new(ReadinessProbe::default());

    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    // 仅 `webdriver` feature（默认开，release 出货 `--no-default-features` 关）注入 W3C WebDriver
    // server——release 绝不带，会暴露自动化 HTTP 接口（CLAUDE.md §2.4）。启动后 4445 暴露协议。
    #[cfg(feature = "webdriver")]
    {
        builder = builder.plugin(tauri_plugin_webdriver::init());
    }

    let ctx_for_setup = ctx.clone();
    let probe_for_setup = probe.clone();

    let builder =
        builder.setup(move |app| {
            let app_handle = app.handle().clone();
            // 引擎装配含 `transport.connect().await`（CLI 可阻塞端，setup 内 block_on 合法）。
            // 失败不中止 app 启动：前端仍可起，命令入泵会拿到错误（联调可见）。
            let (tick_tx, identity, command_traces) = tauri::async_runtime::block_on(
                engine::spawn(app_handle, ctx_for_setup.clone(), probe_for_setup.clone()),
            )
            .map_err(|e| -> Box<dyn std::error::Error> {
                tracing::error!(error = %e, "helix 引擎装配失败");
                e.into()
            })?;

            // P0b ⓪ Inbound tee：把进泵发送端包一层 TeeTickSender（webdriver feature 下旁路落
            // Facet::Inbound·release 纯透传）。引擎内部留用的 tick_tx clone 不经此 tee（只捕获 IPC 派发指令）。
            let tick_tx =
                crate::tick_tee::TeeTickSender::new(tick_tx, ctx_for_setup.clone(), command_traces);
            app.manage(AppState {
                tick_tx,
                ctx: ctx_for_setup,
                probe: probe_for_setup,
                identity,
            });
            Ok(())
        });

    // 命令集：`webdriver` feature 多挂 `set_uc`（录放/认领专用），release 不带（守 §2.4）。
    // generate_handler! 的返回闭包类型不透明 → cfg 分支各自调 .invoke_handler，不抽函数。
    #[cfg(feature = "webdriver")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::im_send,
        commands::im_identity,
        commands::im_ready,
        commands::im_query_dialog_list,
        commands::im_revoke,
        commands::im_create_channel,
        commands::im_make_topic,
        commands::im_team_upsert,
        commands::im_team_quit,
        commands::im_urgent_post,
        commands::im_urgent_confirm,
        commands::im_send_quick_reply,
        commands::im_create_schedule,
        commands::im_cancel_schedule,
        commands::im_mark_read,
        commands::im_read_channel,
        commands::im_template_received,
        commands::im_relay_messages,
        commands::im_get_replies,
        commands::im_get_reply_branch,
        commands::im_members_by_ids,
        commands::im_member_snapshot,
        commands::im_ensure_channel_loaded,
        commands::im_channel_query,
        commands::im_channel_online_status,
        commands::im_modules_get_all,
        commands::im_announcement_accept_list,
        commands::im_announcement_list,
        commands::im_announcement_detail,
        commands::im_announcement_save,
        commands::im_announcement_read,
        commands::im_announcement_delete,
        commands::im_post_pin,
        commands::im_query_messages_by_channel,
        commands::im_load_older_context,
        commands::im_channel_change_display_name,
        commands::im_channel_change_notice,
        commands::im_channel_change_top,
        commands::im_update_member_nickname,
        commands::im_channel_member_change,
        commands::im_channel_set_manger,
        commands::im_channel_close,
        commands::im_bookmark_create,
        commands::im_bookmark_delete,
        commands::im_bookmark_load,
        commands::im_vote_create,
        commands::im_vote_do,
        commands::im_vote_read,
        commands::im_vote_close,
        commands::im_vote_delete,
        commands::im_average_publish,
        commands::im_average_attend,
        commands::im_average_read,
        commands::im_average_close,
        commands::im_average_delete,
        commands::im_sync_channels,
        commands::im_health,
        commands::im_l2_send,
        commands::im_l2_read_channel,
        commands::im_l2_read_post,
        commands::im_l2_urgent_post,
        commands::trace_record_event,
        commands::set_uc
    ]);
    #[cfg(not(feature = "webdriver"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::im_send,
        commands::im_identity,
        commands::im_ready,
        commands::im_query_dialog_list,
        commands::im_revoke,
        commands::im_create_channel,
        commands::im_make_topic,
        commands::im_team_upsert,
        commands::im_team_quit,
        commands::im_urgent_post,
        commands::im_urgent_confirm,
        commands::im_send_quick_reply,
        commands::im_create_schedule,
        commands::im_cancel_schedule,
        commands::im_mark_read,
        commands::im_read_channel,
        commands::im_template_received,
        commands::im_relay_messages,
        commands::im_get_replies,
        commands::im_get_reply_branch,
        commands::im_members_by_ids,
        commands::im_member_snapshot,
        commands::im_ensure_channel_loaded,
        commands::im_channel_query,
        commands::im_channel_online_status,
        commands::im_modules_get_all,
        commands::im_announcement_accept_list,
        commands::im_announcement_list,
        commands::im_announcement_detail,
        commands::im_announcement_save,
        commands::im_announcement_read,
        commands::im_announcement_delete,
        commands::im_post_pin,
        commands::im_query_messages_by_channel,
        commands::im_load_older_context,
        commands::im_channel_change_display_name,
        commands::im_channel_change_notice,
        commands::im_channel_change_top,
        commands::im_update_member_nickname,
        commands::im_channel_member_change,
        commands::im_channel_set_manger,
        commands::im_channel_close,
        commands::im_bookmark_create,
        commands::im_bookmark_delete,
        commands::im_bookmark_load,
        commands::im_vote_create,
        commands::im_vote_do,
        commands::im_vote_read,
        commands::im_vote_close,
        commands::im_vote_delete,
        commands::im_average_publish,
        commands::im_average_attend,
        commands::im_average_read,
        commands::im_average_close,
        commands::im_average_delete,
        commands::im_sync_channels,
        commands::im_health
    ]);

    // Record 模式退出落盘：app 退出（RunEvent::Exit）时把录好的 tape 存到 tape_path。
    // live/replay 模式无副作用（save 只在 Record 触发）。
    let ctx_for_exit = ctx.clone();
    let tape_path_for_exit = tape_path.clone();
    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building loopforge tauri application");
    app.run(move |_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if ctx_for_exit.mode() == Mode::Record {
                match ctx_for_exit.save_tape(&tape_path_for_exit) {
                    Ok(()) => tracing::info!(path = %tape_path_for_exit, "Record tape 已落盘"),
                    Err(e) => tracing::error!(error = %e, path = %tape_path_for_exit, "Record tape 落盘失败"),
                }
            }
        }
    });
}
