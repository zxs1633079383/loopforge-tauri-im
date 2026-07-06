//! helix 引擎装配（src-tauri 组装根）。
//!
//! 与 helix-host-cli `main.rs` 同构（参照实现），唯一区别在最外层 I/O 边界：
//! host-cli = stdin/stdout；本壳 = Tauri IPC（前端 invoke / `im:__bus__` emit）。
//! 中间 `ExecutionShell + ImModule + ports` 完全一致（host-cli CLAUDE.md「身份定位」）。
//!
//! ## 组装根走 host 泛型壳（①④ rewire · ①④ 接通真源）
//!
//! 不再走 native 的**具体** `EngineConfig` / `run_engine_loop_with_transports`（那条路把
//! `event_sink`/`storage`/`http`/`transport` 写死成裸 `Native*`，装饰器 `Recording<P>` 注不进去
//! → 出站 HTTP body（facet①）+ 落库（facet④）无观测点）。改直连 **`helix_driver_host::run_engine_loop`
//! （泛型 over S/H/E/Tr/C）** + 自建 `EngineDeps`，把全 port 包上装饰器（external-host-instrumentation
//! -recipe 路径 A：纯增量集成，helix 引擎零改）：
//!
//! | facet | port | 装饰 |
//! |---|---|---|
//! | ① HTTP body | `HttpRequester` | `Recording<NativeHttp>`（tee 请求 + Record/Replay）|
//! | ① WS 帧 + 入站录放 | `Transport` | `Recording<NativeTransport>`（send tee + Replay 供 recv）|
//! | ④ 落库行 | `Storage` | `Recording<NativeStorage>`（tee {op,table,rows}）|
//! | 确定性时钟 | `Clock` | `Recording<NativeClock>`（Record 录 / Replay 供）|
//! | ② 投影 envelope | `EventSink`(+`BatchSink`) | **`helix_driver_host::RecordingSink<NativeEventSink>`** |
//!
//! 投影面（facet②）的特别说明：引擎 `E` bound 的是 host 本地 `BatchSink`（`EventSink` 的
//! supertrait），本仓 `Recording<E>` 只 impl `EventSink` 装不进引擎；故投影面改用 A 落地的
//! `RecordingSink<NativeEventSink>`（同时 impl `EventSink`+`BatchSink`），它在 `emit` 旁路喂
//! 我们的录放回调（facet② tee），再透传给内层 `NativeEventSink`（broadcast egress 不变）。
//! 投影面**唯一** tee 落点收敛到这里——bus 桥不再重复 `ctx.log(Projection)`（防双计），只留
//! `app.emit(im:__bus__)` + 就绪 probe。
//!
//! ## IdSource/Random 无引擎注入缝（诚实记录）
//!
//! `EngineDeps` 只有 `clock` 一个时间/确定性注入点；core 的 `IdSource`/`Random` **不经引擎泵**
//! （无 Effect、dispatch 不处理、`EngineDeps` 无字段）。故 tape 对 id/random 的字节级确定性需
//! core 侧接线，当前不可达——本壳只接 `Clock` 装饰（tape 时钟确定性）。这是真缝边界，不编造。

use std::sync::Arc;

