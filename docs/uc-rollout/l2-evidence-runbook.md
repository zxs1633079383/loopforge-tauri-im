# L2 Evidence Runbook

L2 proof is recoverable only when the per-spec archive contains:

- `run.jsonl`
- `wdio-out.log`
- `summary.md`
- `evidence/*.dom.json` for UI-observed L2 specs
- `evidence/*.observer.json` for raw-WS observed L2 specs

## How Evidence Is Produced

`scripts/run.sh` exports:

```bash
LOOPFORGE_EVIDENCE_DIR="${LOOPFORGE_EVIDENCE_DIR:-$RUN_LOG_DIR/evidence}"
```

WDIO specs write evidence files through:

- `captureDomEvidence(browser, name, selectors)` from `test/helpers/dom-evidence.mjs`
- `captureObserverEvidence(name, evidence)` from `test/helpers/l2-evidence.mjs`

`scripts/multi-end-loop.sh` copies `$RUN_LOG_DIR/evidence` into both the whole-run archive and each per-spec archive:

```text
$ARCHIVE_DIR/evidence/
$ARCHIVE_DIR/specs/loop-N-<spec>/evidence/
```

## Current L2 Capture Map

| Spec | DOM evidence | Observer evidence |
|---|---|---|
| `uc-3.1-l2.e2e.mjs` | `uc-3.1-l2-read-observer.dom.json` | N/A |
| `uc-3.2-l2.e2e.mjs` | `uc-3.2-l2-read-observer.dom.json` | N/A |
| `uc-5.3b-l2.e2e.mjs` | `uc-5.3b-l2-leave-actor-dom.dom.json` | `uc-5.3b-l2-leave-observer.observer.json` |
| `uc-6.1-l2.e2e.mjs` | `uc-6.1-l2-member-actor-dom.dom.json` | `uc-6.1-l2-member-observer.observer.json` |
| `uc-6.2-l2.e2e.mjs` | `uc-6.2-l2-admin-actor-dom.dom.json` | `uc-6.2-l2-admin-observer.observer.json` |
| `uc-11.2-l2.e2e.mjs` | `uc-11.2-l2-quit-actor-dom.dom.json` | `uc-11.2-l2-quit-observer.observer.json` |

Evidence type must match the actual observation surface:

- UI-observed specs capture DOM selectors from the WDIO browser.
- Raw-WS observed specs capture the second actor's user id, action, channel anchor, assertion fields, and matching WS frame(s).

Do not store the 444 owner window as observer DOM for specs whose observer is a raw-WS actor. Those specs may capture owner/actor DOM as supplemental run context, but the L2 closure proof remains the raw-WS observer JSON until the dual-account debug UI can render the secondary actor.

## Focused Archive Check

When ports are free:

```bash
bash scripts/multi-end-loop.sh --spec test/specs/uc-3.1-l2.e2e.mjs
find /tmp/loopforge -maxdepth 6 -path '*evidence/*.dom.json' -type f | head
```

Expected result: the per-spec archive contains at least one `.dom.json` evidence file.
