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
use crate::trace_event::{TraceDirection, TraceEmitter, TraceEvent};

/// 静默/就绪期的伪 UC id（CLAUDE.md §3：窗口外帧不归任何真 UC）。
pub const QUIESCENCE_UC: &str = "__quiescence__";

/// bootstrap UC 环境变量名。UC-4.1（hello 全量增量「就绪根」）的自驱增量在 app 启动即流过——
/// 早于 e2e before-hook 的 `set_uc('UC-4.1')` → 默认全归 `__quiescence__`，reducer 按 uc_id 过滤
/// 抽空 → ②④ 永红（非数据缺陷·是 set_uc 时序晚于 hello 的机器件归属问题）。
/// run.sh 跑 UC-4.1 spec 时 export `LOOPFORGE_BOOTSTRAP_UC=UC-4.1`，使 bootstrap hello hop 归 UC-4.1；
/// 其余 UC 不设此 env → 仍默认 `__quiescence__`（不污染发送族窗口语义）。
pub const BOOTSTRAP_UC_ENV: &str = "LOOPFORGE_BOOTSTRAP_UC";

/// 一次性 HTTP 失败注入的 URL suffix 环境变量名。
pub const HTTP_FAIL_ONCE_URL_SUFFIX_ENV: &str = "LOOPFORGE_FAIL_HTTP_ONCE_URL_SUFFIX";

/// 读 bootstrap UC（env `LOOPFORGE_BOOTSTRAP_UC`，缺省 [`QUIESCENCE_UC`]）。
fn bootstrap_uc() -> String {
    std::env::var(BOOTSTRAP_UC_ENV)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| QUIESCENCE_UC.to_string())
}

