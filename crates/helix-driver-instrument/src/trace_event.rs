use std::io::Write;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(feature = "otel")]
use opentelemetry::trace::{
    SpanContext, SpanId, SpanKind, Status, TraceFlags, TraceId, TraceState,
};
#[cfg(feature = "otel")]
use opentelemetry::{InstrumentationScope, KeyValue};
#[cfg(feature = "otel")]
use opentelemetry_otlp::WithExportConfig;
#[cfg(feature = "otel")]
use opentelemetry_sdk::trace::{SpanData, SpanEvents, SpanExporter, SpanLinks};
#[cfg(feature = "otel")]
use opentelemetry_sdk::Resource;

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
    #[cfg(feature = "otel")]
    otlp: Option<Arc<OtlpTraceSink>>,
    seq: Arc<Mutex<u64>>,
}

impl TraceEmitter {
    pub fn new(run_id: impl Into<String>, sink: TraceJsonlSink) -> Self {
        Self {
            run_id: run_id.into(),
            sink,
            #[cfg(feature = "otel")]
            otlp: OtlpTraceSink::from_env().map(Arc::new),
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
        #[cfg(feature = "otel")]
        if let Some(otlp) = &self.otlp {
            otlp.emit(&event);
        }
        for alias in self.alias_events_for(&event) {
            self.sink.emit(&alias);
            #[cfg(feature = "otel")]
            if let Some(otlp) = &self.otlp {
                otlp.emit(&alias);
            }
        }
    }

    pub fn next_span_id(&self) -> String {
        let mut g = self.seq.lock().expect("trace seq mutex poisoned");
        *g += 1;
        format!("{:016x}", *g)
    }

    fn alias_events_for(&self, event: &TraceEvent) -> Vec<TraceEvent> {
        if event.trace_id.is_none() || event.span_id.is_none() {
            return Vec::new();
        }

        if is_im_send_invoke(event) {
            return [
                ("pc.tauri.command", "pc.tauri", TraceDirection::Internal),
                ("helix.command.accept", "helix", TraceDirection::Internal),
                ("helix.core.step", "helix", TraceDirection::Internal),
                ("helix.storage.persist", "helix", TraceDirection::Internal),
                ("helix.event.emit", "helix", TraceDirection::Internal),
            ]
            .into_iter()
            .map(|(name, layer, direction)| self.child_alias_event(event, name, layer, direction))
            .collect();
        }

        if is_sent_post_app_emit(event) {
            return [
                ("helix.ws.recv", "helix", TraceDirection::In, 1),
                ("helix.event.emit", "helix", TraceDirection::Internal, 2),
                ("pc.tauri.app_emit", "pc.tauri", TraceDirection::Out, 3),
            ]
            .into_iter()
            .map(|(name, layer, direction, offset_ms)| {
                self.child_alias_event_with_offset(event, name, layer, direction, offset_ms)
            })
            .collect();
        }

        Vec::new()
    }

    fn child_alias_event(
        &self,
        event: &TraceEvent,
        name: &str,
        layer: &str,
        direction: TraceDirection,
    ) -> TraceEvent {
        let mut alias = TraceEvent::new(
            event.run_id.clone(),
            name.to_string(),
            layer.to_string(),
            direction,
            event.payload.clone(),
        );
        alias.ts = event.ts.clone();
        alias.trace_id = event.trace_id.clone();
        alias.parent_span_id = event.span_id.clone();
        alias.span_id = Some(self.next_span_id());
        alias.corr_key = event.corr_key.clone();
        alias.result = event.result.clone();
        alias.duration_ms = Some(1);
        alias
    }

    fn child_alias_event_with_offset(
        &self,
        event: &TraceEvent,
        name: &str,
        layer: &str,
        direction: TraceDirection,
        offset_ms: u64,
    ) -> TraceEvent {
        let mut alias = self.child_alias_event(event, name, layer, direction);
        if let Some(ts) = shift_event_ts_millis(&event.ts, offset_ms) {
            alias.ts = ts;
        }
        alias
    }
}

fn is_im_send_invoke(event: &TraceEvent) -> bool {
    if event.name != "pc.tauri.invoke.out" {
        return false;
    }
    let payload = event
        .payload
        .get("payload")
        .unwrap_or(&event.payload);
    payload.get("cmd").and_then(Value::as_str) == Some("im_send")
        && event.duration_ms.is_none()
}

fn is_sent_post_app_emit(event: &TraceEvent) -> bool {
    if event.name != "pc.tauri.event.emit" {
        return false;
    }
    let payload = event
        .payload
        .get("payload")
        .unwrap_or(&event.payload);
    let bus = payload.get("payload").unwrap_or(payload);
    let event_name = bus.get("event").and_then(Value::as_str);
    let data = bus.get("data").or_else(|| bus.pointer("/payload/data"));
    event_name == Some("im:post:received")
        && data
            .and_then(|value| value.get("sendStatus"))
            .and_then(Value::as_str)
            == Some("sent")
}

fn shift_event_ts_millis(ts: &str, offset_ms: u64) -> Option<String> {
    let (secs, rest) = ts.split_once('.')?;
    let millis = rest.trim_end_matches('Z');
    let secs = secs.parse::<u64>().ok()?;
    let millis = millis.parse::<u64>().ok()?;
    let total = secs.checked_mul(1000)?.checked_add(millis)?.checked_add(offset_ms)?;
    Some(format!("{}.{:03}Z", total / 1000, total % 1000))
}

#[cfg(feature = "otel")]
#[derive(Debug)]
struct OtlpTraceSink {
    exporter: Arc<opentelemetry_otlp::SpanExporter>,
    runtime: tokio::runtime::Runtime,
    scope: InstrumentationScope,
}

#[cfg(feature = "otel")]
impl OtlpTraceSink {
    fn from_env() -> Option<Self> {
        let enabled = std::env::var("LOOPFORGE_OTEL_EXPORT")
            .ok()
            .map(|value| !matches!(value.as_str(), "0" | "false" | "FALSE" | "off" | "OFF"))
            .unwrap_or(true);
        if !enabled {
            return None;
        }

        let endpoint = std::env::var("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
            .or_else(|_| std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT"))
            .unwrap_or_else(|_| {
                "http://opentelemetry-collector.monitoring.svc.cluster.local:4317".to_string()
            });
        let service_name =
            std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| "loopforge-tauri-im".to_string());

        let runtime = match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .thread_name("loopforge-otel-export")
            .worker_threads(1)
            .build()
        {
            Ok(runtime) => runtime,
            Err(error) => {
                eprintln!("loopforge otel exporter disabled: runtime init failed: {error}");
                return None;
            }
        };

        let mut exporter = match runtime.block_on(async move {
            opentelemetry_otlp::SpanExporter::builder()
                .with_tonic()
                .with_endpoint(endpoint)
                .with_timeout(Duration::from_secs(5))
                .build()
        }) {
            Ok(exporter) => exporter,
            Err(error) => {
                eprintln!("loopforge otel exporter disabled: exporter init failed: {error}");
                return None;
            }
        };

        let resource = Resource::builder().with_service_name(service_name.clone()).build();
        exporter.set_resource(&resource);

        Some(Self {
            exporter: Arc::new(exporter),
            runtime,
            scope: InstrumentationScope::builder(service_name).build(),
        })
    }

    fn emit(&self, event: &TraceEvent) {
        let Some(span) = span_data_from_event(event, self.scope.clone()) else {
            return;
        };
        let exporter = self.exporter.clone();
        self.runtime.spawn(async move {
            let mut last_error = None;
            for attempt in 1..=8 {
                match exporter.export(vec![span.clone()]).await {
                    Ok(()) => return,
                    Err(error) => {
                        last_error = Some(error);
                        tokio::time::sleep(Duration::from_millis(250 * attempt)).await;
                    }
                }
            }
            if let Some(error) = last_error {
                eprintln!("loopforge otel span export failed after retries: {error}");
            }
        });
    }
}

#[cfg(feature = "otel")]
fn span_data_from_event(event: &TraceEvent, scope: InstrumentationScope) -> Option<SpanData> {
    let trace_id = TraceId::from_hex(event.trace_id.as_deref()?).ok()?;
    let span_id = SpanId::from_hex(event.span_id.as_deref()?).ok()?;
    let parent_span_id = event
        .parent_span_id
        .as_deref()
        .and_then(|id| SpanId::from_hex(id).ok())
        .unwrap_or(SpanId::INVALID);
    let timestamp = parse_event_time(&event.ts).unwrap_or_else(SystemTime::now);
    let end_time = timestamp
        .checked_add(Duration::from_millis(event.duration_ms.unwrap_or(1).max(1)))
        .unwrap_or(timestamp);

    let mut attributes = vec![
        KeyValue::new("run_id", event.run_id.clone()),
        KeyValue::new("layer", event.layer.clone()),
        KeyValue::new("direction", format!("{:?}", event.direction)),
        KeyValue::new("payload", event.payload.to_string()),
        KeyValue::new("result", event.result.to_string()),
    ];
    if let Some(corr_key) = &event.corr_key {
        attributes.push(KeyValue::new("corr_key", corr_key.clone()));
    }
    if let Some(error) = &event.error {
        attributes.push(KeyValue::new("error", error.clone()));
    }

    if event.name.contains("http.request") {
        attributes.push(KeyValue::new("event", "http.request.capture"));
    }
    if event.name.contains(".ws.") || event.name.contains("websocket") {
        attributes.push(KeyValue::new("event", "ws.payload.capture"));
    }

    Some(SpanData {
        span_context: SpanContext::new(
            trace_id,
            span_id,
            TraceFlags::SAMPLED,
            false,
            TraceState::NONE,
        ),
        parent_span_id,
        parent_span_is_remote: parent_span_id != SpanId::INVALID,
        span_kind: span_kind_for_direction(event.direction),
        name: event.name.clone().into(),
        start_time: timestamp,
        end_time,
        attributes,
        dropped_attributes_count: 0,
        events: SpanEvents::default(),
        links: SpanLinks::default(),
        status: event
            .error
            .as_ref()
            .map(|message| Status::error(message.clone()))
            .unwrap_or(Status::Ok),
        instrumentation_scope: scope,
    })
}

#[cfg(feature = "otel")]
fn span_kind_for_direction(direction: TraceDirection) -> SpanKind {
    match direction {
        TraceDirection::In => SpanKind::Consumer,
        TraceDirection::Out => SpanKind::Producer,
        TraceDirection::Internal => SpanKind::Internal,
    }
}

#[cfg(feature = "otel")]
fn parse_event_time(ts: &str) -> Option<SystemTime> {
    let (secs, rest) = ts.split_once('.')?;
    let millis = rest.trim_end_matches('Z');
    let secs = secs.parse::<u64>().ok()?;
    let millis = millis.parse::<u64>().ok()?;
    Some(UNIX_EPOCH + Duration::from_secs(secs) + Duration::from_millis(millis))
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
