//! `Recording<P>` —— 装饰任意 port P 的统一外壳。trait 实现分散在各 port 模块
//! （transport.rs / http.rs / storage.rs / clock.rs / id.rs）。
//!
//! 同一 [`InstrumentCtx`] 被所有 port 装饰器共享（一个 run 一份 mode/log/tape）。

use crate::ctx::InstrumentCtx;

/// 包在某个真实 port 外面的录放装饰器。
///
/// - `inner`：真实 port（native 的 `NativeTransport`/`NativeHttp`/… 或测试 fake）。
/// - `ctx`：共享上下文（mode/log/tape）。
///
/// `Clone` 仅在 `P: Clone` 时可用（`Clock` 要求 `Clone`，故 `Recording<C>` 需 clone-able）。
#[derive(Clone)]
pub struct Recording<P> {
    pub(crate) inner: P,
    pub(crate) ctx: InstrumentCtx,
}

impl<P> Recording<P> {
    pub fn new(inner: P, ctx: InstrumentCtx) -> Self {
        Self { inner, ctx }
    }

    /// 取回内层 port（拆装饰）。
    pub fn into_inner(self) -> P {
        self.inner
    }

    pub fn ctx(&self) -> &InstrumentCtx {
        &self.ctx
    }
}
