# N3 Go WS Runtime Report

run_id: realchain-uc45-20260706-154915
node_id: N3
repo: cses-im-server
worktree: /System/Volumes/Data/workspace/golang/cses-im-server/worktrees/mobile-realchain-100
branch: codex/mobile-realchain-100
status: focused-realchain-green-after-review-fix-v3

## 结论

N3 负责的 Go runtime WS 断点已从真实后端跑通。最终 focused mobile real-chain 覆盖 9 个曾经缺 HTTP/WS/bus 的 UC，报告显示：

- commands: 9/9
- http: 9/9
- ws: 9/9
- bus: 9/9
- projection: 9/9
- status: PASS

最终证据（review fix + bus/template/projection + WS fallback 去重补强后重跑）：

- JSON: /System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707022823-607fda.json
- Markdown: /System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707022823-607fda.md

## 修复范围

Go worktree 中保留的 N3 修改：

- `internal/realchain/probe.go`: HTTP/WS probe 记录 `Cses-Track-Id`，report 可按 UC 精确归因。
- `internal/ws/hub.go` / `internal/ws/hub_broadcast.go`: broadcast observer 透出 envelope trackId。
- `internal/app/cses_post_urgent.go`: urgent / confirm 触发的 `post_update` 与 `update_channel` 透传 trackId，修复相邻 UC 同 action 误借 WS 的 reviewer blocker。
- `internal/api/post/handlers_write.go`: urgent / confirm handler 把 HTTP 入站 `Cses-Track-Id` 传入应用层。
- `internal/api/team/handlers_api.go`: 补齐 team upsert / quit mobile payload normalize；canonical `CreateChannelSpecifyOwner` 仅在 `Channel != nil && Users > 0` 时原样放行。
- `internal/api/post/mobile_payload_test.go`: 覆盖 post/announcement/topic mobile payload，并补 camelCase 优先于 snake_case conflict 的证伪用例。
- `internal/api/team/mobile_payload_test.go`: 覆盖 team upsert/quit mobile payload，补 camelCase-only、camelCase conflict wins、canonical pass-through 三类证伪。
- `internal/ws/realchain_probe_visibility_test.go`: 覆盖 WS probe 能观测 broadcast publish 且携带 trackId。

移动端配合修复：

- `quickjs/QuickJsRuntime.*` / `tests/gtest/fixtures/MobileJsFixture.hpp`: real fixture 注入 `CoreBridge`，暴露 `__setRealChainTrackId(trackId)` 给 JS spec 设置真实 HTTP header。
- `tests/gtest/MobileRealChainSpecTest.cpp`: `im_make_topic` 走真实 bootstrap post；team UC 的 `teamId` 改为当前 companyId；每个 UC 注入 trackId；`UC-3.3-template` 改为创建真实 `TEMPLATE` post 并要求 projection 含 `templateReceived=true`。
- `scripts/real-chain/lib/evidence.mjs`: HTTP 优先按 trackId 精确匹配；WS 禁止复用同一 probe index，优先按 trackId，fallback 必须通过 UC-specific payload matcher + required anchors；同一次 publish 的多 hub duplicate 用 publish identity 去重；bus 证据也必须同时命中事件名与全部 required anchors，避免只按 event name 假绿。
- `scripts/real-chain/start-cses-server.mjs`: 默认禁止复用已占用的 8066 probe server，必须显式 `CSES_IM_REUSE_EXISTING_SERVER=1` 才复用，避免旧 server 冒充当前 worktree。

Helix shared layer 配合修复：

- `crates/helix-im/src/query/render_ready/core.rs`: render-ready row 增加 `templateReceived`，支持显式字段，也支持从 `props.template.userIds/user_ids` 派生。
- `crates/helix-im/src/query/render_ready/core_tests.rs`: 覆盖 DB snake、wire camel、props JSON string 三类模板已收投影。

## 关键诊断

