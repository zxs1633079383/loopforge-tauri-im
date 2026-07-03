//! Record → Replay 往返：证明装饰器三件事（透传/录制/回放）+ 日志 + corr_key 抽取。
//! 用 fake port（不连真 go），executor 用 futures::block_on（不引 tokio）。

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use bytes::Bytes;
use futures::executor::block_on;

use helix_core::effect::{HttpRequest, HttpResponse};
use helix_core::ports::{Clock, HttpRequester, IdSource, Transport};
use helix_core::PortError;

use helix_driver_instrument::{
    InstrumentCtx, LogSink, Mode, Recording, Tape, HTTP_FAIL_ONCE_URL_SUFFIX_ENV,
};

// —— fake Transport：recv 吐脚本帧，send 记账 ——
struct FakeTransport {
    inbound: Mutex<VecDeque<Bytes>>,
    sent: Arc<Mutex<Vec<Bytes>>>,
}
impl FakeTransport {
    fn with_inbound(frames: Vec<Bytes>) -> (Self, Arc<Mutex<Vec<Bytes>>>) {
        let sent = Arc::new(Mutex::new(Vec::new()));
        (
            Self {
                inbound: Mutex::new(frames.into()),
                sent: sent.clone(),
            },
            sent,
        )
    }
}
#[async_trait]
impl Transport for FakeTransport {
    async fn connect(&mut self) -> Result<(), PortError> {
        Ok(())
    }
    async fn send(&self, frame: Bytes) -> Result<(), PortError> {
        self.sent.lock().unwrap().push(frame);
        Ok(())
    }
    async fn recv(&self) -> Result<Option<Bytes>, PortError> {
        Ok(self.inbound.lock().unwrap().pop_front())
    }
    async fn close(&self) -> Result<(), PortError> {
        Ok(())
    }
}

// —— fake HTTP：计数 + 固定响应，证明 failpoint 是否触碰 inner ——
struct FakeHttp {
    calls: Arc<AtomicUsize>,
}
impl FakeHttp {
    fn new() -> (Self, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        (
            Self {
                calls: calls.clone(),
            },
            calls,
        )
    }
}
#[async_trait]
impl HttpRequester for FakeHttp {
    async fn request(&self, req: HttpRequest) -> Result<HttpResponse, PortError> {
        let call = self.calls.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(HttpResponse {
            status: 200,
            headers: vec![("x-call".to_string(), call.to_string())],
            body: Bytes::from(format!("ok:{}", req.url)),
        })
    }
}

// —— fake Clock / IdSource：步进，证明 Replay 忽略 inner 用 tape ——
#[derive(Clone)]
struct StepClock(Arc<AtomicU64>);
impl Clock for StepClock {
    fn now_ms(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst)
    }
}
struct StepId(Arc<AtomicU64>);
impl IdSource for StepId {
    fn new_uuid(&self) -> Result<[u8; 16], PortError> {
        let n = self.0.fetch_add(1, Ordering::SeqCst);
        let mut id = [0u8; 16];
        id[0] = n as u8;
        Ok(id)
    }
}

const POST_FRAME: &[u8] = br#"{"action":"post","channelId":"c1","eventSeq":40114}"#;
const SEND_BODY: &[u8] = br#"{"temporaryId":"t1","channelId":"c1"}"#;
const HTTP_FAIL_SUFFIX: &str = "posts/create";

static ENV_LOCK: Mutex<()> = Mutex::new(());

fn http_req(url: &str) -> HttpRequest {
    HttpRequest {
        method: "POST".to_string(),
        url: url.to_string(),
        headers: Vec::new(),
        body: Some(Bytes::from_static(SEND_BODY)),
    }
}

#[test]
fn http_failpoint_once_matching_url_and_replay_ignores_env() {
    let _guard = ENV_LOCK.lock().unwrap();
    std::env::set_var(HTTP_FAIL_ONCE_URL_SUFFIX_ENV, HTTP_FAIL_SUFFIX);

    let (log, _buf) = LogSink::in_memory();
    let ctx = InstrumentCtx::new("run-http-failpoint", Mode::Live, log, Tape::new());
    std::env::remove_var(HTTP_FAIL_ONCE_URL_SUFFIX_ENV);
    let (fake, calls) = FakeHttp::new();
    let rec = Recording::new(fake, ctx);

    block_on(async {
        let nonmatching = rec
            .request(http_req("/api/v4/channels/create"))
            .await
            .expect("nonmatching URL should pass through");
        assert_eq!(nonmatching.status, 200);
        assert_eq!(calls.load(Ordering::SeqCst), 1);

        let first_matching = rec
            .request(http_req("/api/v4/posts/create"))
            .await
            .expect_err("first matching URL should fail once");
        match first_matching {
            PortError::Http(msg) => assert_eq!(msg, "loopforge failpoint: posts/create"),
            other => panic!("expected HTTP failpoint error, got {other:?}"),
        }
        assert_eq!(
            calls.load(Ordering::SeqCst),
            1,
            "failpoint must not touch the inner HTTP requester"
        );

        let second_matching = rec
            .request(http_req("/api/v4/posts/create"))
            .await
            .expect("second matching URL should pass after failpoint is consumed");
        assert_eq!(second_matching.status, 200);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    });

    std::env::set_var(HTTP_FAIL_ONCE_URL_SUFFIX_ENV, HTTP_FAIL_SUFFIX);
    let mut tape = Tape::new();
    tape.record_http(
        "POST /api/v4/posts/create".to_string(),
        &HttpResponse {
            status: 202,
            headers: Vec::new(),
            body: Bytes::from_static(b"replayed"),
        },
    );
    let (log2, _buf2) = LogSink::in_memory();
    let ctx2 = InstrumentCtx::new("run-http-replay", Mode::Replay, log2, tape);
    std::env::remove_var(HTTP_FAIL_ONCE_URL_SUFFIX_ENV);
    let (fake2, calls2) = FakeHttp::new();
    let rep = Recording::new(fake2, ctx2);

    block_on(async {
        let replayed = rep
            .request(http_req("/api/v4/posts/create"))
            .await
            .expect("replay mode must ignore HTTP failpoint env");
        assert_eq!(replayed.status, 202);
        assert_eq!(replayed.body, Bytes::from_static(b"replayed"));
        assert_eq!(
            calls2.load(Ordering::SeqCst),
            0,
            "replay must use tape without touching inner HTTP"
        );
    });
}