use helix_core::effect::TransportId;
use helix_core::ports::Transport;
use helix_core::{ExecutionShell, Tick};
use helix_driver_host::{run_engine_loop, EngineDeps, RecordingSink, TransportTable};
use helix_driver_instrument::util::payload_from_bytes;
use helix_driver_instrument::{Facet, Hop, InstrumentCtx, Recording};
use helix_driver_native::{
    bus_event_name, to_bus_envelope, AuthTokenRegistry, HostNetworkConfig, NativeClock,
    NativeEventSink, NativeHttp, NativeStorage, NativeTransport, RecvOutcome, SharedHttpClient,
    BUS_CHANNEL,
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

/// 引擎装配出的本机身份（profile 真源·非 creds 部分）——供需要拼 body 的命令读。
///
/// 当前用途：`im_create_channel`（UC-5.1）拼 `channel/create` body 时，`teamId`/自身 `userId`
/// 取自此单一真源（profile companyId / cookieId），避免前端 TS 硬编 creds（守 src-tauri 纪律 3：
/// 身份单一真源·壳不臆造 body 字段）。
#[derive(Clone, Default)]
pub struct ImIdentity {
    /// team/company id（profile companyId·= channel/create body 的 teamId）。
    pub team_id: String,
    /// 自身用户 id（profile cookieId·= channel/create body 里自己那条 users role=CREATOR 的 id）。
    pub user_id: String,
}

/// 装配并 spawn helix 引擎泵 + bus→app.emit 桥。返回进泵的 `tick_tx`（命令注入口）+ 本机身份。
///
/// 失败（ports 构造/DB 打开）→ 返回 `Err`，由 lib.rs 决定是否中止 app 启动。
pub async fn spawn(
    app: AppHandle,
    ctx: InstrumentCtx,
    probe: Arc<ReadinessProbe>,
) -> Result<(mpsc::Sender<Tick>, ImIdentity), String> {
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
    // 先连裸 NativeTransport（连接是 `&mut self`，预填表路径），连成功后包装饰器 + Arc。
    let main_transport = TransportId::from_raw(0);
    let ws_headers: Vec<(String, String)> = identity_headers
        .iter()
        .map(|(n, v)| (n.to_string(), v.to_string()))
        .collect();
    let mut transport = NativeTransport::new(ws_url.clone(), main_transport, Some(tick_tx.clone()))
        .with_handshake_headers(ws_headers);
    match transport.connect().await {
        Ok(()) => tracing::info!(transport_id = main_transport.raw(), "主 WS 已连接"),
        Err(e) => tracing::error!(error = %e, "主 WS 连接失败——仍进泵，Send 走 warn 兜底"),
    }
    // 装饰：facet① ws 帧（send tee）+ Replay 入站供帧；连接已完成，wrap 后只用 `&self`。
    let recording_transport = Recording::new(transport, ctx.clone());
    let mut transports: TransportTable<Recording<NativeTransport>> = TransportTable::new();
    transports.insert(main_transport, Arc::new(recording_transport));
    // native 走预填表路径：注册通道留空（transport_rx 永不收到句柄，仅对齐泛型壳签名）。
    let (_transport_tx, transport_rx) =
        mpsc::unbounded_channel::<(TransportId, Arc<Recording<NativeTransport>>)>();

    let max_http_inflight = std::env::var("HELIX_HTTP_MAX_INFLIGHT")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(8);

    // ── 全 port 包装饰器，组装泛型 EngineDeps ─────────────────────────────────────
    // facet④ storage（tee {op,table,rows}）/ facet① http（tee 请求体 + Record/Replay）/
    // Clock（tape 时钟确定性）。投影面 event_sink 用 host 的 RecordingSink（impl BatchSink），
    // emit 旁路喂录放器（facet②），内层 NativeEventSink 仍 broadcast → event_rx 不变。
    let recording_storage = Recording::new(storage, ctx.clone());
    let recording_http = Recording::new(http, ctx.clone());
    let recording_clock = Recording::new(NativeClock, ctx.clone());
    let projection_ctx = ctx.clone();
    let recording_sink = RecordingSink::new(
        event_sink,
        Arc::new(move |ev: &helix_core::effect::DomainEventBytes| {
            // facet② 投影：唯一 tee 落点（bus 桥不再重复 log，防双计）。
            projection_ctx.log(
                Facet::Projection,
                Hop::Projection,
                payload_from_bytes(&ev.0),
            );
        }),
    );

    let deps: EngineDeps<
        Recording<NativeStorage>,
        Recording<NativeHttp>,
        RecordingSink<NativeEventSink>,
        Recording<NativeClock>,
    > = EngineDeps {
        storage: Arc::new(recording_storage),
        http: Arc::new(recording_http),
        event_sink: Arc::new(recording_sink),
        clock: recording_clock,
        max_http_inflight,
    };

    // ── bus → app.emit 桥 + 就绪 probe（消费 broadcast；facet② tee 已收敛 RecordingSink）──
    spawn_bus_bridge(app, ctx.clone(), probe, event_rx);

    // ── 跑泵（host 泛型壳，单一 pump 核）───────────────────────────────────────────
    let (_shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let tick_tx_for_loop = tick_tx.clone();
    tokio::spawn(async move {
        tracing::info!("进入 helix engine loop（host 泛型壳 · 全 port 装饰）");
        run_engine_loop(
            shell,
            tick_rx,
            tick_tx_for_loop,
            deps,
            shutdown_rx,
            transports,
            transport_rx,
        )
        .await;
        tracing::info!("helix engine loop 退出");
    });

    let identity = ImIdentity {
        team_id: company_id.clone(),
        user_id: cookie_id.clone(),
    };
    Ok((tick_tx, identity))
}

/// 投影面静默窗口（ms）：bus 流里 increment 流动后，连续无新事件超此窗口 → 判就绪。
///
/// 用「bus 静默」近似 CLAUDE.md §3 三条件（increment_end + inflight==0 + cursor 稳）：
/// increment 流动起来后没有新 bus 事件 = 增量收尾 + 出站回灌已落（间接）。**非精确 inflight**
/// （精确需 Http 装饰器注入引擎，见模块头注），故取保守窗口，不冒充精确计数。
const QUIESCE_WINDOW_MS: u64 = 1500;

/// 消费 EventSink broadcast：① `app.emit(im:__bus__)` 透传前端 ② 喂就绪 probe
/// （increment 计数 + 静默窗口）。
///
/// facet② 投影 tee 日志已**收敛**到 `RecordingSink`（emit 旁路），本桥不再重复 `ctx.log`（防双计）；
/// 这里只做信封透传 + 就绪判定。单一消费 task：lagged 不静默（E7，`RecvOutcome::Lagged` → emit
/// resync 信号）。
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
                    // 就绪 probe：见同步活动计数（facet② tee 已在 RecordingSink 落）。
                    // 「同步活动」= 任意**非连接生命周期**领域事件（im:connection:* 排除）。
                    // 历史踩坑：原判据 name.contains("increment") 与具体投影名耦合——helix
                    // round3→round6 事件改名后无任一事件名含 "increment"（实测仅 im:channels:loaded
                    // / im:post:received / im:channel:created 等），致 increment_seen 恒 0、probe
                    // 永不就绪。改为「收到任意领域事件 → 同步流动起来了」，与投影名解耦，仍守
                    // 可证伪（连接生命周期单独到达不算就绪，须有真实同步事件 + 后续静默）。
                    if let Some(name) = bus_event_name(&ev) {
                        if !name.starts_with("im:connection") {
                            probe.note_increment();
                        }
                    }
                    // im:__bus__ 信封透传前端（单总线，前端 dispatcher 按 event 名分发）。
                    let envelope = to_bus_envelope(&ev);
                    ctx.trace(
                        "pc.tauri.event.emit",
                        "pc.tauri",
                        helix_driver_instrument::TraceDirection::Out,
                        serde_json::json!({
                            "event": BUS_CHANNEL,
                            "payload": payload_from_bytes(&ev.0),
                        }),
                    );
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