1. `UC-5.2-topic` 不是 Go 缺口，根因是 mobile fixture 没把 `im_make_topic` 归入需要真实 post 的命令，导致传入不存在的 `post-<runId>`。
2. `UC-11.1-team-upsert` / `UC-11.2-team-quit` 的业务 team 语义是 company group，fixture 之前传 `team-<runId>` 会偏离真实 CompanyId。
3. 8066 端口曾存在旧 cses-im-server，且旧 server 带 probe，原启动脚本会静默复用，导致 `CSES_IM_SERVER_ROOT` 指向的 worktree 没真正被执行。这是本轮最大假绿风险，已在 mobile 脚本加 fail-closed 护栏。
4. `UC-3.3-template` 之前不是一个真正的 TEMPLATE fixture，只是拿 TEXT bootstrap post 走模板已收命令；这会让 bus/projection 的断言过松。现在 fixture 创建真实 `type=TEMPLATE` post，bus 必须命中 `templateReceived:true` anchor，projection 必须返回 `templateReceived=true`。
5. Reviewer 指出的旧报告 `mrc-20260707014612-5112a5` 有相邻 UC WS 误借风险：`UC-1.9-urgent` 与 `UC-1.9-confirm` 都期望 `post_update`。本轮通过 per-UC `Cses-Track-Id` + WS probe index 去重修掉；最新报告中二者分别匹配 `ws._probeIndex=156/161` 且 `ws.trackId` 精确等于各自 UC track。
6. `mrc-20260707020728-952d95` 虽然已显示 9/9 PASS，但 bus 仍只按 event name 匹配，存在借用旧 bus 帧风险；`mrc-20260707021925-b70229` 又暴露出非 track WS fallback 可被同一次 publish 的多 hub duplicate 分摊。最终有效报告以 `mrc-20260707022823-607fda` 为准。

## 验证

Go focused:

```bash
GOTOOLCHAIN=local go test ./internal/... -run 'Urgent|Template|Announcement|MakeTopic|Team|WebSocket|ChannelNotice|PostUpdate|PostRead|QuitCompany|MobilePayload|RealChainProbe'
```

结果：PASS。

Mobile focused team:

```bash
REAL_CHAIN_CASES=UC-11.1-team-upsert,UC-11.2-team-quit \
  HELIX_REPO=/System/Volumes/Data/workspace/rust/helix/worktrees/mobile-query-green \
  CSES_IM_SERVER_ROOT=/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/mobile-realchain-100 \
  make real-chain-uc
```

报告：/System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707014436-993625.md

结果：PASS，commands/http/ws/bus/projection = 2/2。

Mobile focused N3 set:

```bash
REAL_CHAIN_CASES=UC-1.9,UC-3.3,UC-5.6w,UC-5.2,UC-11.1-team-upsert,UC-11.2-team-quit \
  HELIX_REPO=/System/Volumes/Data/workspace/rust/helix/worktrees/mobile-query-green \
  CSES_IM_SERVER_ROOT=/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/mobile-realchain-100 \
  make real-chain-uc
```

报告：/System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707014612-5112a5.md

结果：PASS，commands/http/ws/bus/projection = 9/9。

Mobile focused N3 set after reviewer fix:

```bash
REAL_CHAIN_CASES=UC-1.9,UC-3.3,UC-5.6w,UC-5.2,UC-11.1-team-upsert,UC-11.2-team-quit \
  HELIX_REPO=/System/Volumes/Data/workspace/rust/helix/worktrees/mobile-query-green \
  CSES_IM_SERVER_ROOT=/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/mobile-realchain-100 \
  make real-chain-uc
```

报告：/System/Volumes/Data/workspace/c/mobile-qucik-c++/worktrees/mobile-query-green/real-chain/reports/mrc-20260707022823-607fda.md

结果：PASS，commands/http/ws/bus/projection = 9/9。关键 track 证据：

- `UC-1.9-urgent`: HTTP `trackId=mrc-20260707022823-607fda:UC-1.9-urgent`, WS `trackId=mrc-20260707022823-607fda:UC-1.9-urgent`, `ws._probeIndex=158`, `action=post_update`。
- `UC-1.9-confirm`: HTTP `trackId=mrc-20260707022823-607fda:UC-1.9-confirm`, WS `trackId=mrc-20260707022823-607fda:UC-1.9-confirm`, `ws._probeIndex=163`, `action=post_update`。
- `UC-3.3-template`: `wsRequiredAnchors=[templatePostId]`，WS payload 必须是 `type=TEMPLATE` 且 `props.template.userIds` 非空；bus 命中 `[templatePostId, templateReceived]`，projection raw 含 `templateReceived=true`。
- `UC-5.6w-announcement-read/delete`: WS fallback 必须分别满足 `acceptList 非空且非 Delete` / `state=Delete`，bus 必须命中 `[postId, acceptList/Delete]`。
- `UC-5.2-topic`: HTTP/WS track 均精确等于 `mrc-20260707022823-607fda:UC-5.2-topic`。
- `UC-11.1-team-upsert`: HTTP/WS track 均精确等于 `mrc-20260707022823-607fda:UC-11.1-team-upsert`。

注：`template` / `announcement` / `quit` 的部分 WS 业务路径仍没有业务层 track 透传，本轮 collector 对这些路径使用时间窗 + strict payload + required anchors + publish identity 去重 fallback；不能把它夸大为所有 WS action 都已具备 track。

## 未 claim

N3 只 claim focused runtime gap green。45/45 全量仍必须由 N4 collector 用当前 mobile + Go worktree 重新跑 `make real-chain-uc` 后判定，不能用本报告替代全量 green。
