# OTel Trace Gate

This gate validates one full-link `im.send(...)` distributed trace after the PC client, Helix, and cses-im-server have exported spans to Jaeger. It is a completeness gate, not the tracing enablement source of truth. Tracing is enabled from project config such as `config/dev-local.json`; `JAEGER_QUERY_URL` only tells the checker where to read Jaeger Query.

## Start the local stack

Start the local OTel collector / Jaeger stack from the Helix trace plan:

```bash
cd /System/Volumes/Data/workspace/rust/helix
docker compose -f docker/otel/docker-compose.yaml up -d
nc -zv 127.0.0.1 4317
open http://127.0.0.1:16686
```

Then run LoopForge with the local profile:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
```

`config/dev-local.json` enables OTLP export with sampling ratio `1.0` and the shared OTLP gRPC collector endpoint:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://opentelemetry-collector.monitoring.svc.cluster.local:4317
```

Jaeger Query is expected at `http://127.0.0.1:16686` by default for local checks, and can be overridden with `JAEGER_QUERY_URL`. The OTLP exporter endpoint `http://opentelemetry-collector.monitoring.svc.cluster.local:4317` and Jaeger Query URL are separate knobs.

The Go side must also run with `observability.otel.enabled=true` so the server spans appear in the same trace.

## Collect the trace id

Send one message through `im.send(...)`, then copy the trace id printed by the PC client / Tauri logs for that send path. The trace id is the 32 hex character middle field in a W3C `traceparent` value:

```text
00-<trace-id>-<span-id>-01
```

For example, from `00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01`, use:

```text
4bf92f3577b34da6a3ce929d0e0e4736
```

If no trace id appears, first check client-side trace creation and profile config before using this gate.

## Run the gate

```bash
bash scripts/otel-trace-smoke.sh <trace-id>
```

The wrapper calls:

```bash
node scripts/otel-trace-check.mjs <trace-id>
```

By default the checker queries:

```text
http://127.0.0.1:16686/api/traces/<trace-id>
```

Override the Jaeger Query target when needed:

```bash
node scripts/otel-trace-check.mjs --jaeger-url http://127.0.0.1:16686 <trace-id>
JAEGER_QUERY_URL=http://127.0.0.1:16686 node scripts/otel-trace-check.mjs <trace-id>
```

Use a fixture for deterministic, no-network verification:

```bash
node scripts/otel-trace-check.mjs --self-test
node scripts/otel-trace-check.mjs --input /path/to/jaeger-trace-response.json <trace-id>
```

## Trace JSONL

Loopforge trace events are written to `/tmp/loopforge-trace/events.jsonl` by default.
Override with:

```bash
LOOPFORGE_TRACE_JSONL=/tmp/loopforge-trace/my-run.jsonl bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs
```

Validate the local evidence:

```bash
node scripts/trace-jsonl-check.mjs --input /tmp/loopforge-trace/events.jsonl --trace-id <trace-id>
node scripts/trace-jsonl-check.mjs --self-test
```

The JSONL checker requires one correlated trace id to contain PC action/invoke/listen/render, Tauri command enqueue/event emit, HTTP request/response, and WS connect/send/recv/close events. This is the local sidecar evidence; Jaeger Query remains the remote OTel evidence.

## Span semantics

The checker accepts one client action span, one client bridge span, all fixed Helix / cses middle spans, and one client render span.

Client alternatives:

- action: `pc.ui.action` or future mobile `mobile.js.im_send`
- bridge: `pc.tauri.invoke` or future mobile `mobile.core_bridge.call_with_trace`
- render: `pc.ui.render` or future mobile `mobile.render`

Fixed middle spans:

- `helix.command.accept`
- `helix.core.step`
- `helix.storage.persist`
- `helix.event.emit` twice: one optimistic/sending emit and one received/render-ready emit
- `helix.http.request`
- `cses.http.request`
- `cses.handler.create_post`
- `cses.service.create_post`
- `cses.store.create_post`
- `cses.ws.publish`
- `cses.ws.fanout`
- `cses.ws.deliver`
- `helix.ws.recv`

Duplicate handling is count based. `helix.event.emit` must appear at least twice because the full send path emits on both the local optimistic path and the server echo path. Other fixed middle spans must appear at least once. The checker does not currently assert parent/child ordering or timing.

## Reading failures

- Missing client action or bridge span: the PC/mobile sidecar was not started or not attached before entering Tauri/FFI.
- Missing `helix.command.accept`, `helix.core.step`, `helix.storage.persist`, or the first `helix.event.emit`: the trace did not cover the Helix command ingress / local optimistic path.
- Missing `helix.http.request` or `cses.http.request`: W3C HTTP propagation broke before or at the Go boundary.
- Missing `cses.handler.create_post`, `cses.service.create_post`, or `cses.store.create_post`: cses-im-server did not instrument the create-post stack.
- Missing `cses.ws.publish`, `cses.ws.fanout`, or `cses.ws.deliver`: the server echo path is a trace blind spot.
- Missing `helix.ws.recv` or the second `helix.event.emit`: the return path reintroduces the C015 hop coverage blind spot.
- Missing render span: UI render instrumentation did not observe the final projected state.

If the checker reports no observed spans, verify that the collector and Jaeger are running and that the trace id was copied from the same `im.send(...)` run.
