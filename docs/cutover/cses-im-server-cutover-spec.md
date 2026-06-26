# 后端切流 Spec — mattermost(四段) → cses-im-server(三段)

> **日期**：2026-06-26 · **决策**：用户拍板「三段拓扑（cses-im-server 自包含）+ 真切 config 端点 + 新建 docs/cutover/」。
> **一句话**：loopforge 联调后端从旧 **mattermost 单体(:8065)→gRPC→cses-java** 整链，切到 **cses-im-server**（:8066·Go·gorilla/mux+ent+PG+Pulsar+Redis·自包含）。四段联调 → 三段联调。
> **配套**：执行清单 → [`cses-im-server-cutover-checklist.md`](./cses-im-server-cutover-checklist.md) · 三段日志真源 → `docs/uc-rollout/autonomous-runbook.md §6.1` · 记忆 → `four-segment-log-debug`。

---

## 1. 背景 / 动机

旧联调栈是**四段**：`loopforge + helix + mattermost-go(:8065) + cses-java(gRPC 后端)`，其中 mattermost-go 经 gRPC（`app/grpcx9.go` + telepresence 隧道 `tp-connect.sh`）调远程 cses-java（Micronaut·端口 3399/7091/3391）。痛点：

- gRPC 隧道（telepresence）频繁断 → e2e 出站全 000，误判为 loopforge/helix 缺陷（实为环境）。
- cses-java 起停重（gradlew run + rebuild），且依赖 k8s 远程 service 可达。
- 链路四段，定位「断在哪一端」成本高。

**cses-im-server** 是从 mattermost csesapi 整体迁移而来的独立 Go IM 后端，**自包含**（PG/Redis/Pulsar），WS 照抄 mattermost platform，HTTP 前缀与 WS 路径**刻意对齐旧 mattermost**。切到它后链路降为三段、无 gRPC/隧道/java。

---

## 2. 拓扑变更

```
旧（四段·已弃）：
  loopforge(Tauri) → helix(进程内) → mattermost-go(:8065) ──gRPC/telepresence──→ cses-java(Micronaut :3399)

新（三段）：
  loopforge(Tauri) → helix(进程内) → cses-im-server(:8066·自包含 PG/Redis/Pulsar)
```

| 维度 | 旧 mattermost | 新 cses-im-server |
|---|---|---|
| 进程数（后端） | 2（go + java，gRPC 桥） | 1（自包含） |
| 端口 | 8065 | **8066**（`CSES_IM_LISTEN_ADDR`） |
| 外部依赖 | k8s 远程 service（telepresence 隧道） | 本地 PG + Redis（+ 可选 Pulsar/ES/Consul） |
| gRPC/隧道 | 必需（`grpcx9.go` + `tp-connect.sh`） | **无** |
| 日志 | FileAppender → `mmlog/mattermost.log` + java `/tmp/cses-java.log` | **slog stdout-only**（无 FileAppender·须重定向） |

---

## 3. 端点映射（关键：路径不变·仅端口）

cses-im-server `internal/api/router.go` 刻意保留旧前缀/路径，**对齐前端 `im_ws_client.rs:214` 写死的 WS 路径**：

| 项 | 旧（mattermost） | 新（cses-im-server） | 变化 |
|---|---|---|---|
| HTTP apiBase | `http://localhost:8065/api/cses` | `http://localhost:8066/api/cses` | **仅端口** |
| WS wsUrl | `ws://localhost:8065/api/v4/websocket` | `ws://localhost:8066/api/v4/websocket` | **仅端口** |
| 健康检查 | `/api/v4/system/ping` | `/api/cses/health` | 路径变 |
| HTTP 前缀 | `/api/cses` | `/api/cses` | 不变 |
| WS 路径 | `/api/v4/websocket` | `/api/v4/websocket` | 不变 |
| 鉴权 | cookieId=userId 桥 | cookieId=userId 桥（不变·入站拿 header 当 userId·无 token） | 不变 |