#[test]
fn record_then_replay_transport() {
    // —— Record：透传 fake go + 录 tape ——
    let (log, buf) = LogSink::in_memory();
    let ctx = InstrumentCtx::new("run-rec", Mode::Record, log, Tape::new());
    ctx.set_uc("UC-send-1");
    let (fake, sent) = FakeTransport::with_inbound(vec![Bytes::from_static(POST_FRAME)]);
    let mut rec = Recording::new(fake, ctx.clone());

    block_on(async {
        rec.connect().await.unwrap();
        rec.send(Bytes::from_static(SEND_BODY)).await.unwrap();
        assert_eq!(
            rec.recv().await.unwrap().unwrap(),
            Bytes::from_static(POST_FRAME)
        );
        assert!(rec.recv().await.unwrap().is_none()); // 流结束
    });

    // Record 模式真发了（fake 记到 sent）+ tape 录到入站帧。
    assert_eq!(sent.lock().unwrap().len(), 1);
    ctx.with_tape(|t| assert_eq!(t.inbound.len(), 1));

    // 日志：facet ① 出站 + ws-recv + corr_key 抽到。
    let lines = buf.lines();
    assert!(lines
        .iter()
        .any(|l| l.contains("\"facet\":\"outbound\"") && l.contains("\"hop\":\"ws-send\"")));
    assert!(lines
        .iter()
        .any(|l| l.contains("\"facet\":\"ws-recv\"") && l.contains("ch=c1;seq=40114")));
    assert!(lines.iter().all(|l| l.contains("UC-send-1")));

    // —— 把 tape 存盘再 load，进 Replay ——
    let path = std::env::temp_dir().join("helix_instrument_roundtrip_tape.json");
    ctx.save_tape(&path).unwrap();
    let tape = Tape::load(&path).unwrap();

    let (log2, buf2) = LogSink::in_memory();
    let ctx2 = InstrumentCtx::new("run-rep", Mode::Replay, log2, tape);
    ctx2.set_uc("UC-send-1");
    // fake2 入站为空 + send 记账：若回放真去碰 inner，frame 会从空 fake 取 None → 断言失败。
    let (fake2, sent2) = FakeTransport::with_inbound(vec![]);
    let mut rep = Recording::new(fake2, ctx2.clone());

    block_on(async {
        rep.connect().await.unwrap();
        rep.send(Bytes::from_static(SEND_BODY)).await.unwrap(); // 回放不真发
                                                                // 入站从 tape 供，不是从（空的）fake2。
        assert_eq!(
            rep.recv().await.unwrap().unwrap(),
            Bytes::from_static(POST_FRAME)
        );
        assert!(rep.recv().await.unwrap().is_none());
    });

    // 回放期 send 没碰网络（fake2.sent 仍空）。
    assert_eq!(sent2.lock().unwrap().len(), 0);
    // facet ① 出站在回放期仍 tee（可断言）。
    let lines2 = buf2.lines();
    assert!(lines2
        .iter()
        .any(|l| l.contains("\"facet\":\"outbound\"") && l.contains("tmp=t1")));

    let _ = std::fs::remove_file(&path);
}

#[test]
fn record_then_replay_clock_and_id_deterministic() {
    // Record：步进 clock/id 从 0 开始 → 录 [0,1,2] / id[0]∈{0,1}。
    let (log, _buf) = LogSink::in_memory();
    let ctx = InstrumentCtx::new("run-rec2", Mode::Record, log, Tape::new());
    let clk = Recording::new(StepClock(Arc::new(AtomicU64::new(0))), ctx.clone());
    let idr = Recording::new(StepId(Arc::new(AtomicU64::new(0))), ctx.clone());

    let recorded_clock = vec![clk.now_ms(), clk.now_ms(), clk.now_ms()];
    let recorded_id0 = vec![idr.new_uuid().unwrap()[0], idr.new_uuid().unwrap()[0]];
    assert_eq!(recorded_clock, vec![0, 1, 2]);
    assert_eq!(recorded_id0, vec![0, 1]);

    let path = std::env::temp_dir().join("helix_instrument_clock_tape.json");
    ctx.save_tape(&path).unwrap();
    let tape = Tape::load(&path).unwrap();

    // Replay：inner 故意从 999 起步，证明回放忽略 inner、走 tape。
    let (log2, _buf2) = LogSink::in_memory();
    let ctx2 = InstrumentCtx::new("run-rep2", Mode::Replay, log2, tape);
    let clk2 = Recording::new(StepClock(Arc::new(AtomicU64::new(999))), ctx2.clone());
    let idr2 = Recording::new(StepId(Arc::new(AtomicU64::new(999))), ctx2.clone());

    assert_eq!(
        vec![clk2.now_ms(), clk2.now_ms(), clk2.now_ms()],
        vec![0, 1, 2] // 来自 tape，不是 999+
    );
    assert_eq!(
        vec![idr2.new_uuid().unwrap()[0], idr2.new_uuid().unwrap()[0]],
        vec![0, 1]
    );

    let _ = std::fs::remove_file(&path);
}
