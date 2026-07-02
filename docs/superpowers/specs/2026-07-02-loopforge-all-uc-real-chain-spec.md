# LoopForge 全 UC 真实链路收口 SPEC

> 日期：2026-07-02
> 范围：`loopforge-tauri-im` + `helix` + `cses-im-server` + Apifox HTTP 套件
> 目标：把所有可测 UC 从“单点跑通”收敛为“UI/UX 统一 + 自动化 UI/E2E + 单元/静态门禁 + Apifox HTTP 全绿 + WS/L2 真实链路闭环”的长期执行规格。

---

## 1. 一句话目标

LoopForge 作为 Tauri + Angular 的 IM 客户端验证场，必须用真实 UI 操作驱动真实链路：

```text
Angular UI
  -> ImStoreService
  -> Tauri invoke
  -> helix inbound command
  -> helix outbound HTTP/WS command
  -> cses-im-server
  -> HTTP response / WS push
  -> helix parser/gate/projection/storage
  -> Angular DOM data-* render
  -> WebdriverIO + reducer 裁定
```

任何 UC 不能通过 mock、fake、debug patch、随机假 id、前端乐观业务态来冒充全绿。

---

## 2. 当前事实基线

### 2.1 已完成

- 前置 runbook 已建立：
  - `docs/uc-rollout/ui-e2e-real-flow-runbook.md`
  - `docs/uc-rollout/ui-ux-split-runbook.md`
  - `docs/uc-rollout/apifox-http-suite-runbook.md`
- 已清理或废止直接 patch UI state 的测试 hook：
  - `debugMarkFailed`
  - `debugLocatePost`
  - `debugSetManger`
- UI 组件边界已拆到 H/SR/CL/ML/MB/CP/AX：
  - `src/app/im/ui/im-status-bar.component.ts`
  - `src/app/im/ui/im-server-rail.component.ts`
  - `src/app/im/ui/im-channel-list.component.ts`
  - `src/app/im/ui/im-message-list.component.ts`
  - `src/app/im/ui/im-member-panel.component.ts`
  - `src/app/im/ui/im-composer.component.ts`
  - `src/app/im/ui/im-aux-panel.component.ts`
- MB 成员区已经用真实 live WDIO 回归：
  - UC-6.1：四面全绿
  - UC-6.2：L1 单账号 ① 出站全绿；②③④ 明确是结构性 L2，不允许 UI 乐观刷 `data-admin`
- 已新增多端验证入口：
  - `scripts/multi-end-loop.sh`
- `cses-im-server` 当前 health 可达：
  - `GET http://127.0.0.1:8066/api/cses/health`
  - 期望返回 `200 {"status":"OK"}`

### 2.2 未完成

- 没有跑完整 WebdriverIO 全量 suite。
- 没有跑完整 Angular/Karma 或项目定义的单元测试矩阵。
- 没有跑完整 Apifox HTTP suite 并拿到本仓归档报告。
- CL/ML/CP/AX 拆分后的代表 UC 仍需按区回归。
- UI 风格已经朝目标页调整，但还缺“视觉验收基线”和跨 viewport 截图审查。
- `/tmp/cses-im-server.log` 当前不是稳定产物；如果 Go server 由 IDE 启动，日志只在 IDE stdout。
- 台账仍有历史旧说法和当前真实链路不完全一致的行，需要统一出账口径。

---

## 3. 非目标

- 不把 LoopForge 变成 `cses-client` 的生产 UI。
- 不在 LoopForge 里复制 helix 业务逻辑。
- 不为了测试绿而改冻结契约、真机 curl 真源、projection schema、expect oracle。
- 不用 Apifox 证明 WS 或 DOM；Apifox 只证明 HTTP。
- 不把后端未广播的 WS 结果在 UI 层乐观造出来。
- 不在本 spec 阶段做代码实现计划；实现计划必须在本 spec 通过后用 `superpowers:writing-plans` 生成。

---

## 4. 强制不变量

