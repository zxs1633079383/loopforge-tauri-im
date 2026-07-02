# All-UC Real-Chain Status

> This file is the execution ledger for all LoopForge UC closure work.
> Status values are: `green`, `partial`, `l2-required`, `http-only`, `night-only`, `blocked`, `excluded`, `not-run`.
> Apifox results are recorded as HTTP preflight only and never replace WDIO/reducer evidence.

## Summary

| Gate | Status | Evidence |
|---|---|---|
| L0 static/unit | not-run | Run `bash scripts/gate.sh` and static commands |
| L1 WDIO | not-run | Run `bash scripts/multi-end-loop.sh --all` |
| L2 WDIO | not-run | Run `bash scripts/multi-end-loop.sh --l2` |
| Apifox HTTP | not-run | Run `bash scripts/multi-end-loop.sh --apifox` |
| UI style | not-run | Run `bash scripts/multi-end-loop.sh --screenshot` |

## UC Rows

| UC | Area | Level | Status | Spec | Expect | Required Evidence | Current Evidence | Next Action |
|---|---|---|---|---|---|---|---|---|
| UC-4.1 | H | L1 | green | `test/specs/uc-4.1.e2e.mjs` | `test/expect/uc-4.1.expect.json` | ①②③④ | Existing rollout docs treat the ready-probe path as green; not rerun in Task 1. | Keep as the ready-probe regression gate. |
| UC-5.1 | CL | L1 | green | `test/specs/uc-5.1.e2e.mjs` | `test/expect/uc-5.1.expect.json` | ①②③④ | Existing docs mark create-channel as green. | Keep as the CL regression gate. |
| UC-5.2 | CL | L1 | green | `test/specs/uc-5.2.e2e.mjs` | `test/expect/uc-5.2.expect.json` | ①②③④ | Existing docs mark topic creation as green. | Keep as the CL regression gate. |
| UC-1.1 | CP | L1 | green | `test/specs/uc-send-1.e2e.mjs` | `test/expect/uc-send-1.expect.json` | ①②③④ | Existing docs keep the vertical slice green. | Keep as the send-text regression gate. |
| UC-1.2 | CP | L1 | green | `test/specs/uc-1.2.e2e.mjs` | `test/expect/uc-1.2.expect.json` | ①②③④ | Existing docs keep document send green. | Keep as the document-send regression gate. |
| UC-1.9 | ML | L1 | green | `test/specs/uc-1.9.e2e.mjs` | `test/expect/uc-1.9.expect.json` | ①②③④ | Existing docs keep urgent/confirm green. | Keep as the urgent-message regression gate. |
| UC-1.8 | ML | L1 | green | `test/specs/uc-1.8.e2e.mjs` | `test/expect/uc-1.8.expect.json` | ①②③④ | Existing docs keep quick-reply green. | Keep as the quick-reply regression gate. |
| UC-1.10 | CP | L1 | green | `test/specs/uc-1.10.e2e.mjs<br>test/specs/uc-1.10-cancel.e2e.mjs` | `test/expect/uc-1.10.expect.json<br>test/expect/uc-1.10-cancel.expect.json` | ①②③④ | Existing docs keep schedule/cancel green. | Keep both schedule specs in the CP gate. |
| UC-1.3 | CP | night | night-only | — | — | ①②③④ | Night upload path is intentionally not part of Task 1. | Run it only through the night-only harness. |
| UC-1.5 | ML | L1 | green | `test/specs/uc-1.5.e2e.mjs` | `test/expect/uc-1.5.expect.json` | ①②③④ | Existing docs keep revoke green. | Keep as the revoke regression gate. |
| UC-3.2 | MB | L2 | green | `test/specs/uc-3.2.e2e.mjs<br>test/specs/uc-3.2-l2.e2e.mjs` | `test/expect/uc-3.2.expect.json<br>test/expect/uc-3.2-l2.expect.json` | ①②③④ | Existing docs keep single-message read green with a real second connection. | Keep the L2 companion as the broadcast authority. |
| UC-3.1 | MB | L2 | green | `test/specs/uc-3.1.e2e.mjs<br>test/specs/uc-3.1-l2.e2e.mjs` | `test/expect/uc-3.1.expect.json<br>test/expect/uc-3.1-l2.expect.json` | ①②③④ | Existing docs keep channel-read green with real L2 evidence. | Keep the L2 companion as the broadcast authority. |
| UC-3.3 | ML | L1 | green | `test/specs/uc-3.3.e2e.mjs` | `test/expect/uc-3.3.expect.json` | ①②③④ | Existing docs keep template-received green. | Keep as the template-received regression gate. |
| UC-1.4 | CP | L1 | blocked | `test/specs/uc-1.4.e2e.mjs` | `test/expect/uc-1.4.expect.json` | ①②③④ | The old fake-fail hook is retired; the real failure path is still not established here. | Build a genuine failure-injection path or leave this red. |
| UC-1.7 | CP | L1 | green | `test/specs/uc-1.7.e2e.mjs` | `test/expect/uc-1.7.expect.json` | ①②③④ | Existing docs keep forward/merge green. | Keep as the forwarding regression gate. |
| UC-2.4 | AX | L1 | green | `test/specs/uc-2.4.e2e.mjs` | `test/expect/uc-2.4.expect.json` | ①②③④ | Existing docs keep reply-branch read green. | Keep as the reply-branch regression gate. |
| UC-2.1 | AX | L1 | green | `test/specs/uc-2.1.e2e.mjs` | `test/expect/uc-2.1.expect.json` | ①②③④ | Existing docs keep first-screen channel load green. | Keep as the channel-load regression gate. |
| UC-2.3 | AX | L1 | green | `test/specs/uc-2.3.e2e.mjs` | `test/expect/uc-2.3.expect.json` | ①②③④ | Existing docs keep locate-by-postId green. | Keep as the locate regression gate. |
| UC-2.2 | AX | L1 | green | `test/specs/uc-2.2.e2e.mjs` | `test/expect/uc-2.2.expect.json` | ①②③④ | Existing docs keep older-history green. | Keep as the older-history regression gate. |
| UC-5.4 | CL | L1 | green | `test/specs/uc-5.4.e2e.mjs` | `test/expect/uc-5.4.expect.json` | ①②③④ | Existing docs keep channel property editing green. | Keep as the channel-edit regression gate. |
| UC-5.5 | CL | L1 | green | `test/specs/uc-5.5.e2e.mjs<br>test/specs/uc-5.5b.e2e.mjs` | `test/expect/uc-5.5.expect.json<br>test/expect/uc-5.5b.expect.json` | ①②③④ | Existing docs now treat the post-pin path as real-chain green; the old backend-down wording is stale. | Keep both channel-top and post-pin specs in the CL gate. |
| UC-5.6r | AX | HTTP | http-only | `test/specs/uc-5.6r.e2e.mjs` | `test/expect/uc-5.6r.expect.json` | ① HTTP; ②③④ N/A | HTTP/read-result only. No DOM or DB claim is made here. | Keep this as the HTTP preflight for announcement reads. |
| UC-5.6w | AX | HTTP | blocked | `test/specs/uc-5.6w.e2e.mjs` | `test/expect/uc-5.6w.expect.json` | ① HTTP; ②④ backend gap | The write-path still depends on a backend/Java echo gap; it cannot be reported green yet. | Keep it red until the backend echo is real. |
| UC-5.7 | AX | HTTP | http-only | `test/specs/uc-5.7.e2e.mjs` | `test/expect/uc-5.7.expect.json` | ① HTTP; ②③④ N/A | HTTP/read-result only. No DOM/DB claim is made here. | Keep this as the HTTP preflight for online-status reads. |
| UC-5.3 | CL | L1 | green | `test/specs/uc-5.3.e2e.mjs` | `test/expect/uc-5.3.expect.json` | ①②③④ | Existing docs keep close/exit green. | Keep as the close/exit regression gate. |
| UC-6.3 | MB | L1 | green | `test/specs/uc-6.3.e2e.mjs` | `test/expect/uc-6.3.expect.json` | ①②③④ | Existing docs keep nickname editing green. | Keep as the nickname regression gate. |
| UC-6.4 | MB | L1 | green | `test/specs/uc-6.4.e2e.mjs` | `test/expect/uc-6.4.expect.json` | ①②③④ | Existing docs keep member snapshot/all-green green. | Keep as the member-snapshot regression gate. |
| UC-6.1 | MB | L1 | green | `test/specs/uc-6.1.e2e.mjs<br>test/specs/uc-6.1-l2.e2e.mjs` | `test/expect/uc-6.1.expect.json<br>test/expect/uc-6.1.expect.json` | ①②③④ | `scripts/multi-end-loop.sh --spec test/specs/uc-6.1.e2e.mjs` passed; run.jsonl showed `im_channel_member_change` -> `channel/member/change` -> `im:channel:members` -> DOM. | Keep as MB regression gate. |
| UC-6.2 | MB | L1 | partial | `test/specs/uc-6.2.e2e.mjs<br>test/specs/uc-6.2-l2.e2e.mjs` | `test/expect/uc-6.2.expect.json<br>test/expect/uc-6.2.expect.json` | ①; ②③④ L2 | `scripts/multi-end-loop.sh --spec test/specs/uc-6.2.e2e.mjs` passed outbound-only L1; admin DOM remains L2-only and must not be optimistic fake. | Keep L2 `uc-6.2-l2.e2e.mjs` as authority for admin DOM. |
| UC-9.x | AX | L1 | green | `test/specs/uc-9.x.e2e.mjs` | `test/expect/uc-9.x.expect.json` | ①②③④ | Existing docs keep bookmark CRUD green. | Keep as the bookmark regression gate. |
| UC-10.1 | AX | L1 | green | `test/specs/uc-10.1.e2e.mjs` | `test/expect/uc-10.1.expect.json` | ①②③④ | Existing docs keep todo list green. | Keep as the todo regression gate. |
| UC-10.3 | AX | HTTP | http-only | `test/specs/uc-10.3.e2e.mjs` | `test/expect/uc-10.3.expect.json` | ① HTTP; ②③④ N/A | Read-only module fetch; no DOM/storage claim is made here. | Keep this as the HTTP preflight for module reads. |
| UC-4.2 | H | L1 | green | `test/specs/uc-4.2.e2e.mjs` | `test/expect/uc-4.2.expect.json` | ①②③④ | Existing docs keep sync-notify green. | Keep as the sync regression gate. |
| UC-4.5 | H | L1 | green | `test/specs/uc-4.5.e2e.mjs` | `test/expect/uc-4.5.expect.json` | ①②③④ | Existing docs keep stranger-channel fallback green. | Keep as the fallback-load regression gate. |
| UC-4.4 | H | L1 | green | `test/specs/uc-4.4.e2e.mjs` | `test/expect/uc-4.4.expect.json` | ①②④ | Existing docs keep heartbeat-gap compensation green. | Keep as the heartbeat-gap regression gate. |
| UC-8.x 投票 | AX | L1 | not-run | `test/specs/uc-8.x-vote.e2e.mjs` | `test/expect/uc-8.x-vote.expect.json` | ①②③④ | Not re-verified in Task 1; real ids are still required. | Run only with a real `data-vote` or real env id. |
| UC-8.x 平均分 | AX | L1 | not-run | `test/specs/uc-8.x-average.e2e.mjs` | `test/expect/uc-8.x-average.expect.json` | ①②③④ | Not re-verified in Task 1; real ids are still required. | Run only with a real `data-average` or real env id. |
| UC-10.2 | AX | L1 | green | `test/specs/uc-10.2.e2e.mjs` | `test/expect/uc-10.2.expect.json` | ①②③④ | Existing docs keep system notification green. | Keep as the system-notice regression gate. |
| UC-5.8 | CL | L1 | green | `test/specs/uc-5.8.e2e.mjs` | `test/expect/uc-5.8.expect.json` | ①②③④ | Existing docs keep channel query green. | Keep as the channel-query regression gate. |
| UC-11.1 | CL | L1 | green | `test/specs/uc-11.1.e2e.mjs` | `test/expect/uc-11.1.expect.json` | ①②③④ | Existing docs keep company-team maintenance green. | Keep as the company-team regression gate. |
| UC-11.2 | CL | L2 | green | `test/specs/uc-11.2.e2e.mjs<br>test/specs/uc-11.2-l2.e2e.mjs` | `test/expect/uc-11.2.expect.json<br>test/expect/uc-11.2.expect.json` | ①②③④ | Existing docs keep company quit green with real L2 broadcast evidence. | Keep the L2 companion as the broadcast authority. |
| UC-12.1 | H | HTTP | http-only | `test/specs/uc-12.1.e2e.mjs` | `test/expect/uc-12.1.expect.json` | ① HTTP | Infrastructure-only health probe; no IM DOM/storage claim is made here. | Keep as the health preflight, not as a feature gate. |
| US-17 | L2 | L2 | green | `test/specs/uc-us17-l2.e2e.mjs` | `test/expect/uc-us17.expect.json` | ①②③④ | Existing docs keep other-user push green with a real second connection. | Keep as the cross-account push regression gate. |
| UC-6.1b | L2 | L2 | green | `test/specs/uc-6.1-l2.e2e.mjs` | `test/expect/uc-6.1.expect.json` | ①②③④ | Existing docs keep real member-update broadcast green. | Keep as the broadcast authority for UC-6.1. |
| UC-5.3b | L2 | L2 | green | `test/specs/uc-5.3b-l2.e2e.mjs` | `test/expect/uc-5.3b-l2.expect.json` | ①②③④ | Existing docs keep leave broadcast green. | Keep as the broadcast authority for UC-5.3. |
| UC-6.2b | L2 | L2 | green | `test/specs/uc-6.2-l2.e2e.mjs` | `test/expect/uc-6.2.expect.json` | ①②③④ | Existing docs keep admin broadcast green. | Keep as the broadcast authority for UC-6.2. |

