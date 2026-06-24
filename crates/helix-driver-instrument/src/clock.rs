//! `Clock` 装饰器 —— 回放确定性要素之一（时钟）。
//!
//! - Live：直接 inner。
//! - Record：inner + 录进 tape。
//! - Replay：从 tape 供（helix 内部 timer 才能字节级复现）。
//!
//! `Clock: Clone`，故 `Recording<C>` 需 clone-able（[`Recording`] derive(Clone) 在 `C: Clone` 时成立）。

use helix_core::ports::Clock;

use crate::mode::Mode;
use crate::recording::Recording;

impl<C: Clock> Clock for Recording<C> {
    fn now_ms(&self) -> u64 {
        match self.ctx.mode() {
            Mode::Replay => self.ctx.with_tape(|t| t.next_clock()),
            mode => {
                let ms = self.inner.now_ms();
                if mode == Mode::Record {
                    self.ctx.with_tape(|t| t.record_clock(ms));
                }
                ms
            }
        }
    }
}
