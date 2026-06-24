//! helix 引擎装配（src-tauri 组装根）。
//!
//! 与 helix-host-cli `main.rs` 同构（参照实现），唯一区别在最外层 I/O 边界：
//! host-cli = stdin/stdout；本壳 = Tauri IPC（前端 invoke / `im:__bus__` emit）。
//! 中间 `ExecutionShell + ImModule + ports` 完全一致（host-cli CLAUDE.md「身份定位」）。
//!
//! ## 仪表化落点（W1 现实边界）
//!
//! native `EngineConfig` 字段是**具体** ports（`NativeStorage`/`NativeHttp`/`NativeEventSink`），
//! 非泛型 → **不能**把 `Recording<P>` 直接塞进引擎（那需改 helix，违零改铁律）。故 W1 仪表化
//! 只在**可观测且零改**的一面落地：投影面（facet ②）在 broadcast 消费 loop（emit 抵达
//! `app.emit` 之前）tee 一条 `Facet::Projection` 日志。Transport/Http/Storage/Clock/IdSource
//! 的 Record/Replay tape 需引擎接受被装饰 port（driver-host BatchSink 泛型缝），属后续集成项
//! （见 lib.rs 头注 + 任务 integration_todos）。

use std::sync::Arc;

use helix_core::effect::TransportId;
use helix_core::ports::Transport;
use helix_core::{ExecutionShell, Tick};
use helix_driver_instrument::{Facet, Hop, InstrumentCtx};
use helix_driver_native::{
    bus_event_name, run_engine_loop_with_transports, to_bus_envelope, AuthTokenRegistry,
    EngineConfig, HostNetworkConfig, NativeEventSink, NativeHttp, NativeStorage, NativeTransport,
    RecvOutcome, SharedHttpClient, TransportTable, BUS_CHANNEL,
};
use helix_im::module::ImConfig;
use helix_im::ImModule;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, oneshot};

use crate::config;
use crate::state::ReadinessProbe;