1. **真实路径唯一**：UI -> store -> Tauri -> helix -> cses-im-server -> helix projection/storage -> UI。
2. **纯渲染壳**：Angular 子组件只接 Inputs、emit Outputs，不注入 store，不调用 Tauri，不执行业务规则。
3. **业务规则下沉**：role -> admin、tmp -> server 对账、wire 归一、id 映射、成员合并必须在 helix 或后端完成。
4. **契约只读**：`test/expect/*.expect.json`、projection schema、真机 curl 真源不是修红手段。
5. **可证伪**：所有绿灯必须能被破坏后变红；禁止 tautology 和仅检查“按钮存在”。
6. **Apifox 有边界**：Apifox 全绿只代表 HTTP 面全绿，不代表 WS、投影、DOM、DB 全绿。
7. **日志即证据**：每个红/绿判断必须能落到 run.jsonl、wdio、Tauri/helix、Go server 日志中的至少一条证据。
8. **台账诚实**：L1、L2、backend-gap、Java-gap、night-only、excluded 必须分级，不能统一写“全绿”。

---

## 5. 多端运行拓扑

### 5.1 仓库路径

| 端 | 路径 | 职责 |
|---|---|---|
| loopforge | `/System/Volumes/Data/workspace/rust/loopforge-tauri-im` | Tauri + Angular 客户端验证场、WDIO、reducer、UI/UX |
| helix | `/System/Volumes/Data/workspace/rust/helix` | sans-IO IM 业务内核、inbound/outbound、projection、storage effect |
| cses-im-server | `/System/Volumes/Data/workspace/golang/cses-im-server` | Go IM 后端，HTTP + WS，端口 8066 |
| Java old gateway | `http://localhost:3399` | vote/average 等旧接口保留入口，仅在 UC-8.x 需要 |

### 5.2 日志位置

| 日志 | 生产者 | 用途 |
|---|---|---|
| `/tmp/loopforge/run-ng.log` | Angular dev server | TS/template/style 编译错误 |
| `/tmp/loopforge/run-app.log` | Tauri + helix | Tauri 启动、helix tracing、inbound/outbound runtime |
| `/tmp/loopforge/run.jsonl` | hop recorder | 四面 reducer 的结构化证据 |
| `/tmp/loopforge/wdio-out.log` | WebdriverIO | UI 自动化结果和 reducer summary |
| `/tmp/cses-im-server.log` | cses-im-server stdout redirection | HTTP/WS 后端日志 |

### 5.3 Go server 启动规范

如果 Go server 不是由命令行重定向启动，`/tmp/cses-im-server.log` 可能不存在。全链路验证前必须用以下方式启动或等效配置 IDE stdout redirect：

```bash
cd /System/Volumes/Data/workspace/golang/cses-im-server
CSES_IM_LISTEN_ADDR=:8066 \
CSES_IM_LOG_FORMAT=json \
go run ./cmd/server > /tmp/cses-im-server.log 2>&1
```

健康检查：

```bash
curl -sS -o /tmp/cses-health.json -w "%{http_code}\n" \
  http://127.0.0.1:8066/api/cses/health
cat /tmp/cses-health.json
```

通过标准：

```text
200
{"status":"OK"}
```

---

## 6. UI/UX 统一口径

### 6.1 视觉目标

消息界面风格以以下页面为硬目标：

```text
http://pd.cses7.com/message/pages/message/index.html
```

已观察到的目标特征：

- 深色顶栏和侧边栏。
- 浅色主会话区。
- 会话列表信息密度高，可快速扫描。
- 消息区用白色/浅色气泡，避免大面积营销式卡片。
- 底部输入区清晰固定，按钮集中。
- 整体偏企业 IM，不做 landing page，不做装饰性大 hero。

### 6.2 UI 区域

| 区域 | 组件 | 验收点 |
|---|---|---|
| H 状态栏 | `app-im-status-bar` | ready/health/read channel 不破坏原 data-ready |
| SR 服务器栏 | `app-im-server-rail` | 视觉装饰，不承载业务数据 |
| CL 频道列表 | `app-im-channel-list` | 保留所有 `data-channel-*`，按钮事件走 root/store |
| ML 消息列表 | `app-im-message-list` | 保留所有 message data-*，不在组件里算业务状态 |
| MB 成员区 | `app-im-member-panel` | 保留 member data-*，join/leave/nickname/admin 都 emit |
| CP 输入区 | `app-im-composer` | draft 两向绑定，send/document/urgent/schedule 都走真实命令 |
| AX 辅助区 | `app-im-aux-panel` | bookmark/todo/reply data-* 保持机器可读 |

