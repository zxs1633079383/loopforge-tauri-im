# Four Repo Trace OTel Full Fidelity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build executable full-fidelity Trace OTel across `helix`, `cses-im-server`, `loopforge-tauri-im`, and `mobile-qucik-c++`, proving one PC and one mobile `im.send(...)` path in Jaeger with HTTP headers/body capture and WS action/target/payload capture.

**Architecture:** Use the approved `Trace Sidecar + Boundary Decorator + Capture Policy` design. `traceparent` / `baggage` move through headers, `__trace`, and WS envelope `tracing`; capture rules live in repo-local config and scripts read config internally rather than exposing endpoints on every command. Each repo owns its boundary spans and tests; only the final Evidence Collector may mark the cross-repo trace green.

**Tech Stack:** OpenTelemetry SDKs, W3C TraceContext, Go 1.23, gorilla/mux, Rust Helix host/FFI, Tauri 2, Angular, QuickJS/C++, Node 22 Jaeger checker scripts, Jaeger Query API at `http://192.168.6.66:32281`, OTel Collector at `http://opentelemetry-collector.monitoring.svc.cluster.local:4317`.

## Global Constraints

- Trace 不能进入业务 payload、业务 DTO、投影 schema、持久化业务字段。
- `helix-core` 保持 runtime-neutral，不引入 OTel exporter、Tokio runtime、HTTP SDK。
- 各仓独立启停：一个项目关闭 trace 不影响业务，也不阻断其他项目导出 span。
- HTTP / WS 要支持 `inbound` 和 `outbound` 方向标识。
- HTTP capture 支持请求头与请求体，capture 启用时默认规则为全量匹配，并支持 include / exclude 正则。
- WS capture 必须覆盖 action、推送目标 userId / userIds / viewers、payload 全内容。
- 全量内容只进入 debug capture span event 或本地 evidence fixture，不进 memory，不进业务表，不进普通结构化日志。
- 发送消息链路必须同时证明 PC 和 mobile 两端，且证明方式必须是可执行测试，不接受手工看 UI 截图或单次口头观察。
- 验收命令不暴露 Collector / Jaeger 配置；脚本必须从 repo-local config 读取 endpoint、sampler、capture 规则。
- dev / real-chain 真实运行默认全部开启：OTel enabled、capture enabled、HTTP include `.*`、WS include `.*`。
- OTel exporter 初始化失败必须降级 noop，不影响业务启动。
- worker 只能报告本仓节点结果，不能宣布全链路 DONE；Evidence Collector 才能把节点标为 green。
- 实现阶段如果单节点预估超过 40 分钟，必须拆独立 worktree；worktree 创建前检查磁盘，分支名使用 `codex/` 前缀。

---

## Worktree And Review Strategy

This plan is intentionally split into repo-sized packets. Recommended execution order:

1. `cses-im-server`: capture policy + HTTP/WS capture because it defines backend evidence.
2. `helix`: host/FFI OTel boundary and receive path because PC/mobile both depend on it.
3. `loopforge-tauri-im`: PC config, script, Jaeger checker, WDIO smoke.
4. `mobile-qucik-c++`: mobile config, script, QuickJS/C++ spans, real-chain smoke.
5. Evidence collector: run both smoke gates and write Loop Engine ledger.

For subagent-driven execution, use one fresh worker per task and one fresh reviewer after each worker. Each worker must commit only its allowed files and must not stage `.loop-engine/`, `.idea/`, old real-chain reports, `ssh.log`, or unrelated root docs.

## File Structure

### `/System/Volumes/Data/workspace/golang/cses-im-server`

- Modify `internal/config/config.go`
  - Add `OtelCaptureConfig`, `CaptureRegexConfig`, `CaptureRedactConfig`.
- Modify `internal/config/yaml_source.go`
  - Map dotted capture keys from `config.yaml` / Consul.
- Modify `config.yaml`
  - Add default-on dev capture settings and Collector endpoint.
- Create `internal/observability/capture.go`
  - Compile include/exclude regex and redact rules.
- Create `internal/observability/http_capture.go`
  - Capture and restore request body.
- Create `internal/observability/ws_capture.go`
  - Capture action, target users/viewers, and full payload as span events.
- Modify `internal/api/trace_middleware.go`
  - Add direction attributes, session/company attrs, and HTTP capture event.
- Modify `internal/ws/trace.go`
  - Add direction attributes and WS capture helpers.
- Add tests:
  - `internal/observability/capture_test.go`
  - `internal/observability/http_capture_test.go`
  - `internal/observability/ws_capture_test.go`
  - extend `internal/api/trace_middleware_test.go`
  - extend `internal/ws/trace_envelope_test.go`

### `/System/Volumes/Data/workspace/rust/helix`

- Create `crates/helix-driver-host/src/otel.rs`
  - Host-level OTel adapter and RAII span scopes.
- Modify `crates/helix-driver-host/src/trace.rs`
  - Add direction/span helper interfaces without adding OTel to `helix-core`.
- Modify `crates/helix-driver-host/src/http_cross.rs`
  - Ensure outbound HTTP spans preserve traceparent and capture metadata only.
- Modify `crates/helix-driver-ffi/src/api.rs`
  - Ensure `helix_command_with_trace` queues trace sidecar and can produce `mobile.ffi.command`.
- Add tests:
  - `crates/helix-driver-host/tests/otel_boundary_test.rs`
  - extend `crates/helix-driver-ffi/tests/trace_command_test.rs`
  - extend `crates/helix-driver-host/tests/p1_5_http_crosscut_test.rs`
- Modify `scripts/trace-static-gate.sh`
  - Keep blocking trace pollution into `helix-core` / `helix-im/src`.

### `/System/Volumes/Data/workspace/rust/loopforge-tauri-im`

- Modify `config/dev-local.json`
  - Default-on OTel + capture full rules.
- Create `scripts/trace-env.sh`
  - Read config and export runtime variables internally for scripts.
- Create `scripts/otel-pc-send-trace-smoke.sh`
  - Run PC real send, extract trace id, call checker.
- Modify `scripts/otel-trace-check.mjs`
  - Assert required spans, same trace id, ordering, HTTP capture, WS capture.
- Modify `src/app/im/trace-context.service.ts`
  - Add child span helper and trace id parser for PC chain.
- Modify `src/app/im/tauri-bridge.service.ts`
  - Keep sidecar injection in bridge and add trace metadata for invoke.
- Modify `src-tauri/src/trace.rs`
  - Normalize sidecar and expose trace id/span id helpers.
- Add tests:
  - `src/app/im/trace-context.service.spec.ts`
  - `src-tauri/src/trace.rs` unit tests
  - `scripts/otel-trace-check.fixture.test.mjs` if this repo uses node test scripts; otherwise self-test fixture in checker.

### `/System/Volumes/Data/workspace/c/mobile-qucik-c++`

- Modify `config/mobile-local.json`
  - Default-on OTel + capture full rules.