/// env 读取小工具（host 是 ambient API 合法落点；本壳与 host 同级）。
///
/// 用于**非 creds/端点**的静态默认（appType/device/language/...）；身份与端点真源走
/// `config::load()`（profile 文件），不再散落 env（见 `config.rs` 模块头注）。
fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// 装配并 spawn helix 引擎泵 + bus→app.emit 桥。返回进泵的 `tick_tx`（命令注入口）。
///
/// 失败（ports 构造/DB 打开）→ 返回 `Err`，由 lib.rs 决定是否中止 app 启动。
pub async fn spawn(
    app: AppHandle,
    ctx: InstrumentCtx,
    probe: Arc<ReadinessProbe>,
) -> Result<mpsc::Sender<Tick>, String> {
    // ── 部署配置（profile 文件真源；creds/端点不再散落 env）────────────────────────
    // debug→dev-local / release→prod；config/active-profile 可覆盖（见 config.rs）。
    let (profile_name, profile) = config::load()?;
    tracing::info!(%profile_name, "已加载 profile 配置");

    let ws_url = profile.ws_url.clone();
    let api_base_url = profile.api_base.clone();
    let cookie_id = profile.cookie_id.clone();
    let company_id = profile.company_id.clone();
    // 身份非 creds 的静态默认仍走 env（appType/device/language/...，非端点/凭据）。
    let app_type = env_or("HELIX_APP_TYPE", "bct");
    let device = env_or("HELIX_DEVICE", "IOS");
    // deviceId 真源 = profile；为空（pre/prod 待真鉴权注入）时本壳不编造 → 留空跳过。
    let device_id = profile.device_id.clone();
    let language = env_or("HELIX_LANGUAGE", "zh");
    let app_version = env_or("HELIX_APP_VERSION", "1.2.56");
    let os_version = env_or("HELIX_OS_VERSION", "macos-14.5.0");
    let user_name = env_or("HELIX_USER_NAME", "");
    let org_name = env_or("HELIX_ORG_NAME", "");
    let dept_name = env_or("HELIX_DEPT_NAME", "");
    // DB：HELIX_DB 覆盖 > /tmp 兜底（多租户派生路径留后续，W1 先跑起来）。
    let db_path = env_or("HELIX_DB", "/tmp/loopforge-im.db");

    tracing::info!(%ws_url, %api_base_url, cookie_id_present = !cookie_id.is_empty(), "loopforge 引擎装配开始");

    // ── Storage（open 内含通用 migrate；IM 业务 schema additive 叠加）─────────────
    let storage = NativeStorage::open(&format!("sqlite:{db_path}?mode=rwc"))
        .await
        .map_err(|e| format!("打开存储失败 {db_path}：{e}"))?;
    {
        let mut ok = 0usize;
        let total = helix_im::IM_SCHEMA.len();
        for sql in helix_im::IM_SCHEMA {
            match storage.execute_raw(sql).await {
                Ok(()) => ok += 1,
                Err(e) => tracing::error!(error = %e, "建 IM 表失败（继续）"),
            }
        }
        tracing::info!(ok, total, "IM schema 建表完成");
    }

    // ── EventSink（先于 HTTP：横切层 401/断网回报经它 emit）──────────────────────
    let (event_sink, event_rx) = NativeEventSink::new();

    // ── HTTP（出站横切层：token 注入 + 401/断网 emit + traceparent 透传）──────────
    let auth = AuthTokenRegistry::new();
    if !cookie_id.is_empty() {
        auth.set_session("cookieId", cookie_id.clone());
    }
    let net_config = HostNetworkConfig::new(api_base_url.clone(), ws_url.clone());
    let shared_client =
        SharedHttpClient::new(net_config).map_err(|e| format!("构造 HTTP client 失败：{e}"))?;
    let http = NativeHttp::with_crosscut(shared_client, Arc::new(event_sink.clone()), auth);

    // 身份头单一真源（HTTP 全局头 + WS 握手头同源）。空值跳过（不编造）。
    let identity_headers: Vec<(&str, &str)> = [
        ("cookieId", cookie_id.as_str()),
        ("companyId", company_id.as_str()),
        ("appType", app_type.as_str()),
        ("device", device.as_str()),
        ("language", language.as_str()),
        ("deviceId", device_id.as_str()),
        ("appVersion", app_version.as_str()),
        ("osVersion", os_version.as_str()),
    ]
    .into_iter()
    .filter(|(_, v)| !v.is_empty())
    .collect();
    for (name, value) in &identity_headers {
        if let Err(e) = http.set_global_header(name, value).await {
            tracing::warn!(error = %e, header = %name, "注入 HTTP 全局头失败（继续）");
        }
    }

    // ── shell + IM 模块 ──────────────────────────────────────────────────────────
    let mut shell = ExecutionShell::new();
    shell.register(ImModule::new(ImConfig {
        ws_url: ws_url.clone(),
        api_base_url,
        auth_user_id: cookie_id.clone(),
        company_id: company_id.clone(),
        user_name,
        org_name,
        dept_name,
        ..Default::default()
    }));

    // ── tick 通道（入站有界 cap=256，与 host-cli 一致）─────────────────────────────
    let (tick_tx, tick_rx) = mpsc::channel::<Tick>(256);

    // ── 主 WS transport（身份头随握手带）──────────────────────────────────────────
    let main_transport = TransportId::from_raw(0);
    let ws_headers: Vec<(String, String)> = identity_headers
        .iter()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    let mut transport =
        NativeTransport::new(ws_url.clone(), main_transport, Some(tick_tx.clone()))
            .with_handshake_headers(ws_headers);
    match transport.connect().await {
        Ok(()) => tracing::info!(transport_id = main_transport.raw(), "主 WS 已连接"),
        Err(e) => tracing::error!(error = %e, "主 WS 连接失败——仍进泵，Send 走 warn 兜底"),
    }
    let mut transports = TransportTable::new();
    transports.insert(main_transport, Arc::new(transport));

    let max_http_inflight = std::env::var("HELIX_HTTP_MAX_INFLIGHT")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(8);

    let config = EngineConfig {
        storage,
        http,
        event_sink,
        max_http_inflight,
    };

    // ── bus → app.emit 桥 + 投影面 tee + 就绪 probe（消费 broadcast）──────────────
    spawn_bus_bridge(app, ctx, probe, event_rx);

    // ── 跑泵 ──────────────────────────────────────────────────────────────────────
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let tick_tx_for_loop = tick_tx.clone();
    tokio::spawn(async move {
        tracing::info!("进入 helix engine loop");
        run_engine_loop_with_transports(
            shell,
            tick_rx,
            tick_tx_for_loop,
            config,
            shutdown_rx,
            transports,
        )
        .await;
        tracing::info!("helix engine loop 退出");
    });

    Ok(tick_tx)
}