### 6.3 风格验收

每次 UI/UX 大改必须至少保存两张截图：

```text
/tmp/loopforge-ui-desktop.png
/tmp/loopforge-ui-mobile.png
```

截图必须证明：

- 首屏能看到深色顶栏/侧栏、频道列表、消息区、成员或辅助区、输入区。
- 文本不重叠。
- 按钮不挤出父容器。
- `data-testid` 所在元素仍可见或可交互。
- 移动宽度下关键测试控件不被 CSS `display:none` 隐藏。

---

## 7. UC 分层验收模型

### 7.1 验收等级

| 等级 | 名称 | 证明内容 | 工具 |
|---|---|---|---|
| L0 | 静态/单元门 | TypeScript、Angular build、Rust/Node reducer 单测、diff hygiene | `tsc`、`ng build`、`node --test`、`cargo test`、`git diff --check` |
| L1 | 单账号 live UC | UI/Tauri/helix/Go/WS 或 HTTP/projection/DOM/DB 可达面 | `scripts/run.sh` + WDIO + reducer |
| L2 | 双账号广播 UC | 需要第二真实连接才能证明的 WS fanout、read receipt、admin/member 广播 | `scripts/l2-act.sh` + L2 WDIO specs |
| L3 | 全套闭环 | 全量 specs + Apifox + 台账 + 风格截图 + 日志归档 | `scripts/multi-end-loop.sh` + Apifox CLI + report |

### 7.2 四面定义

| 面 | 名称 | 证据 |
|---|---|---|
| ① | 出站 | `run.jsonl` outbound HTTP/WS body |
| ② | 投影 | `run.jsonl` projection event/data |
| ③ | DOM | WDIO 读取真实 WebView `data-*` |
| ④ | DB/storage | `run.jsonl` storage hop 或明确 N/A 的读路径 |

读族、projection-only、自驱、单账号结构性 gap 可以少于四面，但必须在 expect 和台账里显式标 N/A 原因。

---

## 8. 全 UC 状态口径

### 8.1 已按 checklist 管理的 UC