- Create `scripts/trace-env.sh`
  - Read config and export Collector / Jaeger runtime variables internally.
- Create `cpp/OtelRuntime.hpp`
- Create `cpp/OtelRuntime.cpp`
  - C++ OTel lifecycle and RAII span wrapper.
- Modify `cpp/TraceContext.*`
  - Keep local root generation and expose trace id/span id parsing.
- Modify `quickjs/bind_mobile_im.cpp`
  - Ensure `im.send(input)` creates trace internally and calls `CoreBridge::callWithTrace`.
- Modify `scripts/real-chain/run-real-chain.mjs`
  - Record trace id and Jaeger evidence.
- Modify `Makefile`
  - Add `real-chain-trace`.
- Add tests:
  - extend `tests/gtest/MobileSdkSpecTest.cpp`
  - add or extend QuickJS binding tests that prove no public trace arg.

### `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine`

- Update run state only after implementation:
  - `.loop-engine/runs/trace-otel-20260706-161854/evidence/*.md`
  - `.loop-engine/ledger.jsonl`

---

### Task 1: Go Capture Policy And HTTP Capture

**Files:**
- Modify: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/config/config.go`
- Modify: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/config/yaml_source.go`
- Modify: `/System/Volumes/Data/workspace/golang/cses-im-server/config.yaml`
- Create: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/capture.go`
- Create: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/http_capture.go`
- Test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/capture_test.go`
- Test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/http_capture_test.go`

**Interfaces:**
- Consumes: `config.OtelConfig`, existing `observability.Init`, existing `traceMiddleware`.
- Produces:
  - `type CaptureConfig struct`
  - `func CompileCapturePolicy(cfg config.OtelCaptureConfig) (*CapturePolicy, error)`
  - `func (p *CapturePolicy) CaptureHeaders(header http.Header) (string, bool)`
  - `func (p *CapturePolicy) CaptureBody(r *http.Request) (bodyJSON string, captured bool, restore func() error, err error)`
  - `func (p *CapturePolicy) Enabled() bool`

- [ ] **Step 1: Run GitNexus impact for existing symbols**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
node .gitnexus/run.cjs impact --repo cses-im-server OtelConfig
node .gitnexus/run.cjs impact --repo cses-im-server traceMiddleware
```

Expected: report blast radius. If HIGH or CRITICAL, stop and ask main session before editing.

- [ ] **Step 2: Write failing config/capture tests**

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/capture_test.go`:

```go
package observability

import (
	"net/http"
	"strings"
	"testing"

	"cses-im-server/internal/config"
)

func TestCompileCapturePolicy_DefaultAllWithRedaction(t *testing.T) {
	policy, err := CompileCapturePolicy(config.OtelCaptureConfig{
		Enabled:        true,
		MaxBodyBytes:   64,
		MaxHeaderBytes: 1024,
		HTTPHeadersInclude: []string{".*"},
		HTTPHeadersExclude: []string{},
		RedactHeaders:      []string{"(?i)^authorization$", "(?i)^cookie$"},
	})
	if err != nil {
		t.Fatalf("CompileCapturePolicy: %v", err)
	}

	headers := http.Header{}
	headers.Set("cookieId", "444")
	headers.Set("companyId", "64118eebd2b665246b7880eb")
	headers.Set("Authorization", "Bearer secret")

	got, ok := policy.CaptureHeaders(headers)
	if !ok {
		t.Fatal("expected headers captured")
	}
	if !containsAll(got, []string{"cookieId", "companyId", "Authorization"}) {
		t.Fatalf("missing expected header names: %s", got)
	}
	if containsAll(got, []string{"Bearer secret"}) {
		t.Fatalf("authorization value leaked: %s", got)
	}
}

func TestCompileCapturePolicy_RejectsInvalidRegex(t *testing.T) {
	_, err := CompileCapturePolicy(config.OtelCaptureConfig{
		Enabled:            true,
		HTTPHeadersInclude: []string{"["},
	})
	if err == nil {
		t.Fatal("expected invalid regex error")
	}
}

func containsAll(s string, needles []string) bool {
	for _, needle := range needles {
		if !strings.Contains(s, needle) {
			return false
		}
	}
	return true
}
```

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/http_capture_test.go`:

```go
package observability

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"cses-im-server/internal/config"
)

