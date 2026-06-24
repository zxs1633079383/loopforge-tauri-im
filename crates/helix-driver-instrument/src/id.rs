//! `IdSource` / `Random` 装饰器 —— 回放确定性要素（id / 随机）。
//!
//! - Live：直接 inner。
//! - Record：inner + 录进 tape。
//! - Replay：从 tape 供（helix 内部 id/jitter 才能字节级复现）。

use helix_core::ports::{IdSource, Random};
use helix_core::PortError;

use crate::mode::Mode;
use crate::recording::Recording;

impl<I: IdSource> IdSource for Recording<I> {
    fn new_uuid(&self) -> Result<[u8; 16], PortError> {
        match self.ctx.mode() {
            Mode::Replay => Ok(self.ctx.with_tape(|t| t.next_id())),
            mode => {
                let id = self.inner.new_uuid()?;
                if mode == Mode::Record {
                    self.ctx.with_tape(|t| t.record_id(id));
                }
                Ok(id)
            }
        }
    }
}

impl<R: Random> Random for Recording<R> {
    fn random_u64(&self, max: u64) -> u64 {
        match self.ctx.mode() {
            Mode::Replay => self.ctx.with_tape(|t| t.next_random(max)),
            mode => {
                let v = self.inner.random_u64(max);
                if mode == Mode::Record {
                    self.ctx.with_tape(|t| t.record_random(v));
                }
                v
            }
        }
    }
}