| 阶段 | UC | 当前口径 |
|---|---|---|
| 0 | UC-4.1 hello 全量增量 | L1 管理，需保持 ready probe |
| 1 | UC-5.1 创建群聊 | L1 已绿，CL 拆分后需重跑代表 UC |
| 1 | UC-5.2 创建话题 | L1 已绿 |
| 2 | UC-1.1 发文本 | L1 已绿，CP/ML 拆分后必须重跑 |
| 2 | UC-1.2 发文档 | L1 已绿，CP 拆分后必须重跑 |
| 2 | UC-1.9 加急/确认 | L1 已绿，ML 按钮拆分后必须重跑 |
| 2 | UC-1.8 快捷回复 | L1 已绿，ML 按钮拆分后必须重跑 |
| 2 | UC-1.10 定时/取消 | L1 已绿，但 UI 真实按钮链需重点复核 |
| 2 | UC-1.3 图片/文件 | night-only，依赖上传管线 |
| 3 | UC-1.5 撤回 | L1 已绿，必须保持真实 `revoke-btn` 点击 |
| 3 | UC-3.2 单条已读 | L2 已绿口径，单账号不能冒充 |
| 3 | UC-3.1 会话已读 | L2 已绿口径，单账号不能冒充 |
| 3 | UC-3.3 模板已收到 | L1 已绿 |
| 3 | UC-1.4 重发失败 | 必须用真实故障/真实失败投影，不允许 `debugMarkFailed` |
| 3 | UC-1.7 转发 | L1 多频道已绿，禁止随机假 target/id |
| 3 | UC-2.4 回复/分支读取 | 读族 L1，AX 拆分后必须重跑 |
| 4 | UC-2.1 切群首屏 | 读族 L1 |
| 4 | UC-2.3 按 postId 定位 | 已改真实 UI locate，不允许 `debugLocatePost` |
| 4 | UC-2.2 更早历史 | L1 已绿 |
| 5 | UC-5.4 群属性修改 | CL 拆分后必须重跑 |
| 5 | UC-5.5 置顶 | channel top L1；post pin 子项看后端 echo |
| 5 | UC-5.6r 公告读族 | HTTP/read result 面，DOM 口径需明确 |
| 5 | UC-5.6w 公告写族 | backend/java echo gap 不可冒充 |
| 5 | UC-5.7 在线状态 | channel onlineStatus 可验；users/status/ids 跟后端状态分级 |
| 5 | UC-5.3 关闭/退出群 | L1 已绿 |
| 5 | UC-6.3 改群昵称 | MB 拆分后必须重跑 |
| 5 | UC-6.4 成员快照/全量 | MB 拆分后必须重跑 |
| 5 | UC-6.1 拉/踢人 | MB live 已重跑，四面全绿 |
| 5 | UC-6.2 设/撤管理员 | L1 只验 ① 出站；admin DOM/DB 留 L2，禁止 UI 乐观刷 |
| 6 | UC-9.x 书签 | AX/ML 拆分后必须重跑 |
| 6 | UC-10.1 待办 | AX 拆分后必须重跑 |
| 6 | UC-10.3 模块读 | 读族 |
| 6 | UC-4.2 sync notify | L1 |
| 6 | UC-4.5 陌生 channel | 读族 |
| 6 | UC-4.4 心跳 gap | 自驱三面 |
| 6 | UC-8.x 投票 | 禁随机 fake id；必须用真实 data-vote 或 env 真实 id |
| 6 | UC-8.x 平均分 | 禁随机 fake id；必须用真实 data-average 或 env 真实 id |
| 6 | UC-10.2 系统通知 | L1 |
| 7 | UC-5.8 条件查频道 | 读族 |
| 7 | UC-11.1 维护公司大群 | L1 |
| 7 | UC-11.2 退出公司 | L2/广播分级 |
| 7 | UC-12.1 健康探针 | 仅基础设施 ①，不代表 IM 功能 |

### 8.2 L2 专项

| UC | 必须证明 | 不允许 |
|---|---|---|
| US-17 他人发消息收推送 | B 发 -> A 收 WS -> A DOM 新行 | A 自发消息冒充 |
| UC-6.1b 拉人后对端实时更新 | B 被拉后真实 WS 收到 channel_member_update | 单账号自己看成员列表冒充对端 |
| UC-5.3b member leave 广播 | 留存成员收到 leave update | A 本地移除行冒充 |
| UC-6.2b admin 广播 | B 收到 role/admin 更新并渲染 data-admin | A 出站后 UI 乐观刷 |

---

## 9. Apifox HTTP 套件规格

### 9.1 定位

Apifox 是 HTTP 面的前置门禁，目标是：

- 验证 HTTP endpoint 可达。
- 验证请求体、headers、响应 envelope。
- 生成/携带 runtime 变量，例如 `groupChannelId`、`postId`、`schedulePostId`。
- 给 UI/E2E 提供后端健康和数据链路前置证据。

Apifox 不是：

- WS 验证器。
- DOM 验证器。
- helix projection 验证器。
- DB/storage 验证器。

### 9.2 必跑参数

```text
project: 8449651
base_url: http://localhost:8066
base_url_java: http://localhost:3399
cookieId: 444
cookieId_B: 678
companyId/teamId: 64118eebd2b665246b7880eb
```

### 9.3 全绿判定

Apifox “全绿”必须满足：

- CLI exit code 为 0。
- 报告中 failed case 为 0。
- runtime variable 不是空值。
- `groupChannelId` 来自 `channel/create` 的真实 `data.id`。
- `postId` 来自真实消息返回或 `getLatestPost` 的真实 `data[0].id`。
- 不允许断言 `undefined !== null` 这种假绿。

但即使满足以上条件，也只能标：

```text
HTTP preflight green
```

不能标：

```text
All UC green
```

---

## 10. 自动化门禁

### 10.1 静态门

每轮必须跑：

```bash
./node_modules/.bin/tsc -p tsconfig.app.json --noEmit
./node_modules/.bin/ng build
git diff --check
```

若改 Rust/Tauri：

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

若改 helix：