func TestCaptureBodyRestoresRequestBody(t *testing.T) {
	policy, err := CompileCapturePolicy(config.OtelCaptureConfig{
		Enabled:      true,
		MaxBodyBytes: 1024,
		HTTPRequestBodyInclude: []string{".*"},
	})
	if err != nil {
		t.Fatalf("CompileCapturePolicy: %v", err)
	}

	req, err := http.NewRequest(http.MethodPost, "/api/cses/posts/create", strings.NewReader(`{"channelId":"c1","message":"hello"}`))
	if err != nil {
		t.Fatal(err)
	}

	body, ok, restore, err := policy.CaptureBody(req)
	if err != nil {
		t.Fatalf("CaptureBody: %v", err)
	}
	if !ok || !strings.Contains(body, `"message":"hello"`) {
		t.Fatalf("body not captured: ok=%v body=%q", ok, body)
	}
	if err := restore(); err != nil {
		t.Fatalf("restore: %v", err)
	}
	again, err := io.ReadAll(req.Body)
	if err != nil {
		t.Fatal(err)
	}
	if string(again) != `{"channelId":"c1","message":"hello"}` {
		t.Fatalf("body not restored: %q", again)
	}
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
GOTOOLCHAIN=local go test ./internal/observability -run 'TestCompileCapturePolicy|TestCaptureBodyRestoresRequestBody' -count=1
```

Expected: FAIL with undefined `CompileCapturePolicy` or `OtelCaptureConfig`.

- [ ] **Step 4: Implement config structs and dotted keys**

Add to `/System/Volumes/Data/workspace/golang/cses-im-server/internal/config/config.go`:

```go
type OtelCaptureConfig struct {
	Enabled                bool
	MaxBodyBytes           int64
	MaxHeaderBytes         int64
	HTTPHeadersInclude     []string
	HTTPHeadersExclude     []string
	HTTPRequestBodyInclude []string
	HTTPRequestBodyExclude []string
	WSActionsInclude       []string
	WSActionsExclude       []string
	WSPayloadInclude       []string
	WSPayloadExclude       []string
	RedactHeaders          []string
	RedactJSONPaths        []string
}
```

Add field to `OtelConfig`:

```go
Capture OtelCaptureConfig
```

Add load helper:

```go
func loadOtelCaptureConfig(ctx context.Context, s Source) OtelCaptureConfig {
	return OtelCaptureConfig{
		Enabled:                boolValue(ctx, s, keyOtelCaptureEnabled, true),
		MaxBodyBytes:           int64Value(ctx, s, keyOtelCaptureMaxBodyBytes, 65536),
		MaxHeaderBytes:         int64Value(ctx, s, keyOtelCaptureMaxHeaderBytes, 16384),
		HTTPHeadersInclude:     csvValue(ctx, s, keyOtelCaptureHTTPHeadersInclude, []string{".*"}),
		HTTPHeadersExclude:     csvValue(ctx, s, keyOtelCaptureHTTPHeadersExclude, nil),
		HTTPRequestBodyInclude: csvValue(ctx, s, keyOtelCaptureHTTPRequestBodyInclude, []string{".*"}),
		HTTPRequestBodyExclude: csvValue(ctx, s, keyOtelCaptureHTTPRequestBodyExclude, nil),
		WSActionsInclude:       csvValue(ctx, s, keyOtelCaptureWSActionsInclude, []string{".*"}),
		WSActionsExclude:       csvValue(ctx, s, keyOtelCaptureWSActionsExclude, nil),
		WSPayloadInclude:       csvValue(ctx, s, keyOtelCaptureWSPayloadInclude, []string{".*"}),
		WSPayloadExclude:       csvValue(ctx, s, keyOtelCaptureWSPayloadExclude, nil),
		RedactHeaders:          csvValue(ctx, s, keyOtelCaptureRedactHeaders, []string{"(?i)^authorization$", "(?i)^cookie$"}),
		RedactJSONPaths:        csvValue(ctx, s, keyOtelCaptureRedactJSONPaths, []string{"$.password", "$.token"}),
	}
}
```

If existing helpers have different names, implement equivalent private helpers with exact behavior in `config.go` and unit test them.

- [ ] **Step 5: Implement capture policy**

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/capture.go` with:

```go
package observability

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"cses-im-server/internal/config"
)

type CapturePolicy struct {
	cfg config.OtelCaptureConfig
	httpHeaderInclude []*regexp.Regexp
	httpHeaderExclude []*regexp.Regexp
	redactHeaders    []*regexp.Regexp
}

func CompileCapturePolicy(cfg config.OtelCaptureConfig) (*CapturePolicy, error) {
	if !cfg.Enabled {
		return &CapturePolicy{cfg: cfg}, nil
	}
	if len(cfg.HTTPHeadersInclude) == 0 {
		cfg.HTTPHeadersInclude = []string{".*"}
	}
	p := &CapturePolicy{cfg: cfg}
	var err error
	if p.httpHeaderInclude, err = compileRegexes("http header include", cfg.HTTPHeadersInclude); err != nil {
		return nil, err
	}
	if p.httpHeaderExclude, err = compileRegexes("http header exclude", cfg.HTTPHeadersExclude); err != nil {
		return nil, err
	}
	if p.redactHeaders, err = compileRegexes("redact header", cfg.RedactHeaders); err != nil {
		return nil, err
	}
	return p, nil
}

func (p *CapturePolicy) Enabled() bool {
	return p != nil && p.cfg.Enabled
}

func (p *CapturePolicy) CaptureHeaders(header http.Header) (string, bool) {
	if !p.Enabled() || len(header) == 0 {
		return "", false
	}
	out := map[string][]string{}
	for key, values := range header {
		if !matchesAny(p.httpHeaderInclude, key) || matchesAny(p.httpHeaderExclude, key) {
			continue
		}
		if matchesAny(p.redactHeaders, key) {
			out[key] = []string{"<redacted>"}
			continue
		}
		out[key] = values
	}
	if len(out) == 0 {
		return "", false
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "", false
	}
	return string(data), true
}

func compileRegexes(label string, patterns []string) ([]*regexp.Regexp, error) {
	out := make([]*regexp.Regexp, 0, len(patterns))
	for _, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			continue
		}
		re, err := regexp.Compile(pattern)
		if err != nil {
			return nil, fmt.Errorf("%s regex %q: %w", label, pattern, err)
		}
		out = append(out, re)
	}
	return out, nil
}

func matchesAny(regexes []*regexp.Regexp, value string) bool {
	for _, re := range regexes {
		if re.MatchString(value) {
			return true
		}
	}
	return false
}
```

- [ ] **Step 6: Implement HTTP body capture**

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/http_capture.go`:

```go
package observability

import (
	"bytes"
	"io"
	"net/http"
)

func (p *CapturePolicy) CaptureBody(r *http.Request) (string, bool, func() error, error) {
	if !p.Enabled() || r == nil || r.Body == nil {
		return "", false, func() error { return nil }, nil
	}
	limit := p.cfg.MaxBodyBytes
	if limit <= 0 {
		limit = 65536
	}
	data, err := io.ReadAll(io.LimitReader(r.Body, limit+1))
	if err != nil {
		return "", false, func() error { return nil }, err
	}
	_ = r.Body.Close()
	truncated := int64(len(data)) > limit
	if truncated {
		data = data[:limit]
	}
	restore := func() error {
		r.Body = io.NopCloser(bytes.NewReader(data))
		return nil
	}
	body := string(data)
	if truncated {
		body = body + "\n<truncated>"
	}
	return body, len(data) > 0, restore, nil
}
```

- [ ] **Step 7: Add config defaults**

Append to `/System/Volumes/Data/workspace/golang/cses-im-server/config.yaml`:

```yaml
observability.otel.capture.enabled: "true"
observability.otel.capture.maxBodyBytes: "65536"
observability.otel.capture.maxHeaderBytes: "16384"
observability.otel.capture.http.headers.include: ".*"
observability.otel.capture.http.headers.exclude: ""
observability.otel.capture.http.requestBody.include: ".*"
observability.otel.capture.http.requestBody.exclude: ""
observability.otel.capture.ws.actions.include: ".*"
observability.otel.capture.ws.actions.exclude: ""
observability.otel.capture.ws.payload.include: ".*"
observability.otel.capture.ws.payload.exclude: ""
observability.otel.capture.redact.headers: "(?i)^authorization$,(?i)^cookie$"
observability.otel.capture.redact.jsonPaths: "$.password,$.token"
```

- [ ] **Step 8: Run focused tests**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
GOTOOLCHAIN=local go test ./internal/config ./internal/observability -run 'Otel|Capture' -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
git add internal/config internal/observability config.yaml
git commit -m "feat(trace): add capture policy and http body capture"
```

---

### Task 2: Go HTTP Middleware And WS Payload Capture

**Files:**
- Modify: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/api/trace_middleware.go`
- Modify: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/ws/trace.go`
- Create: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/ws_capture.go`
- Test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/api/trace_middleware_test.go`
- Test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/ws/trace_envelope_test.go`
- Test: `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/ws_capture_test.go`

**Interfaces:**
- Consumes: `CapturePolicy` from Task 1, existing `WebSocketEvent.GetTracing`, `ResolveBroadcastViewerUserIds`, `EventType`, `GetBroadcast`.
- Produces:
  - HTTP span events named `http.request.capture`.
  - WS span events named `ws.payload.capture`.
  - Attributes `trace.direction`, `target.user_id`, `target.user_ids_json`, `viewer.count`, `payload.bytes`.

- [ ] **Step 1: Run GitNexus impact**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
node .gitnexus/run.cjs impact --repo cses-im-server traceMiddleware
node .gitnexus/run.cjs impact --repo cses-im-server startFanoutSpan
node .gitnexus/run.cjs impact --repo cses-im-server startDeliverSpan
```

Expected: report risk before editing.

- [ ] **Step 2: Write failing HTTP middleware test**

Append to `/System/Volumes/Data/workspace/golang/cses-im-server/internal/api/trace_middleware_test.go`:

```go
func TestTraceMiddlewareCapturesHeadersAndBody(t *testing.T) {
	exporter, tp := setupTraceProvider(t)
	router := mux.NewRouter()
	router.Use(traceMiddleware(config.OtelConfig{
		Enabled: true,
		Facets: map[string]bool{"http": true},
		Capture: config.OtelCaptureConfig{
			Enabled: true,
			MaxBodyBytes: 1024,
			HTTPHeadersInclude: []string{".*"},
			HTTPRequestBodyInclude: []string{".*"},
		},
	}))
	router.HandleFunc("/api/cses/posts/create", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"message":"hello"`) {
			t.Fatalf("handler body not restored: %s", body)
		}
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/cses/posts/create", strings.NewReader(`{"message":"hello"}`))
	req.Header.Set("cookieId", "444")
	req.Header.Set("companyId", "64118eebd2b665246b7880eb")
	router.ServeHTTP(httptest.NewRecorder(), req)
	_ = tp.ForceFlush(context.Background())

	spans := exporter.GetSpans()
	if len(spans) != 1 {
		t.Fatalf("spans = %d", len(spans))
	}
	events := spans[0].Events()
	if len(events) == 0 || events[0].Name != "http.request.capture" {
		t.Fatalf("missing capture event: %+v", events)
	}
}
```

Add missing imports if needed: `io`, `strings`.

- [ ] **Step 3: Write failing WS capture test**

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/ws_capture_test.go`:

