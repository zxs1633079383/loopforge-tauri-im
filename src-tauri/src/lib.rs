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
mod engine;
mod state;

use std::sync::Arc;

use helix_driver_instrument::{InstrumentCtx, LogSink, Mode, Tape};
use state::{AppState, ReadinessProbe};
use tauri::Manager;

/// JSONL hop 日志落点（env 覆盖 > 默认 /tmp）。失败回退 stdout（fail-soft，不让日志崩 app）。
fn build_log_sink() -> LogSink {
    let path =
        std::env::var("HELIX_RUN_JSONL").unwrap_or_else(|_| "/tmp/loopforge/run.jsonl".into());
    LogSink::to_file(&path).unwrap_or_else(|e| {
        tracing::warn!(error = %e, %path, "JSONL 日志文件创建失败，回退 stdout");
        LogSink::to_writer(Box::new(std::io::stdout()))
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    // 仪表上下文：W1 默认 Live（透传真 go + tee 日志）。run_id = env 或固定。
    // Record/Replay 模式 + tape 注入待 tape 录放缝接通（见模块头注）。
    let run_id = std::env::var("LOOPFORGE_RUN_ID").unwrap_or_else(|_| "loopforge-w1".into());
    let ctx = InstrumentCtx::new(run_id, Mode::Live, build_log_sink(), Tape::new());
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

    let builder = builder.setup(move |app| {
        let app_handle = app.handle().clone();
        // 引擎装配含 `transport.connect().await`（CLI 可阻塞端，setup 内 block_on 合法）。
        // 失败不中止 app 启动：前端仍可起，命令入泵会拿到错误（联调可见）。
        let tick_tx = tauri::async_runtime::block_on(engine::spawn(
            app_handle,
            ctx_for_setup.clone(),
            probe_for_setup.clone(),
        ))
        .map_err(|e| -> Box<dyn std::error::Error> {
            tracing::error!(error = %e, "helix 引擎装配失败");
            e.into()
        })?;

        app.manage(AppState {
            tick_tx,
            ctx: ctx_for_setup,
            probe: probe_for_setup,
        });
        Ok(())
    });

    // 命令集：`webdriver` feature 多挂 `set_uc`（录放/认领专用），release 不带（守 §2.4）。
    // generate_handler! 的返回闭包类型不透明 → cfg 分支各自调 .invoke_handler，不抽函数。
    #[cfg(feature = "webdriver")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        commands::im_send,
        commands::im_ready,
        commands::set_uc
    ]);
    #[cfg(not(feature = "webdriver"))]
    let builder =
        builder.invoke_handler(tauri::generate_handler![commands::im_send, commands::im_ready]);

    builder
        .run(tauri::generate_context!())
        .expect("error while running loopforge tauri application");
}