```bash
cd /System/Volumes/Data/workspace/rust/helix
cargo test -p helix-im
cargo check
```

### 10.2 reducer / Node 门

所有 touched specs 必须先做语法检查：

```bash
node --check test/specs/<uc>.e2e.mjs
node -e "JSON.parse(require('fs').readFileSync('test/expect/<uc>.expect.json','utf8'))"
```

若 reducer 变更，必须跑 reducer 自测或最小替代：

```bash
node --test test/reducer/*.mjs
```

如果当前项目实际 reducer test 命令不同，以 `scripts/gate.sh` 为最终门。

### 10.3 live WDIO 门

单 UC：

```bash
bash scripts/run.sh -- --spec test/specs/<uc>.e2e.mjs
```

多 UC：

```bash
bash scripts/multi-end-loop.sh --loop 1 \
  --spec test/specs/uc-6.1.e2e.mjs \
  --spec test/specs/uc-6.2.e2e.mjs
```

全量：

```bash
bash scripts/multi-end-loop.sh --loop 1 --all
```

`--all` 当前如果未实现，必须作为本 spec 的 harness 任务补上。

### 10.4 Apifox 门

生成或更新：

```bash
python3 scripts/apifox-suite-create.py
```

运行：

```bash
apifox test-suite run <suite_id> \
  --project 8449651 \
  --access-token "$APIFOX_TOKEN" \
  --environment <env_id> \
  --report
```

报告归档：

```text
.apifox/reports/<timestamp>/
```

### 10.5 风格门

用 browse/截图或等效浏览器工具采集：

```text
/tmp/loopforge-ui-desktop.png
/tmp/loopforge-ui-mobile.png
```

人工/agent 检查：

- 目标页风格一致性。
- 不遮挡。
- 不破坏测试可交互性。
- 视觉控件和真实命令一致。

---

## 11. 红灯归因矩阵

| 红灯 | 第一检查 | 归因 | 修复仓 |
|---|---|---|---|
| Angular 编译失败 | `/tmp/loopforge/run-ng.log` | 模板/TS/CSS | loopforge |
| 按钮点击无 inbound | WDIO + DOM selector | UI wiring | loopforge |
| inbound 有，outbound 无 | `run.jsonl` inbound/outbound | Tauri command 或 helix command registry | loopforge/helix |
| outbound body 错 | `run.jsonl` outbound payload | wire 构造 | helix 优先，Tauri 只传结构化参数 |
| HTTP 000/health 非 200 | curl health + Go log | 后端未起 | cses-im-server runtime |
| HTTP success 但无 WS | Go log + `run-app.log` | 后端广播/连接路由 | cses-im-server 或 L2 分类 |
| WS 入站有，projection 无 | `run-app.log` HOP2/HOP3 | helix parser/gate/projection | helix |
| projection 有，DOM 无 | WDIO DOM + store apply | Angular binding/store apply | loopforge |
| DOM 有，reducer 红 | expect/reducer/corr-key | 机器件归一或 expect 过时 | reducer；expect 只在人审后改 |
| Apifox 绿但 WDIO 红 | `run.jsonl` + WS | HTTP 不等于 WS/DOM | 不允许用 Apifox 覆盖 WDIO |

---

## 12. Agent 编排规格

### 12.1 使用的工作流模式

结合用户给的动态工作流图，采用以下编排：

| 模式 | 用途 |
|---|---|
| Classify-and-Act | reducer 红灯后按断面路由到 loopforge/helix/cses/apifox |
| Fork-and-Synthesize | UI 风格审查、Apifox 报告、L2 WS 诊断可并行收集后合成 |
| Orchestrate-and-Fanout | 全 UC suite 按区域/阶段分批派 worker，但阶段 barrier 串行 |
| Evaluator-Optimizer | 每轮 run -> 失败归因 -> 修复 -> 重跑，最多 3 次同签名后 quarantine |
| Long-Gate Dense | 全量夜间/长任务，依赖 events/status/checkpoint 防丢状态 |

### 12.2 拆 agent 边界

