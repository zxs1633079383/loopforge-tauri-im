# L2 Evidence Runbook

L2 proof is recoverable only when the per-spec archive contains:

- `run.jsonl`
- `wdio-out.log`
- `summary.md`
- `evidence/*.dom.json` for UI-observed L2 specs
- `evidence/*.observer.json` for raw-WS observed L2 specs

Evidence type must match the actual observation surface:

- UI-observed specs capture DOM selectors from the WDIO browser.
- Raw-WS observed specs capture the second actor's user id, action, channel anchor, assertion fields, and matching WS frame(s).

Do not store the 444 owner window as observer DOM for specs whose observer is a raw-WS actor. Those specs stay raw-WS closure proof until the dual-account debug UI can render the secondary actor.
