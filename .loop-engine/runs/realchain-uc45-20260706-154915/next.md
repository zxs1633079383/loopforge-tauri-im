# 下一步

1. N3 focused runtime gap 已在 reviewer fix + bus/template/projection + WS fallback 去重补强后重新跑绿：`mrc-20260707022823-607fda` 证明 9 个曾缺 HTTP/WS/bus 的 UC 达到 `commands/http/ws/bus/projection=9/9` 且 `status=PASS`。
2. Reviewer blocker 已处理：mobile 每个 UC 注入 `Cses-Track-Id`；Go probe 记录 HTTP/WS track；urgent/confirm 的 `post_update` WS 透传 track；collector 禁止复用同一个 WS probe index。最新报告中 `UC-1.9-urgent` 与 `UC-1.9-confirm` 分别命中 `ws._probeIndex=158/163`，不再互借旧帧。
3. 已补关键假绿护栏：`start-cses-server.mjs` 默认不再静默复用已占用 8066 的 probe server，避免旧 server 冒充 `CSES_IM_SERVER_ROOT` 指向的 Go worktree；bus 证据也从只看 event name 改为 event name + 全部 required anchors。
4. `UC-3.3-template` 已从 TEXT bootstrap 假 fixture 改为真实 `TEMPLATE` post，bus 命中 `templateReceived:true`，Helix shared projection 返回 `templateReceived=true`。
5. 非 track WS fallback 已收紧为 strict payload + required anchors + publish identity 去重，避免同一次 publish 的多 hub duplicate 被不同 UC 分摊。
6. 当前不能 claim 45/45 全量 green：N3 只覆盖 focused set。下一步进入 N4 collector，用当前 mobile + Go + helix worktree 重新跑全量 `make real-chain-uc`，把 HTTP / WS / bus / projection 四段证据写进全量 report。
7. N4 前置检查：确认 8066 未被旧 server 占用；确认 Go worktree `codex/mobile-realchain-100`、mobile worktree `codex/mobile-query-green`、helix worktree `codex/mobile-query-green` 的改动已提交或至少工作树 diff 清晰；注意 template/announcement/quit 的部分 WS 仍是 strict fallback，不要表述成所有 WS action 都有 track。

本轮证据：

- N3 report: `/System/Volumes/Data/workspace/rust/loopforge-tauri-im/.loop-engine/runs/realchain-uc45-20260706-154915/agent-reports/N3-go-ws-runtime.md`
- N3 focused JSON: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707022823-607fda.json`
- N3 focused Markdown: `/System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707022823-607fda.md`