| Agent | 范围 | 禁止 |
|---|---|---|
| UI/UX Agent | Angular 组件、CSS、截图、data-* 保真 | 改 store 业务规则、改 helix |
| E2E Agent | WDIO spec、reducer 调用、expect 使用 | fake id、debug patch、改冻结 oracle |
| Harness Agent | `multi-end-loop.sh`、日志归档、all specs runner | 改业务逻辑 |
| Apifox Agent | `.apifox/**`、Apifox scripts/reports | 宣称 WS/DOM 全绿 |
| Helix Agent | parser/gate/projection/outbound/storage effect | 改 loopforge UI 或 Go server |
| Go Runtime Agent | server 启动、health、日志、必要时后端 gap 复现 | 在未证明后端缺陷时改业务代码 |

### 12.3 并发规则

- UI/UX 和 Harness 可并行，前提是不改同一文件。
- E2E 和 UI/UX 可并行审查，但同一 UC 的 spec 修改必须串行合并。
- helix 和 loopforge 修改必须通过 run.jsonl 证据串联，不能各自凭感觉改。
- Apifox 与 WDIO 可并行跑，但最终报告由主控合并。

---

## 13. Checklist

### 13.1 Spec/台账

- [ ] 统一 `rollout-checklist.md`、`uc-coverage-ledger.md`、`coverage-crossmap.md` 中 UC-6.1/6.2、UC-8.x、Apifox 边界的口径。
- [ ] 把所有 “乐观刷”“debug hook”“fake id” 旧描述改成真实链路或明确历史废弃。
- [ ] 每个 `[~]` 都标明是 L1 partial、L2 pending、backend-gap、Java-gap 还是 night-only。
- [ ] 台账统计重新计算，不能保留旧的“真绿 6”过时摘要。

### 13.2 UI/UX

- [ ] CL 代表 UC live 重跑：UC-5.1 或 UC-5.4。
- [ ] ML 代表 UC live 重跑：UC-1.1、UC-1.5 或 UC-2.3。
- [ ] MB 已完成：UC-6.1、UC-6.2。
- [ ] CP 代表 UC live 重跑：UC-1.1、UC-1.2、UC-1.10。
- [ ] AX 代表 UC live 重跑：UC-9.x、UC-2.4、UC-10.1。
- [ ] 采集 desktop/mobile 截图并对照目标页风格审查。
- [ ] 解决 `app.component.ts` 样式预算 warning，或把预算调整原因写入明确 ADR。

### 13.3 E2E

- [ ] `scripts/multi-end-loop.sh` 支持 `--all`。
- [ ] 所有 `test/specs/*.e2e.mjs` 做 `node --check`。
- [ ] 清点所有 `Math.random()`：允许生成唯一测试文本/临时 client id；禁止生成 server id、vote id、average id、channel id 替代真实回灌。
- [ ] 每个 UC spec 使用真实 UI 触发 SUT；bridge 仅用于 setup、set_uc、或无法由 UI 表达的 debug-only 归属窗口。
- [ ] 所有 specs 红灯必须输出“断在哪一跳”。

### 13.4 Unit/静态

- [ ] `tsc` 绿。
- [ ] `ng build` 绿。
- [ ] `node --test` reducer 绿。
- [ ] `scripts/gate.sh` 绿。
- [ ] 若改 helix：`cargo test -p helix-im` 绿。
- [ ] 若改 Tauri Rust：`cargo check --manifest-path src-tauri/Cargo.toml` 绿。

### 13.5 Apifox

- [ ] `scripts/apifox-suite-create.py` 能创建/更新 suite。
- [ ] Apifox CLI 使用 PAT 运行，不使用 LevelDB session token 跑 suite。
- [ ] 报告归档到 `.apifox/reports/<timestamp>/`。
- [ ] 失败数为 0。
- [ ] 报告明确写：HTTP green，不代表 WS/DOM green。

### 13.6 多端日志

- [ ] Go server 由命令行或 IDE redirect 生成 `/tmp/cses-im-server.log`。
- [ ] 每轮 `multi-end-loop` 归档 run-ng/run-app/run.jsonl/wdio/go log。
- [ ] 红灯报告包含对应日志切片。
- [ ] 长任务中断写 `PARTIAL` 终态行。

---

## 14. Tasklist

### Phase A：规格和台账归一

