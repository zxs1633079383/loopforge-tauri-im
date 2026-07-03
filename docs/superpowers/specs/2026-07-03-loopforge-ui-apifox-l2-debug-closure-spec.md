# LoopForge UI / Apifox UC Closure Spec

Date: 2026-07-03

## Goal

Bring the Tauri validation client closer to the full Apifox UC surface:

- pin all helix dependencies to `770e79e30ad7153d38aa2215f4755a7bcdebe94a`
- call channel read (`channels/view`) when focusing the composer and switching channels
- keep the left dialog list refreshed from helix `dialogList` so latest message, mention and urgent state are visible
- remove the hard-coded sender fallback and use the current user id instead
- add a debug-only two-account panel: main window stays user `444`; user `678` can send, mention, urgent and read for L2 verification

## Rev Decision

Current loopforge pin: `99a0dd5b910d95227478fad63c5bb52ae6d776b4`.

Requested helix rev: `770e79e30ad7153d38aa2215f4755a7bcdebe94a`.

Impact range in helix:

- `bdb843b fix(helix-im/projection): 同步 pinned 终态投影`
- `770e79e chore(tooling/agents): 补齐协作技能配置`

No public Cargo dependency changes were found in the range. `cargo check -p helix-im` passes at the requested rev. The client model already carries `pinned`, so the rev can be adopted directly.

## Frontend Contract

The frontend remains a pure render shell:

- left list fields come from `im_query_dialog_list` / `im:channels:projection`
- message rows come from helix message projections
- TS may trigger refresh/read commands, but must not derive last-message, mention, unread or urgent business state itself

## L2 Debug Contract

The account switcher is a debug control, not a global identity mutation:

- main app identity stays `444`
- buttons under `678` call webdriver-only Tauri commands
- those commands send real HTTP requests with `cookieId=678`
- resulting WS/projections refresh the 444 window for multi-end verification

## Verification

Required checks:

- `cargo check --manifest-path src-tauri/Cargo.toml`
- `npm run check:static`
- `npm run check:real-chain`
