# NEED_FIX — UC-12.1 健康探针 `im:read:result` 未回灌（helix 特性缺口·pre-existing）

状态：⛔ **WONTFIX / 出范围（2026-06-27 用户拍板）**——连通性/健康=基础设施·非渲染壳职责·壳不主动探活（违 C013「壳=纯渲染」初衷）。UC-12.1 spec 已 `describe.skip`·CLAUDE/AGENTS §8 标 ⛔ 出范围。下方配方**仅供日后改成「helix 拥连通性 + 壳绑 projection」时参考**·当前不执行。
定位日期：2026-06-27（三端联调死磕 agent）

## 一句话根因
`im_health` 在 helix **不是 outbound 命令**（被**刻意**排除在 outbound 注册表外）。
loopforge `im_health` tick 入 helix dispatch 时不命中 `is_outbound("im_health")` → 永不发
`GET /api/cses/health` → 无 200 → `read_relay::emit_read_result` 永不触发 → 客户端等
`im:read:result{req_id}` 超时红。

## 证据链（逐跳）
1. loopforge `src-tauri/src/commands.rs:1835 im_health` → 发 `command("im_health",{req_id})` tick ✅
2. helix `module.rs:309` dispatch 仅对 `is_outbound(name)` 命令走 `handle_outbound` + 读族注册
   `OutboundReadReply`（`module.rs:329 is_read` 门）。
3. helix `outbound/registry.rs` 注册表**不含** `im_health`。
4. **刻意排除的证据**：`tests/p5a_user_misc_test.rs:308`
   `health_and_channel_details_are_response_side_not_outbound_commands` 显式断言
   `!is_outbound("im_health")`（注释："health 裸信封是 GET 响应态·非 outbound build 命令"）。
5. 故 `im_health` tick 落入 dispatch fall-through（既非 outbound·非 query·非 reconnect）→ 无 effect。
6. 客户端 spec `test/specs/uc-12.1.e2e.mjs` waitUntil `im:read:result(req_id=...)` → 15s 超时红。
   实测：`health im:read:result(req_id=req-xxx) 未回灌（连通性 200 未达）`。

## 为何本次未直接修
需**反转 helix 一处刻意的设计决策** + 改多个冻结性质测试 + 走 re-pin/重编循环，
非「改实现红转绿」的安全修复，session 末不宜仓促反转带注释的设计判定。契约只读（C004）。

## 修复配方（picked up 时执行）
helix 仓（worktree off `fix/im-wire-body-build`）：
1. `outbound/user_misc.rs`：用 `outbound_read_command!` 宏加 `HealthCommand`：
   - `name="im_health"`，`is_read=true`
   - `build` 返回 `("health", serde_json::json!({}))`（空 body·GET 不带业务字段·
     req_id 是回灌锚·由 `module.rs read_req_id` 在 dispatch 层抠出·不进 body）
   - 确认 `health` 静态 path 拼 `api_base_url`(`/api/cses`) = `/api/cses/health` ✅
2. `outbound/registry.rs`：
   - `OUTBOUND_COMMANDS` 注册 `HEALTH_REG`
   - `outbound_method`：`im_health` 归 `"GET"` 分支
3. 改冻结测试（随特性反转一并更新·非橡皮章）：
   - `tests/p5a_user_misc_test.rs:308`：`!is_outbound("im_health")` → `is_outbound("im_health")`
     （语义反转·注释改「health 是读族 outbound GET 命令·响应体经 read_relay 回灌」）
   - `outbound_command_count()` 性质测试硬编码总数（registry.rs:155 注 "= 88"）+1 → 校正
   - 若 `ALL_P5A_MISC`(11) 类列表断言涉及 → 同步
4. `cargo check -p helix-im` + 相关测试。
5. ff → `fix/im-wire-body-build`；loopforge `cargo update -p helix-im`（re-pin）→
   `bash scripts/harness.sh reload-app`。
6. 验：`bash scripts/harness.sh spec 12.1 --fresh` 连跑 2 次（断面①·连通性+200 回灌）。

## 风险
- GET outbound 无 body：确认 `http_request` 对 GET 不附 body（参考既有 `im_webhook_config_get` GET 命令）。
- 设计反转需 helix 维护者认可「health 应是读族 outbound 而非纯响应态」——本质上正确
  （要发 HTTP 才能回灌·原"纯响应态"设计从未真正接发请求·这就是缺口本身）。
