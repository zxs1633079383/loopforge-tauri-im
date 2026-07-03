# Task 8 Report: L2 Broadcast Closure DOM Evidence Assertions

## Status

DONE_WITH_CONCERNS

## Commit

- LoopForge: `6214837` (`test(im): 补强 L2 DOM 证据断言`)
- Review fix: `43c18f5` (`test(im): 修正 L2 离场 DOM 证据断言`)
- Scoped member-list fix: `9214c1b` (`test(im): 收紧 L2 成员离场 DOM 断言`)

## Scope

- Workspace: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im`
- Branch: `codex/loopforge-ui-uc-gap-closure`
- Requirement: strengthen existing L2 `captureDomEvidence(...)` calls so the specs fail when the evidence file is missing or key DOM selector groups are empty.

## Changed Files

- `test/specs/uc-3.1-l2.e2e.mjs`
- `test/specs/uc-3.2-l2.e2e.mjs`
- `test/specs/uc-5.3b-l2.e2e.mjs`
- `test/specs/uc-6.1-l2.e2e.mjs`
- `test/specs/uc-6.2-l2.e2e.mjs`
- `test/specs/uc-11.2-l2.e2e.mjs`
- `docs/uc-rollout/all-uc-real-chain-status.md`
- `.superpowers/sdd/task-8-report.md`

## What Changed

- Added per-spec DOM evidence JSON reads after `captureDomEvidence(...)`.
- Each captured DOM evidence path is now asserted with `existsSync(...)`.
- UC-3.1 and UC-3.2 now assert non-empty `data-read-bits`, target `data-channel-id`, and target `data-msg-id` evidence; the target message row must carry non-empty `data-read-bits`.
- UC-5.3b and UC-11.2 initially asserted actor-side channel-list context for the target `data-channel-id`; the review fix below replaces the tautological channel-row pass condition with member removal evidence assertions.
- UC-6.1 now asserts non-empty actor-side `data-member-id` evidence for the joined member and target `data-channel-id`.
- UC-6.2 now asserts non-empty actor-side `data-member-id`, `data-admin`, and target `data-channel-id` evidence; the target member row must carry `data-admin="1"`.
- Updated the all-UC ledger to record static evidence assertion coverage while keeping live L2 rerun status pending.

## Review Fix

- UC-5.3b now captures `[data-member-id]`, `[data-member-id="678"]`, and `[data-members]` in the DOM evidence JSON.
- UC-5.3b now asserts member `678` is absent from both member rows and `data-members`; if no member removal surface exists, the spec fails with an explicit `NEED_UI UC-5.3b` blocker instead of passing on channel-row existence.
- UC-11.2 now captures `[data-members]`, `[data-member-id]`, `[data-member-id="777"]`, and the target channel selector for context.
- UC-11.2 no longer passes on the setup channel row. It asserts quitter `777` is absent from member DOM or `data-members`; if no quit/removal surface exists, the spec fails with an explicit `NEED_UI UC-11.2` blocker.

## Re-Review Fix

- Previous re-review found the review fix still treated any `[data-member-id]` as a valid member-removal surface.
- Root cause: `ImMemberPanelComponent` emits `[data-member-id]` both for real member rows and online-status chips, so an unrelated online-status chip could satisfy the surface check.
- UC-5.3b and UC-11.2 now scope the removal oracle to `[data-testid="member-list"][data-members]`.
- The scoped oracle requires:
  - the member-list `data-members` surface exists,
  - the remaining observer member (`999` for UC-5.3b, `888` for UC-11.2) is still present,
  - the removed/quitter member (`678` for UC-5.3b, `777` for UC-11.2) is absent.
- Captured DOM evidence now also includes scoped member-list selectors:
  - `[data-testid="member-list"][data-members]`
  - `[data-testid="member-list"] .mem[data-member-id]`
  - target removed/quitter row selector
  - target remaining observer row selector

## Verification

- `node --check test/specs/uc-3.1-l2.e2e.mjs`: pass
- `node --check test/specs/uc-3.2-l2.e2e.mjs`: pass
- `node --check test/specs/uc-5.3b-l2.e2e.mjs`: pass
- `node --check test/specs/uc-6.1-l2.e2e.mjs`: pass
- `node --check test/specs/uc-6.2-l2.e2e.mjs`: pass
- `node --check test/specs/uc-11.2-l2.e2e.mjs`: pass
- Review fix rerun:
  - `node --check test/specs/uc-5.3b-l2.e2e.mjs`: pass
  - `node --check test/specs/uc-11.2-l2.e2e.mjs`: pass
  - `git diff --check`: pass
- Re-review fix rerun:
  - `node --check test/specs/uc-5.3b-l2.e2e.mjs`: pass
  - `node --check test/specs/uc-11.2-l2.e2e.mjs`: pass
  - `git diff --check`: pass
- `git diff --check`: pass
- GitNexus detect-changes could not run:
  - `.gitnexus/run.cjs` is absent.
  - no global `gitnexus` binary was found.
  - Review-fix retry returned the same local-tooling blocker.
  - `npx --yes gitnexus status` produced no output within 20 seconds and was interrupted.

## Live Run

- Focused L2 live rerun is pending because required ports were occupied:
  - `1420`: `node` PID `68188` listening on `[::1]:1420`
  - `4445`: `loopforge` PID `69194` listening on `127.0.0.1:4445`
- No live green is claimed by this report.

## Concerns

- Static strengthening is complete, but focused live evidence must still be refreshed from free ports before restoring any L2 green claim for the affected specs.
- GitNexus project hook verification remains unavailable in this environment.
- `.superpowers/sdd/task-8-report.md` is ignored by `.superpowers/sdd/.gitignore`; the report is updated on disk but is not part of the commit.