> **端口取舍**：cses-im-server 默认 `:8066`，但 `.env.example` 提供 `CSES_IM_LISTEN_ADDR=:8065` 可 drop-in 顶替 mattermost。本切流选 **:8066**（与旧 mattermost 可并存·配置显式切换更安全），故 `config/dev-local.json` 真改端口；如改跑 :8065 则配置可不动（但须先停 mattermost）。

---

## 4. cses-im-server 运行

- **repo**：`/Users/mac28/workspace/golangProject/cses-im-server`（go.mod 在根）
- **启动**（落文件·联调用）：
  ```bash
  cd /Users/mac28/workspace/golangProject/cses-im-server
  CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json \
    go run ./cmd/server > /tmp/cses-im-server.log 2>&1 &
  ```
- **就绪标志**：`tail /tmp/cses-im-server.log` 见 `listening addr=:8066`
- **健康**：`curl -s -o /dev/null -w "%{http_code}" localhost:8066/api/cses/health` → 200
- **依赖**（自包含核心）：

| 服务 | env key | 默认 | 必需性 |
|---|---|---|---|
| PostgreSQL | `CSES_IM_DB_DSN` | `postgres://localhost:5432/cses_im?sslmode=disable` | 必需 |
| Redis | `CSES_IM_REDIS_ADDR` | `localhost:6379` | 单机可选/多 pod 必需 |
| Pulsar | `CSES_IM_PULSAR_URL` | `pulsar://localhost:6650` | 留空=同步 fallback |
| paas-grpc（旧 user 元数据） | `CSES_IM_PAAS_GRPC_ADDR` | `localhost:9090` | **三段模式留空**（优雅跳过） |
| Consul（跨 pod 发现） | `CSES_IM_DISCOVERY` | 空=noop | 单机留空 |

- **日志**：slog 写 **stdout only**（`internal/infra/logging/logging.go`·无 FileAppender）。联调须 `> /tmp/cses-im-server.log 2>&1` 重定向。格式 `CSES_IM_LOG_FORMAT`（`dev` 彩色 / `json` 结构化·联调建议 json）；级别 `CSES_IM_LOG_LEVEL`（默认 info）。
- **建表**（首次·切流 runbook §1）：`psql "$DSN" -f sql/001_channel_event.up.sql` + `sql/002_msg_count_all.up.sql`。

---

## 5. 影响范围（本仓 + 记忆）

### 5.1 已切换（本次提交）

| 类别 | 文件 | 改动 |
|---|---|---|
| **配置（真切端点）** | `config/dev-local.json` | apiBase/wsUrl `8065→8066` + _note 标后端=cses-im-server |
| **脚本** | `scripts/l2-observe-678.mjs` | 默认 `L2_WS` `8065→8066` + go-mattermost→cses-im-server 注释 |
| **脚本** | `scripts/l2-act.sh` | go-mattermost→cses-im-server 注释 |
| **workflow** | `.claude/workflows/uc-rollout-overnight.js` | infra 纠偏/后端起停节重写（health 8066·stdout 重定向·删 gRPC/telepresence）·四段→三段 |
| **workflow** | `.claude/workflows/uc-rollout-l2.js` | apiBase/ws 8066·health 端点·删 go-mattermost/cses-java 鉴权臆测 |
| **runbook（日志真源）** | `docs/uc-rollout/autonomous-runbook.md` | §6.1 四段→三段重写 + §3 红转绿判端 + 一句话/铁律 |
| **记忆** | `four-segment-log-debug.md` | 三段重写（保留 slug 稳定锚） |
| **记忆索引** | `MEMORY.md` | 三段日志联调条目 |
| **记忆** | `uc-rollout-domain-a.md` | §四段日志整节标「已弃·历史参考」+ 切流 note |

### 5.2 已切换（P2 注释·本次一并改·不影响运行·端点运行时从 config 读）

仅注释/文案含旧 `go-mattermost :8065` 字样，已改为 `cses-im-server :8066`：

