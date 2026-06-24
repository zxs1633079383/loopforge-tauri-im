//! JSONL 日志落点。线程安全、cheap-clone（Arc 背书），多个 port 装饰器共享一个 sink。

use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use crate::event::HopEvent;

/// 结构化 JSONL hop 事件落点。一行一个 [`HopEvent`]。
#[derive(Clone)]
pub struct LogSink {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    w: Box<dyn Write + Send>,
    seq: u64,
}

impl LogSink {
    /// 写到任意 writer（文件 / stdout / buffer）。
    pub fn to_writer(w: Box<dyn Write + Send>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner { w, seq: 0 })),
        }
    }

    /// 写到文件（截断重建）。
    pub fn to_file(path: impl AsRef<Path>) -> std::io::Result<Self> {
        let f = std::fs::File::create(path)?;
        Ok(Self::to_writer(Box::new(f)))
    }

    /// 测试用：写进内存 buffer，返回 sink + 共享 buffer 句柄。
    pub fn in_memory() -> (Self, SharedBuf) {
        let buf = SharedBuf::default();
        let sink = Self::to_writer(Box::new(buf.clone()));
        (sink, buf)
    }

    /// 取下一个单调序号（同一 run 内排序）。
    pub fn next_seq(&self) -> u64 {
        let mut g = self.inner.lock().expect("log mutex poisoned");
        g.seq += 1;
        g.seq
    }

    /// 落一行 JSONL。序列化失败/写失败被吞（日志不该让被测路径崩；fail-soft）。
    pub fn emit(&self, ev: &HopEvent) {
        if let Ok(line) = serde_json::to_string(ev) {
            let mut g = self.inner.lock().expect("log mutex poisoned");
            let _ = g.w.write_all(line.as_bytes());
            let _ = g.w.write_all(b"\n");
            let _ = g.w.flush();
        }
    }
}

/// 测试用内存 buffer，可 clone（共享底层 Vec）。
#[derive(Clone, Default)]
pub struct SharedBuf(Arc<Mutex<Vec<u8>>>);

impl SharedBuf {
    /// 取出当前累计的所有行（按 `\n` 切，去空行）。
    pub fn lines(&self) -> Vec<String> {
        let g = self.0.lock().expect("buf mutex poisoned");
        String::from_utf8_lossy(&g)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    }
}

impl Write for SharedBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let mut g = self.0.lock().expect("buf mutex poisoned");
        g.extend_from_slice(buf);
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
