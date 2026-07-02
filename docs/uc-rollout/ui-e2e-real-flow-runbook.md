# UI/E2E Real-Flow Runbook

> 目标：UI/UX 拆分和 WebdriverIO mjs 补全时，所有用例都走真实链路：
> UI 操作 -> Tauri invoke -> helix -> cses-im-server/java endpoint -> WS/HTTP 回灌 -> helix projection -> DOM。
> 不允许用 mock、fake、前端内存 patch、合成成功态替代真实后端/helix 结果。

## 当前进度

1. Apifox HTTP 套件已沉淀到 `docs/uc-rollout/apifox-http-suite-runbook.md`，定位是 e2e 前置 HTTP/data 层，不替代 UI e2e。
2. UI 主壳已有 6 区：H/CL/ML/MB/CP/AX，`app.component.ts` 已挂大部分 UC 交互按钮。
3. e2e specs 已覆盖多数 UC，下一步不是从零新建，而是逐个把残留 debug hook、合成占位、软断言改成真实 UI/真实 invoke。
4. 本轮已移除 `debugMarkFailed` / `debugLocatePost` / `debugSetManger` 这类直接改前端态的测试 hook；UC-2.3、UC-6.1、UC-6.2 都必须走真实 UI 点击路径和真实回灌。
5. `docs/ui-指令映射全景.md` 已纠正旧占位结论：`revoke-btn`、`cancel-schedule-btn` 已接真实 invoke，`locate-btn` 走真实按钮点击的本地定位逻辑。
6. UI/UX 组件边界已拆出 H/SR/CL/ML/MB/CP/AX；根组件保留 orchestration，子组件只接收 Inputs 并 emit Outputs，不注入 store/Tauri。
7. 新增 `scripts/multi-end-loop.sh` 作为三端联调入口：静态 gates + 可选 live WDIO specs + loopforge/helix/cses 日志尾部证据。

## 禁区

- 禁止 `window.__lf.debug*` 直接调用 store 方法或 patch 前端 state。
- 禁止本地 upsert 成员、管理员、消息状态来冒充后端回灌。
- 禁止用确定性合成 id 当作真实 server id 继续推进写族闭环。
- 禁止为了绿改 `test/expect/*.expect.json`。契约真变更时写提案，不在修复里改 oracle。
- 禁止把 Apifox HTTP `status: SUCCESS` 当作 WS-dependent UC 的最终成功。消息/撤回/置顶/管理员等必须等 WS/投影/DOM 或明确红。

允许保留：

- `window.__lf.invoke(cmd,args)`：这是 Tauri 命令桥，仍然进入真实 helix/后端链路。
- `set_uc`：只用于 run.jsonl 归属窗口，不改变业务结果。

## 三重验证

每个 UC 合格必须同时给出三类证据：

| 维度 | 证据 | 位置 |
|---|---|---|
| 代码 | UI action -> store method -> `window.__lf.invoke`/Tauri command -> helix command 名称清楚 | `src/app/app.component.ts`、`src/app/im/im-store.service.ts`、`src-tauri/src/commands.rs` |
| 效果 | WebdriverIO 点击真实按钮/输入真实文本，DOM `data-*` 终态符合 expect | `test/specs/uc-*.e2e.mjs` |
| 日志 | reducer 四面报告 + 多端日志能定位 hop | `/tmp/loopforge/run.jsonl`、`/tmp/loopforge/run-app.log`、`/tmp/cses-im-server.log` |

## 日志位置

loopforge/helix：

- `/tmp/loopforge/run-ng.log`：Angular 编译和模板错误。UI 卡住先查这里。
- `/tmp/loopforge/run-app.log`：Tauri + helix tracing。helix 跑在 loopforge 进程内。
- `/tmp/loopforge/run.jsonl`：结构化 hop 日志，reducer 读它裁定 ①出站、②投影、④落库。
- `/tmp/loopforge/wdio-out.log`：wdio 输出和 reducer 报告。

cses-im-server：

- 建议命令行启动并重定向：
  ```bash
  cd /System/Volumes/Data/workspace/golang/cses-im-server
  CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json go run ./cmd/server > /tmp/cses-im-server.log 2>&1
  ```
