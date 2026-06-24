//! 装饰器共享上下文：mode + 日志 sink + tape，cheap-clone（Arc 背书），所有 port 装饰器共用一个。
//!
//! 锁纪律（关键）：`with_tape` / `log` 内只做同步读写，**绝不跨 .await 持锁**
//! （装饰器在 async fn 里先 `log`/`with_tape` 取值、释放锁，再 `await` inner）。

use std::sync::{Arc, Mutex};

use serde_json::Value;

use crate::event::{extract_corr_key, Facet, Hop, HopEvent};
use crate::log_sink::LogSink;
use crate::mode::Mode;
use crate::tape::Tape;

/// 静默/就绪期的伪 UC id（CLAUDE.md §3：窗口外帧不归任何真 UC）。
pub const QUIESCENCE_UC: &str = "__quiescence__";

#[derive(Clone)]
pub struct InstrumentCtx {
    inner: Arc<CtxInner>,
}

struct CtxInner {
    run_id: String,
    uc: Mutex<String>,
    mode: Mode,
    log: LogSink,
    tape: Mutex<Tape>,
}

impl InstrumentCtx {
    pub fn new(run_id: impl Into<String>, mode: Mode, log: LogSink, tape: Tape) -> Self {
        Self {
            inner: Arc::new(CtxInner {
                run_id: run_id.into(),
                uc: Mutex::new(QUIESCENCE_UC.to_string()),
                mode,
                log,
                tape: Mutex::new(tape),
            }),
        }
    }

    /// Live 模式便捷构造（空 tape）。
    pub fn live(run_id: impl Into<String>, log: LogSink) -> Self {
        Self::new(run_id, Mode::Live, log, Tape::new())
    }

    pub fn mode(&self) -> Mode {
        self.inner.mode
    }

    /// harness 在每个 UC 前 set；静默期保持 [`QUIESCENCE_UC`]。
    pub fn set_uc(&self, uc: impl Into<String>) {
        *self.inner.uc.lock().expect("uc mutex poisoned") = uc.into();
    }

    pub fn uc(&self) -> String {
        self.inner.uc.lock().expect("uc mutex poisoned").clone()
    }

    /// 锁 tape 做一次同步操作（**调用方禁止在返回值上跨 await 持锁**）。
    pub fn with_tape<R>(&self, f: impl FnOnce(&mut Tape) -> R) -> R {
        let mut g = self.inner.tape.lock().expect("tape mutex poisoned");
        f(&mut g)
    }

    /// 落一条 hop 日志（自动抽 corr_key + 单调 seq）。
    pub fn log(&self, facet: Facet, hop: Hop, payload: Value) {
        let ev = HopEvent {
            run_id: self.inner.run_id.clone(),
            uc_id: self.uc(),
            corr_key: extract_corr_key(&payload),
            facet,
            hop,
            seq: self.inner.log.next_seq(),
            payload,
        };
        self.inner.log.emit(&ev);
    }

    /// 把当前 tape 存盘（Record 跑完后调用）。
    pub fn save_tape(&self, path: impl AsRef<std::path::Path>) -> std::io::Result<()> {
        self.with_tape(|t| t.save(path))
    }
}