/// 投影面静默窗口（ms）：bus 流里 increment 流动后，连续无新事件超此窗口 → 判就绪。
///
/// 用「bus 静默」近似 CLAUDE.md §3 三条件（increment_end + inflight==0 + cursor 稳）：
/// increment 流动起来后没有新 bus 事件 = 增量收尾 + 出站回灌已落（间接）。**非精确 inflight**
/// （精确需 Http 装饰器注入引擎，见模块头注），故取保守窗口，不冒充精确计数。
const QUIESCE_WINDOW_MS: u64 = 1500;

/// 消费 EventSink broadcast：① 投影面 tee 日志（facet ②）② `app.emit(im:__bus__)` 透传前端
/// ③ 喂就绪 probe（increment 计数 + 静默窗口）。
///
/// 单一消费 task：lagged 不静默（E7，`RecvOutcome::Lagged` → emit resync 信号）。
fn spawn_bus_bridge(
    app: AppHandle,
    ctx: InstrumentCtx,
    probe: Arc<ReadinessProbe>,
    rx: tokio::sync::broadcast::Receiver<helix_core::effect::DomainEventBytes>,
) {
    let mut obs = helix_driver_native::EventReceiver::new(rx);
    tokio::spawn(async move {
        loop {
            // 静默窗口：带超时收。超时 = 一段时间无新 bus 事件。
            let next = tokio::time::timeout(
                std::time::Duration::from_millis(QUIESCE_WINDOW_MS),
                obs.recv(),
            )
            .await;
            match next {
                // 超时：若 increment 已流动过 → 静默达成 → 置就绪。
                Err(_elapsed) => {
                    if probe.increment_seen() > 0 && !probe.is_ready() {
                        probe.set_ready(true);
                        tracing::info!("就绪 probe：静默窗口达成（increment 流动后静默）→ ready");
                    }
                }
                Ok(RecvOutcome::Event(ev)) => {
                    // facet ② 投影面：emit 抵达 app.emit 之前 tee 一条结构化日志。
                    if let Some(name) = bus_event_name(&ev) {
                        ctx.log(
                            Facet::Projection,
                            Hop::Projection,
                            helix_driver_instrument::util::payload_from_bytes(&ev.0),
                        );
                        if name.contains("increment") {
                            probe.note_increment();
                        }
                    }
                    // im:__bus__ 信封透传前端（单总线，前端 dispatcher 按 event 名分发）。
                    let envelope = to_bus_envelope(&ev);
                    if let Err(e) = app.emit(BUS_CHANNEL, &envelope) {
                        tracing::warn!(error = %e, "app.emit(im:__bus__) 失败");
                    }
                }
                Ok(RecvOutcome::Lagged(n)) => {
                    tracing::warn!(dropped = n, "EventSink 落后丢事件 → emit resync 信号");
                    let _ = app.emit("im:sync:resync_needed", n);
                }
                Ok(RecvOutcome::Closed) => {
                    tracing::info!("EventSink 流结束，bus 桥退出");
                    break;
                }
            }
        }
    });
}
