# Trace Scope Contract

Canonical contract:

`/System/Volumes/Data/workspace/rust/helix/docs/trace/trace-scope-contract.md`

Loopforge must follow the PC chain from that contract:

```text
pc.ui.action
-> pc.tauri.invoke.out | pc.tauri.invoke
-> pc.tauri.command.enqueue | pc.tauri.command
-> helix.command.accept
-> helix.core.step
-> helix.storage.persist
-> helix.event.emit
-> helix.http.request
-> cses.http.request
-> cses.handler.create_post
-> cses.service.create_post
-> cses.store.create_post
-> cses.ws.publish
-> cses.ws.fanout
-> cses.ws.deliver
-> helix.ws.recv
-> helix.event.emit
-> pc.tauri.app_emit
-> pc.ui.render
```

Proof must come from OTLP -> Collector -> Jaeger. Local JSONL is debug fallback only.

Run:

```bash
bash scripts/otel-pc-send-trace-smoke.sh
```