```go
package observability

import (
	"strings"
	"testing"

	"cses-im-server/internal/config"
)

func TestCaptureWSPayloadIncludesActionTargetAndPayload(t *testing.T) {
	policy, err := CompileCapturePolicy(config.OtelCaptureConfig{
		Enabled: true,
		WSPayloadInclude: []string{".*"},
		WSActionsInclude: []string{".*"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got, ok := policy.CaptureWSPayload("posted", []string{"444", "678"}, []byte(`{"event":"posted","data":{"post":{"id":"p1"}}}`))
	if !ok {
		t.Fatal("expected ws payload captured")
	}
	for _, needle := range []string{`"action":"posted"`, `"444"`, `"678"`, `"payload_json"`} {
		if !strings.Contains(got, needle) {
			t.Fatalf("missing %s in %s", needle, got)
		}
	}
}
```

- [ ] **Step 4: Run tests to verify fail**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
GOTOOLCHAIN=local go test ./internal/api ./internal/observability ./internal/ws -run 'Capture|TraceMiddlewareCaptures' -count=1
```

Expected: FAIL with missing capture methods/events.

- [ ] **Step 5: Implement WS capture helper**

Create `/System/Volumes/Data/workspace/golang/cses-im-server/internal/observability/ws_capture.go`:

```go
package observability

import "encoding/json"

func (p *CapturePolicy) CaptureWSPayload(action string, targetUserIDs []string, payload []byte) (string, bool) {
	if !p.Enabled() {
		return "", false
	}
	if len(p.cfg.WSActionsInclude) > 0 {
		compiled, err := compileRegexes("ws action include", p.cfg.WSActionsInclude)
		if err != nil || !matchesAny(compiled, action) {
			return "", false
		}
	}
	limit := p.cfg.MaxBodyBytes
	if limit <= 0 {
		limit = 65536
	}
	truncated := int64(len(payload)) > limit
	if truncated {
		payload = payload[:limit]
	}
	out := map[string]any{
		"action": action,
		"target_user_ids": targetUserIDs,
		"payload_json": string(payload),
		"capture_truncated": truncated,
	}
	data, err := json.Marshal(out)
	if err != nil {
		return "", false
	}
	return string(data), true
}
```

If regex recompilation appears in hot path, refactor by storing compiled WS regexes in `CapturePolicy` before commit.

- [ ] **Step 6: Wire HTTP capture into middleware**

In `traceMiddleware`, compile policy once when middleware is built:

```go
policy, policyErr := observability.CompileCapturePolicy(cfg.Capture)
if policyErr != nil {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, policyErr.Error(), http.StatusInternalServerError)
		})
	}
}
```

Inside the handler, before `next.ServeHTTP`:

```go
if headersJSON, ok := policy.CaptureHeaders(r.Header); ok {
	span.AddEvent("http.request.capture", trace.WithAttributes(attribute.String("capture.headers_json", headersJSON)))
}
if bodyJSON, ok, restore, err := policy.CaptureBody(r); err == nil && ok {
	span.AddEvent("http.request.capture", trace.WithAttributes(attribute.String("capture.body_json", bodyJSON)))
	_ = restore()
}
```

Keep existing status handling and `Hijack` support intact.

- [ ] **Step 7: Wire WS capture into publish/fanout/deliver spans**

In `/System/Volumes/Data/workspace/golang/cses-im-server/internal/ws/trace.go`, add target extraction helper:

```go
func targetUserIDs(ev *WebSocketEvent) []string {
	if ev == nil || ev.GetBroadcast() == nil {
		return nil
	}
	b := ev.GetBroadcast()
	if b.UserId != "" {
		return []string{b.UserId}
	}
	if len(b.UserIds) > 0 {
		return append([]string(nil), b.UserIds...)
	}
	if viewers, restricted := ev.ResolveBroadcastViewerUserIds(); restricted {
		return viewers
	}
	return nil
}
```

Add capture event to fanout/deliver span if a policy is available. If `ws` package does not currently receive config, add a narrow optional `SetTraceCapturePolicy(*observability.CapturePolicy)` on hub construction rather than a global mutable default.

- [ ] **Step 8: Run focused tests**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
GOTOOLCHAIN=local go test ./internal/api ./internal/observability ./internal/ws -run 'Trace|Capture|WSPayload' -count=1
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
git add internal/api/trace_middleware.go internal/api/trace_middleware_test.go internal/ws/trace.go internal/ws/trace_envelope_test.go internal/observability
git commit -m "feat(trace): capture http and websocket payload evidence"
```

---

