# NEED_CSES_IM_SERVER_FIX —— 后端缺口（撤回 WS echo 不稳定到达）

> 单写者 append-only。loopforge loop-Engineer 发现「后端 cses-im-server WS echo 缺/晚到」时追加。
> 不阻塞 loopforge/helix 侧渲染绑定收口——绑定逻辑做对（reducer/helix 单测/DOM 实证），e2e 红仅卡在
> 后端 echo 这跳。

## UC-1.5 撤回（online posts_update → im:post:batch-updated）echo 非确定性到达

- **现象（S6·issue #55·2026-06-26）**：`bash scripts/harness.sh spec 1.5` 连跑 2 次：
  - RUN 1：四面全绿（DOM `data-revoke=1` + ② batch-updated 投影 + ④ 落库 revoke=1）。
  - RUN 2：`❌ 断在 [projection] 面：无投影 emit（断在 gate→投影这跳）` + `✖ storage: 无落库写`。
  - **两次 RUN 的 ③ DOM 面都正确**（`data-revoke=1` 都打上了）→ loopforge 撤回绑定（applyBatchUpdated /
    markRevokedById）逻辑正确，红仅在 ② 投影 / ④ 落库这两跳。
- **归因**：撤回走 `invoke im_revoke → POST → 后端 cses-im-server 广播 WS posts_update action`。该 WS echo
  **未稳定在静默窗口内到达**（无 projection emit → gate 无帧 → reconcile 无落库）。属后端 echo 非确定性，
  **非 S6 渲染壳回归**（S6 未改 applyBatchUpdated 的 wire 形态·`im:post:batch-updated` 外层键集
  `{channel_id, posts}` 保持冻结）。
- **期望后端修**：撤回（posts_update type=3 撤回）后，cses-im-server 必须**确定性**向频道成员广播
  `posts_update` WS 帧（含被撤回 post 的 `id`），且在合理时延内到达（与发消息 `post` echo 同等可靠）。
- **当前 loopforge 侧状态**：绑定已就绪（DOM 撤回态两次都对）。不 mock。待后端 echo 稳定后此 UC 自动 2/2 绿。

## UC-1.10 定时消息 / 其它 online echo（task 已知缺口·一并记账）

- 定时（UC-1.10）/ 部分 online 路径同样依赖后端 WS echo emit；echo 缺 → 投影面不可裁。loopforge 绑定逻辑
  做对即可，e2e 红归因后端 echo，不阻塞。
