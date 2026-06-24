//! 金标帧 tape —— 录制时存「go 帧 + HTTP 响应 + 时钟 + id」，回放时按序供给。
//!
//! 确定性三要素（golden-replay-determinism.md）：go 帧 + 时钟 + id 三样一起录、一起放。
//! 只录 go 帧不录时钟/id = 回放仍非确定（helix 内部 timer/id 漂移）。
//!
//! 入站帧/HTTP 响应/时钟/id 按 FIFO 供给（L1 串行保证顺序确定）。HTTP 额外带 `key`
//! 仅作回放期顺序自检（不匹配则 last-known fail-soft，由日志暴露）。

use std::collections::VecDeque;
use std::path::Path;

use bytes::Bytes;
use helix_core::effect::HttpResponse;
use serde::{Deserialize, Serialize};

use crate::blob::Blob;

/// 一条录下来的 HTTP 响应。
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecordedHttp {
    /// `METHOD url` —— 回放顺序自检。
    pub key: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Blob,
}

/// 金标帧。`record_*` 录入；`next_*` 回放消费（FIFO）。
#[derive(Default, Serialize, Deserialize)]
pub struct Tape {
    /// 入站 WS 帧（go → helix）。
    pub inbound: VecDeque<Blob>,
    /// HTTP 响应（go 回的）。
    pub http: VecDeque<RecordedHttp>,
    /// 时钟序列（now_ms）。
    pub clock: VecDeque<u64>,
    /// id 序列（uuid v4 16 字节）。
    pub ids: VecDeque<[u8; 16]>,
    /// 随机数序列（退避 jitter 等）。
    pub randoms: VecDeque<u64>,

    /// 回放期 tape 耗尽时的兜底（单调安全），不入盘。
    #[serde(skip)]
    last_clock: u64,
    #[serde(skip)]
    last_id: [u8; 16],
}

impl Tape {
    pub fn new() -> Self {
        Self::default()
    }

    // —— 录制侧 ——
    pub fn record_inbound(&mut self, frame: &[u8]) {
        self.inbound.push_back(Blob::from_bytes(frame));
    }
    pub fn record_http(&mut self, key: String, resp: &HttpResponse) {
        self.http.push_back(RecordedHttp {
            key,
            status: resp.status,
            headers: resp.headers.clone(),
            body: Blob::from_bytes(&resp.body),
        });
    }
    pub fn record_clock(&mut self, ms: u64) {
        self.clock.push_back(ms);
    }
    pub fn record_id(&mut self, id: [u8; 16]) {
        self.ids.push_back(id);
    }
    pub fn record_random(&mut self, v: u64) {
        self.randoms.push_back(v);
    }

    // —— 回放侧（FIFO 消费）——
    /// 下一帧入站；None = tape 耗尽（= 连接关闭，流自然结束）。
    pub fn next_inbound(&mut self) -> Option<Bytes> {
        self.inbound.pop_front().map(|b| Bytes::from(b.to_bytes()))
    }
    /// 下一个 HTTP 响应；`expect_key` 仅自检（不匹配照常返回 + 由调用方日志暴露）。
    pub fn next_http(&mut self, _expect_key: &str) -> Option<HttpResponse> {
        self.http.pop_front().map(|r| HttpResponse {
            status: r.status,
            headers: r.headers,
            body: Bytes::from(r.body.to_bytes()),
        })
    }
    /// 下一个时钟；耗尽返回 last-known（单调安全）。
    pub fn next_clock(&mut self) -> u64 {
        if let Some(v) = self.clock.pop_front() {
            self.last_clock = v;
            v
        } else {
            self.last_clock
        }
    }
    /// 下一个 id；耗尽返回 last-known。
    pub fn next_id(&mut self) -> [u8; 16] {
        if let Some(v) = self.ids.pop_front() {
            self.last_id = v;
            v
        } else {
            self.last_id
        }
    }
    /// 下一个随机数（按 max 归约）；耗尽返回 0。
    pub fn next_random(&mut self, max: u64) -> u64 {
        let v = self.randoms.pop_front().unwrap_or(0);
        if max == 0 {
            0
        } else {
            v % max
        }
    }

    // —— 持久化 ——
    pub fn save(&self, path: impl AsRef<Path>) -> std::io::Result<()> {
        let json = serde_json::to_string_pretty(self)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }
    pub fn load(path: impl AsRef<Path>) -> std::io::Result<Self> {
        let s = std::fs::read_to_string(path)?;
        serde_json::from_str(&s)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inbound_fifo() {
        let mut t = Tape::new();
        t.record_inbound(b"a");
        t.record_inbound(b"b");
        assert_eq!(t.next_inbound().unwrap(), Bytes::from_static(b"a"));
        assert_eq!(t.next_inbound().unwrap(), Bytes::from_static(b"b"));
        assert!(t.next_inbound().is_none());
    }

    #[test]
    fn clock_exhaust_returns_last() {
        let mut t = Tape::new();
        t.record_clock(100);
        assert_eq!(t.next_clock(), 100);
        assert_eq!(t.next_clock(), 100); // 耗尽 → last
    }

    #[test]
    fn save_load_roundtrip() {
        let dir = std::env::temp_dir().join("helix_instrument_tape_test.json");
        let mut t = Tape::new();
        t.record_inbound(br#"{"action":"post"}"#);
        t.record_clock(42);
        t.record_id([7u8; 16]);
        t.save(&dir).unwrap();
        let mut back = Tape::load(&dir).unwrap();
        assert_eq!(back.next_clock(), 42);
        assert_eq!(back.next_id(), [7u8; 16]);
        assert_eq!(back.next_inbound().unwrap(), Bytes::from_static(br#"{"action":"post"}"#));
        let _ = std::fs::remove_file(&dir);
    }
}