### Task 3: Helix Host And FFI OTel Boundaries

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/otel.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/lib.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/trace.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/http_cross.rs`
- Modify: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/src/api.rs`
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/otel_boundary_test.rs`
- Test: `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-ffi/tests/trace_command_test.rs`

**Interfaces:**
- Consumes: existing `TraceCarrier`, `TraceHooks`, `helix_command_with_trace`, `CrossCuttingHttp`.
- Produces:
  - `HostOtelConfig`
  - `HostOtelRuntime::new(config: HostOtelConfig) -> Self`
  - `HostOtelRuntime::span(&self, name: &'static str, direction: TraceDirection, carrier: Option<&TraceCarrier>) -> HostSpanScope`
  - span names: `helix.command.accept`, `helix.core.step`, `helix.storage.persist`, `helix.event.emit`, `helix.http.request`, `helix.ws.recv`, `mobile.ffi.command`.

- [ ] **Step 1: Run GitNexus impact**

```bash
cd /System/Volumes/Data/workspace/rust/helix
node .gitnexus/run.cjs impact --repo helix TraceHooks
node .gitnexus/run.cjs impact --repo helix CrossCuttingHttp
node .gitnexus/run.cjs impact --repo helix helix_command_with_trace
```

Expected: report blast radius before edits.

- [ ] **Step 2: Write failing host OTel boundary test**

Create `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/tests/otel_boundary_test.rs`:

```rust
use helix_driver_host::{HostOtelConfig, HostOtelRuntime, TraceCarrier, TraceDirection};

#[test]
fn host_otel_runtime_extracts_traceparent_and_starts_child_span() {
    let runtime = HostOtelRuntime::new(HostOtelConfig {
        enabled: true,
        service_name: "helix-test".to_string(),
        endpoint: "noop".to_string(),
        protocol: "noop".to_string(),
    });
    let carrier = TraceCarrier::from_json_str(
        r#"{"traceparent":"00-00000000000000000000000000000001-0000000000000002-01","baggage":"client=test"}"#,
    )
    .expect("carrier");

    let scope = runtime.span("helix.command.accept", TraceDirection::Inbound, Some(&carrier));
    assert_eq!(scope.trace_id_for_test().as_deref(), Some("00000000000000000000000000000001"));
    assert_eq!(scope.name_for_test(), "helix.command.accept");
}
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo test -p helix-driver-host --test otel_boundary_test -- --nocapture
```

Expected: FAIL with unresolved `HostOtelRuntime`.

- [ ] **Step 4: Implement host OTel adapter with noop protocol**

Create `/System/Volumes/Data/workspace/rust/helix/crates/helix-driver-host/src/otel.rs`:

```rust
use crate::trace::TraceCarrier;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HostOtelConfig {
    pub enabled: bool,
    pub service_name: String,
    pub endpoint: String,
    pub protocol: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TraceDirection {
    Inbound,
    Outbound,
    Internal,
}

#[derive(Clone, Debug)]
pub struct HostOtelRuntime {
    config: HostOtelConfig,
}

impl HostOtelRuntime {
    pub fn new(config: HostOtelConfig) -> Self {
        Self { config }
    }

    pub fn span(&self, name: &'static str, direction: TraceDirection, carrier: Option<&TraceCarrier>) -> HostSpanScope {
        let trace_id = carrier
            .and_then(|c| c.traceparent.as_deref())
            .and_then(parse_trace_id);
        HostSpanScope {
            name,
            direction,
            trace_id,
            enabled: self.config.enabled,
        }
    }
}

#[derive(Debug)]
pub struct HostSpanScope {
    name: &'static str,
    direction: TraceDirection,
    trace_id: Option<String>,
    enabled: bool,
}

impl HostSpanScope {
    pub fn trace_id_for_test(&self) -> Option<String> {
        self.trace_id.clone()
    }

    pub fn name_for_test(&self) -> &'static str {
        self.name
    }
}

impl Drop for HostSpanScope {
    fn drop(&mut self) {
        let _ = self.enabled;
        let _ = self.direction;
    }
}

fn parse_trace_id(traceparent: &str) -> Option<String> {
    let mut parts = traceparent.split('-');
    let _version = parts.next()?;
    let trace_id = parts.next()?;
    if trace_id.len() == 32 {
        Some(trace_id.to_string())
    } else {
        None
    }
}
```

Export from `lib.rs`:

```rust
pub use otel::{HostOtelConfig, HostOtelRuntime, TraceDirection};
pub mod otel;
```

- [ ] **Step 5: Wire boundary calls without touching helix-core**

Implement spans in host/FFI layers only:

```rust
let _scope = runtime.span("helix.command.accept", TraceDirection::Inbound, carrier.as_ref());
```

For `helix_command_with_trace`, emit `mobile.ffi.command` before pushing the command if host runtime is available. If runtime is not yet available in FFI handle, add an optional noop runtime field to `HelixHandle`; do not pass OTel through `Tick::Command`.

- [ ] **Step 6: Run Helix focused gates**

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo test -p helix-driver-host --test otel_boundary_test -- --nocapture
cargo test -p helix-driver-ffi trace_command -- --nocapture
bash scripts/trace-static-gate.sh
```

Expected: PASS and static gate confirms no trace pollution in `helix-core`.

- [ ] **Step 7: Commit**

```bash
cd /System/Volumes/Data/workspace/rust/helix
git add crates/helix-driver-host crates/helix-driver-ffi scripts/trace-static-gate.sh
git commit -m "feat(trace): add helix host otel boundaries"
```

---

### Task 4: Loopforge Config, Trace Env, And Jaeger Checker

**Files:**
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/config/dev-local.json`
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/trace-env.sh`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/otel-trace-check.mjs`
- Test: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/otel-trace-check.mjs`
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/test/fixtures/jaeger/pc-send-trace.json`
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/test/fixtures/jaeger/mobile-send-trace.json`

**Interfaces:**
- Consumes: existing config JSON and checker.
- Produces:
  - `scripts/trace-env.sh` exports `OTEL_EXPORTER_OTLP_ENDPOINT`, `JAEGER_QUERY_URL`, `TRACE_CAPTURE_ENABLED` internally for scripts.
  - Checker validates required spans, ordering, trace id uniqueness, `http.request.capture`, `ws.payload.capture`.

- [ ] **Step 1: Write failing checker fixture**

Create `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/test/fixtures/jaeger/pc-send-trace.json` with a Jaeger-shaped response containing these operation names in order:

```json
{
  "data": [
    {
      "traceID": "11111111111111111111111111111111",
      "spans": [
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000001","operationName":"pc.ui.action","startTime":1,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000002","operationName":"pc.tauri.invoke","startTime":2,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000003","operationName":"pc.tauri.command","startTime":3,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000004","operationName":"helix.command.accept","startTime":4,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000005","operationName":"helix.core.step","startTime":5,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000006","operationName":"helix.storage.persist","startTime":6,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000007","operationName":"helix.event.emit","startTime":7,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000008","operationName":"helix.http.request","startTime":8,"logs":[{"fields":[{"key":"event","value":"http.request.capture"}]}]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000009","operationName":"cses.http.request","startTime":9,"logs":[{"fields":[{"key":"event","value":"http.request.capture"}]}]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000010","operationName":"cses.handler.create_post","startTime":10,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000011","operationName":"cses.service.create_post","startTime":11,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000012","operationName":"cses.store.create_post","startTime":12,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000013","operationName":"cses.ws.publish","startTime":13,"logs":[{"fields":[{"key":"event","value":"ws.payload.capture"}]}]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000014","operationName":"cses.ws.fanout","startTime":14,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000015","operationName":"cses.ws.deliver","startTime":15,"logs":[{"fields":[{"key":"event","value":"ws.payload.capture"}]}]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000016","operationName":"helix.ws.recv","startTime":16,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000017","operationName":"helix.event.emit","startTime":17,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000018","operationName":"pc.tauri.app_emit","startTime":18,"logs":[]},
        {"traceID":"11111111111111111111111111111111","spanID":"0000000000000019","operationName":"pc.ui.render","startTime":19,"logs":[]}
      ]
    }
  ]
}
```

- [ ] **Step 2: Run checker and verify missing assertions fail**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
node scripts/otel-trace-check.mjs --input test/fixtures/jaeger/pc-send-trace.json 11111111111111111111111111111111
```

