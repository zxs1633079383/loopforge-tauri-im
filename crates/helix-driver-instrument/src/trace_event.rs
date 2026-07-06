use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub fn default_trace_jsonl_path() -> &'static str {
    "/tmp/loopforge-trace/events.jsonl"
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TraceDirection {
    In,
    Out,
    Internal,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TraceEvent {
    pub ts: String,
    pub run_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_span_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub corr_key: Option<String>,
    pub layer: String,
    pub direction: TraceDirection,
    pub name: String,
    pub payload: Value,
    pub result: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl TraceEvent {
    pub fn new(
        run_id: impl Into<String>,
        name: impl Into<String>,
        layer: impl Into<String>,
        direction: TraceDirection,
        payload: Value,
    ) -> Self {
        Self {
            ts: now_utc_millis(),
            run_id: run_id.into(),
            trace_id: None,
            span_id: None,
            parent_span_id: None,
            corr_key: None,
            layer: layer.into(),
            direction,
            name: name.into(),
            payload,
            result: Value::Null,
            duration_ms: None,
            error: None,
        }
    }
}

fn now_utc_millis() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}Z", now.as_secs(), now.subsec_millis())
}

#[derive(Clone)]
pub struct TraceJsonlSink {
    inner: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl TraceJsonlSink {
    pub fn to_writer(w: Box<dyn Write + Send>) -> Self {
        Self {
            inner: Arc::new(Mutex::new(w)),
        }
    }

    pub fn to_file(path: impl AsRef<Path>) -> std::io::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .truncate(false)
            .open(path)?;
        f.set_len(0)?;
        Ok(Self::to_writer(Box::new(f)))
    }

    pub fn in_memory() -> (Self, SharedTraceBuf) {
        let buf = SharedTraceBuf::default();
        (Self::to_writer(Box::new(buf.clone())), buf)
    }

    pub fn emit(&self, ev: &TraceEvent) {
        if let Ok(line) = serde_json::to_string(ev) {
            if let Ok(mut w) = self.inner.lock() {
                let _ = w.write_all(line.as_bytes());
                let _ = w.write_all(b"\n");
                let _ = w.flush();
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct SharedTraceBuf(Arc<Mutex<Vec<u8>>>);

impl SharedTraceBuf {
    pub fn lines(&self) -> Vec<String> {
        let g = self.0.lock().expect("trace buf mutex poisoned");
        String::from_utf8_lossy(&g)
            .lines()
            .filter(|l| !l.is_empty())
            .map(|l| l.to_string())
            .collect()
    }
}

impl Write for SharedTraceBuf {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .lock()
            .expect("trace buf mutex poisoned")
            .extend_from_slice(buf);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct TraceEmitter {
    run_id: String,
    sink: TraceJsonlSink,
    seq: Arc<Mutex<u64>>,
}

impl TraceEmitter {
    pub fn new(run_id: impl Into<String>, sink: TraceJsonlSink) -> Self {
        Self {
            run_id: run_id.into(),
            sink,
            seq: Arc::new(Mutex::new(0)),
        }
    }

    pub fn run_id(&self) -> &str {
        &self.run_id
    }

    pub fn emit(&self, mut event: TraceEvent) {
        if event.run_id.is_empty() {
            event.run_id = self.run_id.clone();
        }
        self.sink.emit(&event);
    }

    pub fn next_span_id(&self) -> String {
        let mut g = self.seq.lock().expect("trace seq mutex poisoned");
        *g += 1;
        format!("{:016x}", *g)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn trace_event_serializes_required_schema() {
        let ev = TraceEvent {
            ts: "2026-07-06T12:00:00.000Z".to_string(),
            run_id: "run-1".to_string(),
            trace_id: Some("00000000000000000000000000000001".to_string()),
            span_id: Some("0000000000000002".to_string()),
            parent_span_id: Some("0000000000000001".to_string()),
            corr_key: Some("ch=c1;tmp=t1".to_string()),
            layer: "pc.tauri".to_string(),
            direction: TraceDirection::In,
            name: "pc.tauri.invoke.in".to_string(),
            payload: json!({"cmd":"im_send"}),
            result: json!({"ok":true}),
            duration_ms: Some(3),
            error: None,
        };

        let line = serde_json::to_string(&ev).expect("trace event JSON");
        let parsed: serde_json::Value = serde_json::from_str(&line).expect("valid JSON");
        assert_eq!(parsed["run_id"], "run-1");
        assert_eq!(parsed["trace_id"], "00000000000000000000000000000001");
        assert_eq!(parsed["span_id"], "0000000000000002");
        assert_eq!(parsed["layer"], "pc.tauri");
        assert_eq!(parsed["direction"], "in");
        assert_eq!(parsed["name"], "pc.tauri.invoke.in");
        assert_eq!(parsed["payload"]["cmd"], "im_send");
    }

    #[test]
    fn sink_writes_jsonl_fail_soft_style() {
        let (sink, buf) = TraceJsonlSink::in_memory();
        let emitter = TraceEmitter::new("run-1", sink);
        emitter.emit(TraceEvent::new(
            "run-1",
            "pc.tauri.invoke.in",
            "pc.tauri",
            TraceDirection::In,
            json!({"cmd":"im_send"}),
        ));

        let lines = buf.lines();
        assert_eq!(lines.len(), 1);
        let parsed: serde_json::Value = serde_json::from_str(&lines[0]).expect("valid JSONL");
        assert_eq!(parsed["name"], "pc.tauri.invoke.in");
        assert_eq!(parsed["payload"]["cmd"], "im_send");
    }

    #[test]
    fn default_trace_jsonl_path_is_tmp() {
        assert_eq!(default_trace_jsonl_path(), "/tmp/loopforge-trace/events.jsonl");
    }
}