1. 统一所有 UC 状态口径。
2. 修正过时的绿数统计。
3. 标出 L1/L2/HTTP-only/night-only/excluded。
4. 输出 `docs/uc-rollout/all-uc-real-chain-status.md`。

### Phase B：Harness 补全

1. 给 `scripts/multi-end-loop.sh` 增加 `--all`。
2. 增加 `--apifox` 可选门。
3. 增加 `--screenshot` 可选门。
4. 增加日志归档目录：

```text
/tmp/loopforge/runs/<timestamp>/
```

5. 在 Go log 缺失时输出明确错误和启动建议。

### Phase C：UI/UX 区域回归

1. CL：跑 UC-5.1/5.4，修 selector 或 CSS 问题。
2. ML：跑 UC-1.1/1.5/2.3，修消息行交互。
3. CP：跑 UC-1.1/1.2/1.10，修 composer 参数输入。
4. AX：跑 UC-9.x/2.4/10.1，修辅助面板绑定。
5. 截图审查，统一目标页风格。

### Phase D：全 UC E2E loop

1. 按阶段 0 -> 7 跑 L1 specs。
2. 失败按红灯归因矩阵修复。
3. L1 全部完成后跑 L2 specs。
4. L2 gap 明确写后端/helix/loopforge 归属。
5. 全量通过后更新台账。

### Phase E：Apifox HTTP gate

1. 确认 `APIFOX_TOKEN`。
2. 生成或更新 suite。
3. 跑 full suite。
4. 归档报告。
5. 将 HTTP-only 结论合并到总报告，不覆盖 WS/E2E 结论。

### Phase F：最终出账

1. `scripts/gate.sh` 绿。
2. `multi-end-loop --all` 绿。
3. Apifox full suite 绿。
4. 风格截图通过。
5. 台账和报告一致。
6. 写终态：

```text
✅ DONE loopforge all-UC real-chain closure @<timestamp> | L0/L1/L2/Apifox/style all accounted | <branch>
```

---

## 15. 完成判据

本长任务只有在以下条件全部满足时才能叫“完成”：

1. 所有可测 UC 都有明确状态，且状态可追溯到日志或报告。
2. 所有 UI 区域拆分后都跑过代表 live UC。
3. 全量 WDIO 可运行，失败项不被吞掉。
4. 全量静态/单元门通过。
5. Apifox HTTP suite 通过且报告归档。
6. L2/WS 的结果由真实第二连接证明，或明确标为 pending/gap。
7. 风格截图与目标页面口径一致。
8. 没有 debug patch、mock/fake success、随机假 server id。
9. `rollout-checklist.md`、`uc-coverage-ledger.md`、最终报告三者一致。

---

## 16. 推荐路线

### 方案 A：先全量跑，红了再修

优点：最快知道总体红点。

缺点：日志噪声大，UI 拆分/风格/后端/WS 问题会混在一起。

适合：只做健康巡检，不适合作为本轮主线。

### 方案 B：按 UI 区域收口，再跑全量

优点：每次只碰一个 UI 区域，代表 UC 能快速定位拆分回归。

缺点：全量闭环较晚才暴露跨区问题。

适合：当前阶段，因为组件刚拆完。

### 方案 C：按 UC 阶段拓扑收口，UI 区域作为横向门

优点：最符合 IM 依赖序；同时避免“UI 好看但 UC 不通”。

缺点：执行周期最长，需要严格记录。

推荐：采用方案 C，并在每个阶段插入 UI 区域代表门。执行顺序是：

```text
Phase A 台账归一
  -> Phase B harness 补全
  -> Phase C UI 区域代表门
  -> Phase D 全 UC L1/L2
  -> Phase E Apifox
  -> Phase F 最终出账
```

---

## 17. Spec 自检结论

- 未发现占位章节或空要求。
- 无“Apifox 全绿等于全链路全绿”的矛盾。
- UC-6.2 已按真实链路改为 L1 ① 出站，DOM admin 留给 L2。
- 已明确 Tauri + Angular，不按 React/Vue 设计。
- 已明确所有 mock/fake/debug patch 禁止。
- 已明确全 UC，不是单 UC。
- 实现计划尚未生成，需用户确认本 spec 后再用 `superpowers:writing-plans`。