- [x] `test/specs/uc-5.5b.e2e.mjs`、`uc-5.6w.e2e.mjs`、`uc-3.2.e2e.mjs`（注释端口/服务名）
- [x] `src/app/app.component.ts`、`src/app/im/im-store.service.ts`（注释「① 出站经 cses-im-server 可真跑」；`im-store.service.ts:2355` "mattermost z-base-32 字符集" 是 id 编码说明·**保留不改**）
- [x] `src-tauri/src/commands.rs` ×4（im_announcement_save/read/delete + im_post_pin doc 注释·2026-06-26 补此前漏项）：`go-mattermost`→`cses-im-server`；陈旧「阻于 cses-java」→「阻于后端 WS 业务广播链（切 cses-im-server 后待复验）」（与 memory 实测纠正一致：echo 阻塞真因已是 cses-im-server Pulsar nodeId self-filter 丢帧·非 cses-java）
- [x] `CLAUDE.md` + `AGENTS.md` §8.3：「四段日志（§6.1）…重启 cses-java」→「三段日志（§6.1·loopforge+helix+cses-im-server）…cses-im-server :8066 默认对」（镜像同步·gate 镜像闸复验绿）

### 5.3 待**重新验证后**再更新（禁 find-replace·C011 诚实出账）

下列是 **coverage/台账/审计** 文档，其「① 经 go :8065 真绿」类**可达性断言是针对旧 :8065 实跑验证出来的**。切到 :8066 后这些断言**需重跑 e2e 复验**才算数——**禁止直接 find-replace 改成 :8066**（那是把未验证状态冒充已验证·违反 C011/C008）。复验流程见 checklist §C/§D，复验绿后再就地更新端口与服务名：

- `docs/uc-coverage-ledger.md`（多处「go :8065 真绿」+ cses-java 阻塞说明）
- `docs/uc-rollout/coverage-crossmap.md`（写族 echo backend-down 说明）
- `docs/architecture-review/pure-ui-audit-2026-06-26.md`（2026-06-26 回归快照·日期化历史·可按需新出一份 review）
- `docs/uc-rollout/00-rollout-plan.md`（如含 :8065·随计划复核更新）

### 5.4 不动（冻结契约 + append-only 历史·禁改写）

- `test/expect/*.expect.json`（如 `uc-5.5b.expect.json` 的 `$schema-note`/`_note` 含 go-mattermost:8065/cses-java 字样）—— **冻结 oracle·契约只读（C004）·一律不碰**（连描述性 note 也不改·守「禁橡皮章」边界）。
- `docs/harness/log.md` —— 历史 log 条目（含旧 mattermost/cses-java 排障记录），**append-only 不回改**；后续条目自然用三段术语即可。
- `config/pre.json` / `config/prod.json` —— 占位域名 + 同样的 `/api/cses` + `/api/v4/websocket` 路径，路径不变故无需改（上线替真域名时一并处理）。

---

## 6. 验证

切流后**冒烟**（cses-im-server 已起 + PG/Redis 就绪）：

1. `curl -s -o /dev/null -w "%{http_code}" localhost:8066/api/cses/health` → 200
2. `bash scripts/gate.sh` 绿（镜像/索引/expect JSON/helix 单版本不变量）
3. 暖栈 + 单 UC 竖切：`bash scripts/harness.sh up` → `bash scripts/run.sh -- --spec test/specs/uc-1.1.e2e.mjs`（seeded DB）→ 四面 reducer 全绿（① 出站打到 :8066·③ DOM·④ DB）
4. L2：`node scripts/l2-observe-678.mjs`（连 :8066）+ `scripts/l2-act.sh whoami`（cookieId 桥鉴权 200）
5. 三段 tail 验日志落点：`tail -f /tmp/loopforge/run-app.log /tmp/cses-im-server.log`

> 红 → 三段日志（runbook §6.1）定位：① loopforge ② helix ③ cses-im-server(health/未起)。契约只读·绿由 reducer 裁定（C004/C009）。

---

## 7. 回滚

切流是配置 + 文档级，回滚低成本：

1. `config/dev-local.json` apiBase/wsUrl 改回 `:8065`
2. 重启旧 mattermost(:8065) + 重建 gRPC 隧道（`tp-connect.sh` 四空格密码）+ 起 cses-java（`gradlew run`）
3. 旧四段做法见 runbook §6.1 末「附：旧 mattermost 四段（已弃）」与记忆 `four-segment-log-debug` 末节（保留备查）