Expected before implementation: likely PASS for old count-only checker but does not mention ordering/capture. Treat this as failing if output does not contain `ordering=ok` and `capture=ok`.

- [ ] **Step 3: Implement trace-env script**

Create `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/trace-env.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="${LOOPFORGE_PROFILE:-dev-local}"
CONFIG="$ROOT/config/${PROFILE}.json"

if [ ! -f "$CONFIG" ]; then
  echo "trace config not found: $CONFIG" >&2
  exit 2
fi

export OTEL_EXPORTER_OTLP_ENDPOINT="$("$ROOT/node_modules/.bin/json" -f "$CONFIG" observability.otel.endpoint 2>/dev/null || node -e "const c=require('$CONFIG'); console.log(c.observability.otel.endpoint)")"
export JAEGER_QUERY_URL="$("$ROOT/node_modules/.bin/json" -f "$CONFIG" observability.otel.jaegerQueryUrl 2>/dev/null || node -e "const c=require('$CONFIG'); console.log(c.observability.otel.jaegerQueryUrl || 'http://192.168.6.66:32281')")"
export TRACE_CAPTURE_ENABLED="$("$ROOT/node_modules/.bin/json" -f "$CONFIG" observability.otel.capture.enabled 2>/dev/null || node -e "const c=require('$CONFIG'); console.log(String(c.observability.otel.capture?.enabled ?? true))")"
```

If `node_modules/.bin/json` is absent, the Node fallback is the supported path.

- [ ] **Step 4: Add config defaults**

Modify `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/config/dev-local.json`:

```json
"capture": {
  "enabled": true,
  "maxBodyBytes": 65536,
  "maxHeaderBytes": 16384,
  "http": {
    "headers": { "include": [".*"], "exclude": [] },
    "requestBody": { "includePath": [".*"], "excludePath": [] }
  },
  "ws": {
    "actions": { "include": [".*"], "exclude": [] },
    "payload": { "include": [".*"], "exclude": [] }
  },
  "redact": {
    "headers": ["(?i)^authorization$", "(?i)^cookie$"],
    "jsonPaths": ["$.password", "$.token"]
  }
},
"jaegerQueryUrl": "http://192.168.6.66:32281"
```

Keep existing endpoint as `http://127.0.0.1:4318` only if local-only profile is intentional. For this accepted spec, set real-chain profile endpoint to `http://opentelemetry-collector.monitoring.svc.cluster.local:4317`.

- [ ] **Step 5: Upgrade checker**

In `scripts/otel-trace-check.mjs`, add:

```js
function assertSameTraceId(body, expectedTraceId) {
  const traces = Array.isArray(body?.data) ? body.data : [];
  const ids = new Set(traces.flatMap((trace) => (trace.spans || []).map((span) => span.traceID)));
  if (ids.size !== 1 || !ids.has(expectedTraceId)) {
    throw new Error(`trace id mismatch: expected ${expectedTraceId}, got ${[...ids].join(",")}`);
  }
}

function assertOrdered(body, requiredNames) {
  const spans = (body?.data?.[0]?.spans || []).slice().sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
  let cursor = 0;
  for (const span of spans) {
    if (span.operationName === requiredNames[cursor]) {
      cursor += 1;
    }
  }
  if (cursor !== requiredNames.length) {
    throw new Error(`ordering check failed at ${requiredNames[cursor]}`);
  }
}

function spanHasLogEvent(span, eventName) {
  return (span.logs || []).some((log) =>
    (log.fields || []).some((field) => field.key === "event" && field.value === eventName),
  );
}

function assertCaptureEvents(body) {
  const spans = body?.data?.[0]?.spans || [];
  if (!spans.some((span) => spanHasLogEvent(span, "http.request.capture"))) {
    throw new Error("missing http.request.capture event");
  }
  if (!spans.some((span) => spanHasLogEvent(span, "ws.payload.capture"))) {
    throw new Error("missing ws.payload.capture event");
  }
}
```

Call these after `evaluateTrace(counts)` and print:

```js
console.log(`trace ${args.traceId} ordering=ok capture=ok same_trace=ok`);
```

- [ ] **Step 6: Run checker self-tests**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
node --check scripts/otel-trace-check.mjs
node scripts/otel-trace-check.mjs --input test/fixtures/jaeger/pc-send-trace.json 11111111111111111111111111111111
```

Expected: PASS with `ordering=ok capture=ok same_trace=ok`.

- [ ] **Step 7: Commit**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
git add config/dev-local.json scripts/trace-env.sh scripts/otel-trace-check.mjs test/fixtures/jaeger
git commit -m "feat(trace): add config-driven jaeger checker"
```

---

### Task 5: Loopforge PC Send Trace Smoke

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/otel-pc-send-trace-smoke.sh`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src/app/im/trace-context.service.ts`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src/app/im/tauri-bridge.service.ts`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src-tauri/src/trace.rs`
- Test: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src/app/im/trace-context.service.spec.ts`

**Interfaces:**
- Consumes: `scripts/trace-env.sh`, `scripts/otel-trace-check.mjs`, existing WDIO/run scripts.
- Produces:
  - `bash scripts/otel-pc-send-trace-smoke.sh`
  - trace id extraction artifact under `/tmp/loopforge/trace/pc-send-trace-id.txt`
  - PC chain spans from `pc.ui.action` to `pc.ui.render`.

- [ ] **Step 1: Write failing Angular trace-context test**

Create or extend `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/src/app/im/trace-context.service.spec.ts`:

```ts
import { TestBed } from "@angular/core/testing";
import { TraceContextService } from "./trace-context.service";