fn http_fail_once_url_suffix() -> Option<String> {
    std::env::var(HTTP_FAIL_ONCE_URL_SUFFIX_ENV)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

#[derive(Clone)]
pub struct InstrumentCtx {
    inner: Arc<CtxInner>,
}

struct CtxInner {
    run_id: String,
    uc: Mutex<String>,
    mode: Mode,
    log: LogSink,
    trace: Option<TraceEmitter>,
    tape: Mutex<Tape>,
    http_fail_once_url_suffix: Mutex<Option<String>>,
}

impl InstrumentCtx {
    pub fn new(run_id: impl Into<String>, mode: Mode, log: LogSink, tape: Tape) -> Self {
        Self {
            inner: Arc::new(CtxInner {
                run_id: run_id.into(),
                uc: Mutex::new(bootstrap_uc()),
                mode,
                log,
                trace: None,
                tape: Mutex::new(tape),
                http_fail_once_url_suffix: Mutex::new(http_fail_once_url_suffix()),
            }),
        }
    }

    /// Live 模式便捷构造（空 tape）。
    pub fn live(run_id: impl Into<String>, log: LogSink) -> Self {
        Self::new(run_id, Mode::Live, log, Tape::new())
    }

    pub fn with_trace(mut self, trace: TraceEmitter) -> Self {
        Arc::get_mut(&mut self.inner)
            .expect("with_trace must be called before cloning InstrumentCtx")
            .trace = Some(trace);
        self
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

    /// 取一次性 HTTP failpoint：URL 以配置 suffix 结尾时消费并返回该 suffix。
    pub fn take_http_failpoint_for(&self, url: &str) -> Option<String> {
        let mut suffix = self
            .inner
            .http_fail_once_url_suffix
            .lock()
            .expect("http failpoint mutex poisoned");
        let matched = suffix.as_ref().filter(|s| url.ends_with(s.as_str()))?;
        let matched = matched.clone();
        *suffix = None;
        Some(matched)
    }

    /// 锁 tape 做一次同步操作（**调用方禁止在返回值上跨 await 持锁**）。
    pub fn with_tape<R>(&self, f: impl FnOnce(&mut Tape) -> R) -> R {
        let mut g = self.inner.tape.lock().expect("tape mutex poisoned");
        f(&mut g)
    }

    /// P0b ⓪ IpcIn tee（test-only）：src-tauri command 层落「壳收到的原始 invoke 入参」。
    ///
    /// payload 形态固定 `{command, args}`——reducer 纯壳不变量比对 IpcIn.args ≡ Inbound.args
    /// （6-facet-oracle §3）。corr_key 由 [`extract_corr_key`] 探 `.args` 抽（与发送束聚同束）。
    pub fn log_ipc_in(&self, command: &str, args: Value) {
        self.log(
            Facet::IpcIn,
            Hop::IpcIn,
            serde_json::json!({ "command": command, "args": args }),
        );
    }

    /// 进引擎指令 tee（test-only）：command-dispatch 装饰器落「进引擎泵的指令」。
    ///
    /// 与 [`log_ipc_in`](Self::log_ipc_in) 同 `{command, args}` 形态，配对量化 C013 纯壳不变量。
    pub fn log_inbound(&self, command: &str, args: Value) {
        self.log(
            Facet::Inbound,
            Hop::Inbound,
            serde_json::json!({ "command": command, "args": args }),
        );
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

    pub fn trace(
        &self,
        name: &str,
        layer: &str,
        direction: TraceDirection,
        payload: Value,
    ) {
        self.trace_with_ids(name, layer, direction, None, payload);
    }

    pub fn trace_with_ids(
        &self,
        name: &str,
        layer: &str,
        direction: TraceDirection,
        traceparent: Option<&str>,
        payload: Value,
    ) {
        let Some(emitter) = self.inner.trace.as_ref() else {
            return;
        };
        let mut ev = TraceEvent::new(
            emitter.run_id().to_string(),
            name.to_string(),
            layer.to_string(),
            direction,
            payload.clone(),
        );
        ev.corr_key = extract_corr_key(&payload);
        if let Some(tp) = traceparent {
            if let Some((trace_id, parent_span_id)) = parse_traceparent_ids(tp) {
                ev.trace_id = Some(trace_id);
                ev.parent_span_id = Some(parent_span_id);
                ev.span_id = Some(emitter.next_span_id());
            }
        }
        emitter.emit(ev);
    }

    /// 把当前 tape 存盘（Record 跑完后调用）。
    pub fn save_tape(&self, path: impl AsRef<std::path::Path>) -> std::io::Result<()> {
        self.with_tape(|t| t.save(path))
    }
}

fn parse_traceparent_ids(traceparent: &str) -> Option<(String, String)> {
    let mut parts = traceparent.trim().split('-');
    let version = parts.next()?;
    let trace_id = parts.next()?;
    let span_id = parts.next()?;
    let flags = parts.next()?;
    if parts.next().is_some()
        || version.len() != 2
        || trace_id.len() != 32
        || span_id.len() != 16
        || flags.len() != 2
    {
        return None;
    }
    Some((trace_id.to_string(), span_id.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::log_sink::LogSink;
    use serde_json::json;

    /// 构造一个 in-memory LogSink 背书的 ctx，跑闭包后取回写出的行。
    fn capture(f: impl FnOnce(&InstrumentCtx)) -> Vec<serde_json::Value> {
        let (sink, buf) = LogSink::in_memory();
        let ctx = InstrumentCtx::new("r-test", Mode::Live, sink, Tape::new());
        ctx.set_uc("UC-test");
        f(&ctx);
        buf.lines()
            .iter()
            .map(|l| serde_json::from_str::<serde_json::Value>(l).expect("行须为合法 JSON"))
            .collect()
    }

    #[test]
    fn log_ipc_in_emits_facet_and_payload() {
        // P0b ⓪ 装饰器单测：log_ipc_in 落 facet=ipc-in / hop=ipc-in / payload={command,args}。
        let rows = capture(|ctx| {
            ctx.log_ipc_in(
                "im_send",
                json!({"channelId": "c1", "temporaryId": "t9", "text": "hi"}),
            );
        });
        assert_eq!(rows.len(), 1);
        let ev = &rows[0];
        assert_eq!(ev["facet"], "ipc-in");
        assert_eq!(ev["hop"], "ipc-in");
        assert_eq!(ev["uc_id"], "UC-test");
        assert_eq!(ev["payload"]["command"], "im_send");
        assert_eq!(ev["payload"]["args"]["channelId"], "c1");
        // corr_key 须从 .args 抽出（ch+tmp）——纯壳两面与发送束聚同束的前提。
        assert_eq!(ev["corr_key"], "ch=c1;tmp=t9");
    }

    #[test]
    fn log_inbound_emits_facet_and_payload() {
        let rows = capture(|ctx| {
            ctx.log_inbound(
                "im_send_message",
                json!({"channel_id": "c1", "temporary_id": "t9"}),
            );
        });
        assert_eq!(rows.len(), 1);
        let ev = &rows[0];
        assert_eq!(ev["facet"], "inbound");
        assert_eq!(ev["hop"], "inbound");
        assert_eq!(ev["payload"]["command"], "im_send_message");
        // snake_case args 也经 .args 探针抽出领域键（与 IpcIn camel 归一后同束）。
        assert_eq!(ev["corr_key"], "ch=c1;tmp=t9");
    }

    #[test]
    fn ipc_in_inbound_share_monotonic_seq() {
        // 可证伪：两 tee 共享单调 seq（同一 run 内排序·不依赖墙钟·守 HX-C011）。
        let rows = capture(|ctx| {
            ctx.log_ipc_in("im_send", json!({"channelId": "c1"}));
            ctx.log_inbound("im_send_message", json!({"channel_id": "c1"}));
        });
        assert_eq!(rows.len(), 2);
        let s0 = rows[0]["seq"].as_u64().unwrap();
        let s1 = rows[1]["seq"].as_u64().unwrap();
        assert!(s1 > s0, "Inbound seq 须晚于 IpcIn（{s1} > {s0}）");
    }
}