- 健康检查：
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" localhost:8066/api/cses/health
  ```

三端 tail：

```bash
tail -f /tmp/loopforge/run-app.log /tmp/loopforge/wdio-out.log /tmp/cses-im-server.log
```

## 跑法

单 UC：

```bash
bash scripts/run.sh -- --spec test/specs/uc-2.3.e2e.mjs
```

多端验证循环：

```bash
bash scripts/multi-end-loop.sh --loop 2 \
  --spec test/specs/uc-6.1.e2e.mjs \
  --spec test/specs/uc-6.2.e2e.mjs
```

该脚本不替代修复 agent，只负责把当前代码和真实链路反复验证；红灯后按本 runbook 的“三重验证 / 红灯归因”定位再修。

多 UC 顺序要遵守依赖：

```text
4.1 -> 5.1/5.2 -> 1.x send -> 3.x message ops -> 2.x history -> 5.x/6.x mgmt -> 8/9/10 -> 11 -> L2
```

L2 双账号：

- A：`cookieId=444`
- B：`cookieId=678`
- HTTP 和 WS 都必须带 `cookieId`，后端把它当 userId。

## 红灯归因

| 现象 | 优先看 | 归因 |
|---|---|---|
| `run-ng.log` 有 TS/Angular error | `run-ng.log` | loopforge UI 编译/模板 |
| ① outbound 红或没有目标 HTTP | `run.jsonl` outbound + `commands.rs` | loopforge/helix 指令出站 |
| cses health 000/拒连 | `curl health` + `/tmp/cses-im-server.log` | 后端未起/挂 |
| ① 成功但没有 WS echo | `/tmp/cses-im-server.log` + `run-app.log` HOP2 | 后端广播或连接路由 |
| HOP2 有入站但 ② projection 没出 | `run-app.log` HOP3/gate | helix gate/parser/projection |
| ② 有 projection 但 DOM 不变 | `app.component.ts` data-* / `im-store.service.ts apply*` | loopforge 渲染绑定 |

## 当前已知诚实红

- UC-1.4 重发失败：健康 live run 中 `im_send` 入泵即返回，通常不会自然产生 failed 行。旧测试通过 `debugMarkFailed` 造失败态，已废除。下一步只能二选一：
  1. 做真实故障前置（例如外部 runbook 暂停后端，发送失败后恢复再重发）。
  2. helix 提供真实失败投影/错误回灌，让 UI 自然出现 `data-send-status=failed`。

未满足前，UC-1.4 应红，不允许前端 patch failed 造假绿。

## 当前已知非完整闭环

- UC-8.x 投票 / 平均分：当前 `test/specs/uc-8.x-*.e2e.mjs` 覆盖的是第二网关出站 wire body 和读族 `im:read:result` envelope。下游 do/read/close/delete 已禁止随机合成 id，必须从 `UC8_VOTE_ID` / `UC8_AVERAGE_ID` 或 DOM `data-vote` / `data-average` 取真实卡片 id。没有真实 id 时该族应红。下一步只能二选一：
  1. 从真实 `createVote` / `average/publish` 回灌或消息 `props.vote` / `props.average` 中提取服务端卡片 id，再驱动后续 do/read/close/delete。
  2. 若后端/Java 第二网关确实不回传 id，则保留为 outbound-only 覆盖，并在台账中标 yellow，不把它算作 L3 全链路绿。

## UI/UX 拆分顺序

1. 保持 `data-testid` / `data-*` 契约不动，先拆视觉组件，不拆业务状态。
2. 每拆一个区，保留同名 action 方法和 DOM 属性：H、CL、ML、MB、AX、CP。
3. 每个拆分 PR 至少跑一个代表 UC：
   - CL：UC-5.1 或 UC-5.4
   - ML：UC-1.1 或 UC-2.3
   - MB：UC-6.1 或 UC-6.2
   - AX：UC-9.x 或 UC-2.4
   - CP：UC-1.1 / UC-1.2 / UC-1.10
4. 拆分后再补全 mjs，不能先为了测试方便加 fake UI state。