describe("TraceContextService", () => {
  it("creates valid W3C traceparent and exposes trace id", () => {
    const service = TestBed.inject(TraceContextService);
    const trace = service.startTrace();
    expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(service.traceId(trace)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("creates child sidecar without changing trace id", () => {
    const service = TestBed.inject(TraceContextService);
    const root = service.startTrace();
    const child = service.childTrace(root);
    expect(service.traceId(child)).toBe(service.traceId(root));
    expect(child.traceparent).not.toBe(root.traceparent);
  });
});
```

- [ ] **Step 2: Run test to verify fail**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
pnpm test -- --watch=false --include src/app/im/trace-context.service.spec.ts
```

Expected: FAIL with missing `traceId` / `childTrace`.

- [ ] **Step 3: Implement PC trace helpers**

Add to `TraceContextService`:

```ts
traceId(trace: TraceSidecar): string {
  return trace.traceparent.split("-")[1] ?? "";
}

childTrace(parent: TraceSidecar): TraceSidecar {
  const parts = parent.traceparent.split("-");
  if (parts.length !== 4) {
    return this.startTrace();
  }
  return {
    traceparent: `${parts[0]}-${parts[1]}-${nonZeroHex(8)}-${parts[3]}`,
    baggage: parent.baggage,
  };
}
```

- [ ] **Step 4: Implement PC smoke script**

Create `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/scripts/otel-pc-send-trace-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT/scripts/trace-env.sh"

mkdir -p /tmp/loopforge/trace
TRACE_ID_FILE=/tmp/loopforge/trace/pc-send-trace-id.txt
rm -f "$TRACE_ID_FILE"

cd "$ROOT"
bash scripts/run.sh -- --spec test/specs/uc-send-1.e2e.mjs

if [ ! -s "$TRACE_ID_FILE" ]; then
  echo "missing PC trace id file: $TRACE_ID_FILE" >&2
  exit 1
fi

TRACE_ID="$(tr -d '\n\r ' < "$TRACE_ID_FILE")"
node scripts/otel-trace-check.mjs --jaeger-url "$JAEGER_QUERY_URL" "$TRACE_ID"
```

If the existing WDIO spec writes run evidence elsewhere, adapt the trace id write to the existing evidence file and document exact path in script comments.

- [ ] **Step 5: Run focused frontend and script checks**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
pnpm test -- --watch=false --include src/app/im/trace-context.service.spec.ts
bash -n scripts/trace-env.sh
bash -n scripts/otel-pc-send-trace-smoke.sh
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
git add src/app/im/trace-context.service.ts src/app/im/trace-context.service.spec.ts src/app/im/tauri-bridge.service.ts src-tauri/src/trace.rs scripts/otel-pc-send-trace-smoke.sh
git commit -m "feat(trace): add pc send jaeger smoke"
```

---

### Task 6: Mobile Trace Runtime And Real-Chain Gate

**Files:**
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/config/mobile-local.json`
- Create: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/trace-env.sh`
- Create: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/OtelRuntime.hpp`
- Create: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/OtelRuntime.cpp`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/TraceContext.hpp`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/cpp/TraceContext.cpp`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/quickjs/bind_mobile_im.cpp`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/real-chain/run-real-chain.mjs`
- Modify: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/Makefile`
- Test: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileSdkSpecTest.cpp`

**Interfaces:**
- Consumes: existing `TraceContext.localRoot()`, `CoreBridge::callWithTrace`, real-chain runner.
- Produces:
  - `REAL_CHAIN_CASE=UC-1.1 make real-chain-trace`
  - spans `mobile.js.im_send`, `mobile.quickjs.call`, `mobile.cpp.call_with_trace`, `mobile.ffi.command`, `mobile.cpp.event_batch`, `mobile.js.event_drain`, `mobile.render`.

- [ ] **Step 1: Run preflight and keep dirty files out of scope**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git status --short
```

Expected: existing unrelated `.idea/`, old `real-chain/reports/*.json`, `ssh.log`, or root docs may exist. Do not stage them unless the task explicitly modifies them.

- [ ] **Step 2: Write failing gtest for no public trace arg and trace id parsing**

Append to `/System/Volumes/Data/workspace/c/mobile-qucik-c++/tests/gtest/MobileSdkSpecTest.cpp`:

```cpp
TEST(TraceContextSpec, LocalRootHasTraceIdAndChildSpan) {
  mobile::TraceContext root = mobile::TraceContext::localRoot();
  EXPECT_THAT(root.traceparent, ::testing::MatchesRegex("00-[0-9a-f]{32}-[0-9a-f]{16}-01"));
  EXPECT_EQ(root.traceId().size(), 32);
  mobile::TraceContext child = root.child();
  EXPECT_EQ(child.traceId(), root.traceId());
  EXPECT_NE(child.traceparent, root.traceparent);
}
```

- [ ] **Step 3: Run test to verify fail**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
make gtest-js-spec
```

Expected: FAIL with missing `traceId` / `child`.

- [ ] **Step 4: Implement C++ trace helpers**

Add to `TraceContext.hpp`:

```cpp
std::string traceId() const;
TraceContext child() const;
```

Add to `TraceContext.cpp`:

```cpp
std::string TraceContext::traceId() const {
  const auto first = traceparent.find('-');
  if (first == std::string::npos) return {};
  const auto second = traceparent.find('-', first + 1);
  if (second == std::string::npos) return {};
  return traceparent.substr(first + 1, second - first - 1);
}

TraceContext TraceContext::child() const {
  return TraceContext{"00-" + traceId() + "-" + randomHex(8) + "-01", baggage};
}
```

- [ ] **Step 5: Implement trace-env script**

Create `/System/Volumes/Data/workspace/c/mobile-qucik-c++/scripts/trace-env.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${MOBILE_CONFIG:-$ROOT/config/mobile-local.json}"

export OTEL_EXPORTER_OTLP_ENDPOINT="$(node -e "const c=require('$CONFIG'); console.log(c.observability.otel.endpoint)")"
export JAEGER_QUERY_URL="$(node -e "const c=require('$CONFIG'); console.log(c.observability.otel.jaegerQueryUrl || 'http://192.168.6.66:32281')")"
export TRACE_CAPTURE_ENABLED="$(node -e "const c=require('$CONFIG'); console.log(String(c.observability.otel.capture?.enabled ?? true))")"
```

- [ ] **Step 6: Add config defaults**

Modify `/System/Volumes/Data/workspace/c/mobile-qucik-c++/config/mobile-local.json` under `observability.otel`:

```json
{
  "enabled": true,
  "serviceName": "mobile-quickjs",
  "endpoint": "http://opentelemetry-collector.monitoring.svc.cluster.local:4317",
  "protocol": "grpc",
  "jaegerQueryUrl": "http://192.168.6.66:32281",
  "capture": {
    "enabled": true,
    "maxBodyBytes": 65536,
    "maxHeaderBytes": 16384,
    "http": {
      "headers": { "include": [".*"], "exclude": [] },
      "requestBody": { "includePath": [".*"], "excludePath": [] }
    },
    "ws": {
      "actions": { "include": [".*"], "exclude": [] },
      "payload": { "include": [".*"], "exclude": [] }
    }
  }
}
```

Preserve existing `apiBaseUrl` and `wsUrl` keys.

- [ ] **Step 7: Add Makefile target**

In `/System/Volumes/Data/workspace/c/mobile-qucik-c++/Makefile`:

```make
.PHONY: real-chain-trace
real-chain-trace:
	@bash scripts/trace-env.sh
	@node scripts/real-chain/run-real-chain.mjs --trace
	@node scripts/real-chain/summarize-report.mjs
```

- [ ] **Step 8: Run focused gates**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
make gtest-js-spec
bash -n scripts/trace-env.sh
REAL_CHAIN_CASE=UC-1.1 make real-chain-trace
```

Expected: gtest PASS; real-chain trace either PASS against Jaeger or, if cluster is unavailable, produce a report that clearly marks `jaeger=unreachable` without claiming green.

- [ ] **Step 9: Commit**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
git add config/mobile-local.json scripts/trace-env.sh cpp/OtelRuntime.hpp cpp/OtelRuntime.cpp cpp/TraceContext.hpp cpp/TraceContext.cpp quickjs/bind_mobile_im.cpp scripts/real-chain/run-real-chain.mjs Makefile tests/gtest/MobileSdkSpecTest.cpp
git commit -m "feat(trace): add mobile real-chain jaeger gate"
```

---

### Task 7: Cross-Repo Evidence Collector And Ledger

**Files:**
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/evidence/collector-final.md`
- Create: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/evidence/collector-state.json`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/ledger.jsonl`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/workflow.json`
- Modify: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/next.md`

**Interfaces:**
- Consumes: worker commits, reviewer reports, PC smoke output, mobile real-chain report, Jaeger trace checker output.
- Produces: collector-only green/partial/failed judgment.

- [ ] **Step 1: Collect exact commit SHAs**

```bash
git -C /System/Volumes/Data/workspace/golang/cses-im-server log --oneline -5
git -C /System/Volumes/Data/workspace/rust/helix log --oneline -5
git -C /System/Volumes/Data/workspace/rust/loopforge-tauri-im log --oneline -5
git -C /System/Volumes/Data/workspace/c/mobile-qucik-c++ log --oneline -5
```

Expected: identify one commit per completed task.

- [ ] **Step 2: Run final PC trace gate**

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
bash scripts/otel-pc-send-trace-smoke.sh
```

Expected: PASS with `same_trace=ok`, `ordering=ok`, `capture=ok`. Save output path in collector report.

- [ ] **Step 3: Run final mobile trace gate**

```bash
cd /System/Volumes/Data/workspace/c/mobile-qucik-c++
REAL_CHAIN_CASE=UC-1.1 make real-chain-trace
```

Expected: PASS with real-chain report showing HTTP, WS, bus/projection/render and Jaeger trace check. Save report path.

- [ ] **Step 4: Write collector state**

Create `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/evidence/collector-state.json`:

```json
{
  "run_id": "trace-otel-20260706-161854",
  "status": "green",
  "pc": {
    "trace_id": "<pc trace id>",
    "jaeger": "green",
    "http_capture": "observed",
    "ws_capture": "observed",
    "render": "observed"
  },
  "mobile": {
    "trace_id": "<mobile trace id>",
    "jaeger": "green",
    "http_capture": "observed",
    "ws_capture": "observed",
    "render": "observed"
  },
  "commits": {
    "cses-im-server": "<sha>",
    "helix": "<sha>",
    "loopforge-tauri-im": "<sha>",
    "mobile-qucik-c++": "<sha>"
  }
}
```

If any required facet is missing, set `"status": "partial"` and list the missing facet; do not mark green.

- [ ] **Step 5: Write collector report**

Create `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/trace-otel-20260706-161854/evidence/collector-final.md`:

```markdown
# Trace OTel Evidence Collector Final

run_id: trace-otel-20260706-161854
status: green

## PC

- trace id:
- command: `bash scripts/otel-pc-send-trace-smoke.sh`
- Jaeger: same_trace=ok / ordering=ok / capture=ok
- HTTP capture: observed
- WS capture: observed
- render: observed

## Mobile

- trace id:
- command: `REAL_CHAIN_CASE=UC-1.1 make real-chain-trace`
- Jaeger: same_trace=ok / ordering=ok / capture=ok
- HTTP capture: observed
- WS capture: observed
- render: observed

## Commits

- cses-im-server:
- helix:
- loopforge-tauri-im:
- mobile-qucik-c++:

## Judgment

Collector verdict: green. Worker reports alone were not used as runtime proof; verdict comes from Jaeger gate plus PC/mobile real-chain evidence.
```

- [ ] **Step 6: Append ledger entry**

Append one JSONL line to `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/ledger.jsonl`:

```json
{"type":"evidence_collector_verdict","run_id":"trace-otel-20260706-161854","status":"green","pc_trace_id":"<pc>","mobile_trace_id":"<mobile>","source":"jaeger+pc-smoke+mobile-real-chain","safe_summary":"四仓 Trace OTel PC/mobile 发送消息完整链路已由 Jaeger 和真实链路 gate 证明"}
```

- [ ] **Step 7: Update workflow and next**

Set `workflow.json` final node statuses:

```json
{
  "id": "evidence-collector",
  "repo": "loop-engine",
  "kind": "evidence",
  "status": "green",
  "depends_on": ["pc-trace-gate", "mobile-trace-gate"]
}
```

Set `next.md` to:

```markdown
# Next Action

状态：Trace OTel 四仓链路已 green。

下一步建议：

1. 将稳定事实沉淀到 memory。
2. 视生产策略决定是否开放 full capture 的 TTL/采样率开关。
```

- [ ] **Step 8: Commit if `.loop-engine` is intended to be versioned**

If `.loop-engine` is intentionally untracked, do not commit it. If this repo versions Loop Engine state, run:

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im
git add .loop-engine/runs/trace-otel-20260706-161854 .loop-engine/ledger.jsonl
git commit -m "docs(trace): record four repo otel evidence"
```

---

## Self-Review

- Spec coverage: The plan covers config-hidden script endpoints, default-on dev/real-chain tracing, HTTP headers/body capture, WS action/target/payload capture, PC send trace, mobile send trace, Helix no-core-pollution, Go boundary capture, and collector-only green judgment.
- Placeholder scan: no empty implementation markers or unspecified implementation steps are required for workers. Any `<sha>` / `<trace id>` values appear only in final evidence files where runtime execution must supply real values.
- Type consistency: `CapturePolicy`, `CompileCapturePolicy`, `CaptureBody`, `CaptureWSPayload`, `HostOtelRuntime`, `TraceDirection`, `traceId`, and `childTrace` are introduced before downstream tasks consume them.
- Scope check: This is a master multi-repo implementation plan. Each task is repo-scoped and can be executed/reviewed independently; final green is reserved for the collector.
