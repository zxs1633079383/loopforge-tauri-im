//! `TeeTickSender` —— 进引擎指令面（facet `inbound`）的 tee 装饰器（P0b 6 面 oracle·test-only）。
//!
//! 包在 `im_*` 命令持有的 `mpsc::Sender<Tick>` 外层（AppState.tick_tx）：每条 `Tick::Command`
//! 进引擎泵之前，旁路落一条 `Facet::Inbound` 日志 `{command, args}`——与 src-tauri command 层的
//! `Facet::IpcIn`（壳收到的原始 invoke 入参）配对，量化 C013 纯壳不变量（IpcIn.args ≡ Inbound.args）。
//!
//! ## 唯一新缝 / helix 引擎零改（守 invariant #1 / C001）
//!
//! 这是「command-dispatch port」的装饰器：引擎经 `mpsc` tick 通道收指令，本 tee 包在**壳侧**
//! 的发送端（不碰 helix-core/helix-im/helix-driver-native）。WS 入站再注入用的是引擎内部的
//! 另一份 `tick_tx` clone（engine::spawn 留用），**不**经本 tee——故只捕获 IPC 派发的指令，正是
//! 纯壳不变量要对账的「壳→helix」那一跳。
//!
//! ## test-only（守 invariant #4·dev/release 零影响）
//!
//! Inbound tee 调用走 `#[cfg(feature = "webdriver")]` 闸（默认开·release 出货
//! `--no-default-features` 去掉·与 set_uc/录放同一 gate）：release 构建产物无 `log_inbound` 符号，
//! `send` 退化为对内层 `mpsc::Sender` 的纯透传。

use helix_core::Tick;
use helix_driver_host::{CommandTraceQueue, TraceCarrier};
#[cfg(feature = "webdriver")]
use helix_driver_instrument::util::payload_from_bytes;
use helix_driver_instrument::InstrumentCtx;
use tokio::sync::mpsc;

/// 包在 `mpsc::Sender<Tick>` 外的 tee 装饰器。`send` 签名与内层一致——55 个命令的
/// `state.tick_tx.send(tick).await.map_err(..)` 调用点零改透明替换。
#[derive(Clone)]
pub struct TeeTickSender {
    inner: mpsc::Sender<Tick>,
    command_traces: CommandTraceQueue,
    /// 仪表上下文（仅 webdriver feature 下 Inbound tee 用）。
    #[cfg(feature = "webdriver")]
    ctx: InstrumentCtx,
}

impl TeeTickSender {
    /// 包装内层发送端。`ctx` 仅 webdriver feature 下保留（release 丢弃 → 无仪表残留）。
    #[cfg(feature = "webdriver")]
    pub fn new(
        inner: mpsc::Sender<Tick>,
        ctx: InstrumentCtx,
        command_traces: CommandTraceQueue,
    ) -> Self {
        Self {
            inner,
            command_traces,
            ctx,
        }
    }

    /// release 形态：不保留 ctx（Inbound tee 不编入）。
    #[cfg(not(feature = "webdriver"))]
    pub fn new(
        inner: mpsc::Sender<Tick>,
        _ctx: InstrumentCtx,
        command_traces: CommandTraceQueue,
    ) -> Self {
        Self {
            inner,
            command_traces,
        }
    }

    /// 入泵（与 `mpsc::Sender::send` 同签名）。webdriver feature 下对 `Tick::Command` 旁路 tee
    /// `Facet::Inbound {command, args}`，再透传内层；release 纯透传。
    pub async fn send(&self, tick: Tick) -> Result<(), mpsc::error::SendError<Tick>> {
        self.send_with_trace(tick, None).await
    }

    /// 入泵并携带与该 command 对齐的 trace sidecar。失败时回滚队列槽，避免下一条
    /// `Tick::Command` 误消费本次 trace。
    pub async fn send_with_trace(
        &self,
        tick: Tick,
        trace: Option<TraceCarrier>,
    ) -> Result<(), mpsc::error::SendError<Tick>> {
        #[cfg(feature = "webdriver")]
        if let Tick::Command(ref cmd) = tick {
            // args = payload bytes 解析回 JSON（reducer 纯壳不变量逐字段比对·casing 归一在 reducer）。
            self.ctx
                .log_inbound(&cmd.name, payload_from_bytes(&cmd.payload));
        }
        let is_command = matches!(tick, Tick::Command(_));
        if is_command {
            self.command_traces.push_slot(trace);
        }
        match self.inner.send(tick).await {
            Ok(()) => Ok(()),
            Err(error) => {
                if is_command {
                    self.command_traces.rollback_last();
                }
                Err(error)
            }
        }
    }
}
