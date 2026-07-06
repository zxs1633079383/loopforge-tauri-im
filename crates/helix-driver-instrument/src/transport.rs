//! `Transport` 装饰器 —— facet ①（出站帧）+ 入站帧录放。
//!
//! - Live/Record：透传真 go；send tee facet①；recv tee + Record 存 tape。
//! - Replay：connect/close/send 不碰网络（send 仍 tee facet① 供断言）；recv 从 tape 供。

use async_trait::async_trait;
use bytes::Bytes;
use helix_core::ports::Transport;
use helix_core::PortError;

use crate::event::{Facet, Hop};
use crate::mode::Mode;
use crate::recording::Recording;
use crate::TraceDirection;
use crate::util::payload_from_bytes;

#[cfg_attr(not(target_arch = "wasm32"), async_trait)]
#[cfg_attr(target_arch = "wasm32", async_trait(?Send))]
impl<T: Transport> Transport for Recording<T> {
    async fn connect(&mut self) -> Result<(), PortError> {
        self.ctx.trace(
            "helix.ws.connect",
            "helix",
            TraceDirection::Out,
            serde_json::json!({"op": "connect", "mode": format!("{:?}", self.ctx.mode())}),
        );
        self.ctx.log(
            Facet::Outbound,
            Hop::Lifecycle,
            serde_json::json!({"op": "connect", "mode": format!("{:?}", self.ctx.mode())}),
        );
        match self.ctx.mode() {
            Mode::Replay => Ok(()), // 回放不建真连接
            _ => self.inner.connect().await,
        }
    }

    async fn send(&self, frame: Bytes) -> Result<(), PortError> {
        // facet ① 出站帧：所有模式都 tee（回放期也要断言 helix 发了什么）。
        let payload = payload_from_bytes(&frame);
        self.ctx
            .trace("helix.ws.send", "helix", TraceDirection::Out, payload.clone());
        self.ctx.log(Facet::Outbound, Hop::WsSend, payload);
        match self.ctx.mode() {
            Mode::Replay => Ok(()), // 回放不真发
            _ => self.inner.send(frame).await,
        }
    }

    async fn recv(&self) -> Result<Option<Bytes>, PortError> {
        match self.ctx.mode() {
            Mode::Replay => {
                // 从 tape 取下一帧（锁内取值后即释放，不跨 await）。
                let next = self.ctx.with_tape(|t| t.next_inbound());
                if let Some(b) = &next {
                    let payload = payload_from_bytes(b);
                    self.ctx
                        .trace("helix.ws.recv", "helix", TraceDirection::In, payload.clone());
                    self.ctx.log(Facet::WsRecv, Hop::WsRecv, payload);
                }
                Ok(next)
            }
            mode => {
                let frame = self.inner.recv().await?;
                if let Some(b) = &frame {
                    let payload = payload_from_bytes(b);
                    self.ctx
                        .trace("helix.ws.recv", "helix", TraceDirection::In, payload.clone());
                    self.ctx.log(Facet::WsRecv, Hop::WsRecv, payload);
                    if mode == Mode::Record {
                        self.ctx.with_tape(|t| t.record_inbound(b));
                    }
                }
                Ok(frame)
            }
        }
    }

    async fn close(&self) -> Result<(), PortError> {
        self.ctx.trace(
            "helix.ws.close",
            "helix",
            TraceDirection::Out,
            serde_json::json!({"op": "close"}),
        );
        self.ctx
            .log(Facet::Outbound, Hop::Lifecycle, serde_json::json!({"op": "close"}));
        match self.ctx.mode() {
            Mode::Replay => Ok(()),
            _ => self.inner.close().await,
        }
    }
}
