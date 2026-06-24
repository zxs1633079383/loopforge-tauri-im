//! `EventSink` 装饰器 —— facet ②（投影 envelope）。
//!
//! 所有模式都只 tee 日志 + 透传（投影由 helix 产出，装饰器只观察，不录不放）。
//! 在 emit 抵达 Tauri `app.emit` 之前就抓到 —— 比在 IPC 层抓更早更全。

use helix_core::effect::DomainEventBytes;
use helix_core::ports::EventSink;

use crate::event::{Facet, Hop};
use crate::recording::Recording;
use crate::util::payload_from_bytes;

impl<E: EventSink> EventSink for Recording<E> {
    fn emit(&self, event: DomainEventBytes) {
        // facet ② 投影：log 在 move 进 inner 之前（借 &event.0）。
        self.ctx
            .log(Facet::Projection, Hop::Projection, payload_from_bytes(&event.0));
        self.inner.emit(event);
    }
}
