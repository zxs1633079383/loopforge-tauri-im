//! `AppState` —— Tauri `manage()` 注入的共享句柄（无全局 static，守骨架范式）。
//!
//! 持有：① 进泵的 `tick_tx`（`im_send` / `set_uc` 经它把 `Tick::Command` 喂引擎）；
//! ② `InstrumentCtx`（仪表上下文，`set_uc` 透传 + 投影面 tee 日志共用同一份）；
//! ③ 就绪 probe 的可读状态（前端轮询 `im_ready`）。

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;

use helix_core::Tick;
use helix_driver_instrument::InstrumentCtx;
use tokio::sync::mpsc;

/// 就绪 probe 的可观测状态（CLAUDE.md §3：increment_end 收齐 + inflight==0 + cursor 稳）。
///
/// W1 以**可观测信号**驱动：bus 流里见到 `im:channel:increment*` 后进入「攒增量」态，
/// 静默窗口（一段时间无新 bus 事件）到达 → 置 ready。**真精确 inflight==0** 需把
/// Http 装饰器注入引擎（当前 native `EngineConfig` 不接受被装饰 port，见 integration_todos），
/// 故此处用「bus 静默」近似，不冒充精确 inflight 计数（守可证伪：不产无凭据的 ready）。
#[derive(Default)]
pub struct ReadinessProbe {
    /// 见过的 `im:channel:increment*` 事件计数（>0 = 增量已开始流动）。
    increment_seen: AtomicU64,
    /// 是否已判定就绪（静默窗口达成）。
    ready: AtomicBool,
}

impl ReadinessProbe {
    pub fn note_increment(&self) {
        self.increment_seen.fetch_add(1, Ordering::Relaxed);
    }

    pub fn increment_seen(&self) -> u64 {
        self.increment_seen.load(Ordering::Relaxed)
    }

    pub fn set_ready(&self, v: bool) {
        self.ready.store(v, Ordering::Relaxed);
    }

    pub fn is_ready(&self) -> bool {
        self.ready.load(Ordering::Relaxed)
    }
}

/// Tauri `manage()` 注入的应用态。`Clone` 廉价（全 `Arc`/channel 句柄）。
#[derive(Clone)]
pub struct AppState {
    /// 进泵的 tick 发送端（命令注入入口，与 WS 入站同一条泵，串行进 core）。
    pub tick_tx: mpsc::Sender<Tick>,
    /// 仪表上下文（set_uc 透传 + 投影面日志共用）。
    /// 无 webdriver feature 时仅 `set_uc` 之外无读者 → allow dead_code（投影面 tee 用的是
    /// engine::spawn 收到的同一份 clone，不经此字段）。
    #[cfg_attr(not(feature = "webdriver"), allow(dead_code))]
    pub ctx: InstrumentCtx,
    /// 就绪 probe 状态。
    pub probe: Arc<ReadinessProbe>,
}
