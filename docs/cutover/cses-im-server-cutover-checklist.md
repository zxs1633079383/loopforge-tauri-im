# 切流 Checklist — mattermost(四段) → cses-im-server(三段)

> 配套 spec：[`cses-im-server-cutover-spec.md`](./cses-im-server-cutover-spec.md)。逐项勾选；标 ✅/⬜/🟡(阻塞)。

## A. 本仓改动（代码/文档/记忆·已随本次提交落地）

- [x] `config/dev-local.json` apiBase/wsUrl `8065→8066`（真切端点·单一真源）
- [x] `scripts/l2-observe-678.mjs` 默认 `L2_WS` `8066` + 注释 go-mattermost→cses-im-server
- [x] `scripts/l2-act.sh` 注释 go-mattermost→cses-im-server
- [x] `.claude/workflows/uc-rollout-overnight.js` infra/后端起停节重写（health 8066·stdout 重定向·删 gRPC/telepresence·四段→三段）
- [x] `.claude/workflows/uc-rollout-l2.js` apiBase/ws 8066·health 端点·鉴权说明
- [x] `docs/uc-rollout/autonomous-runbook.md` §6.1 四段→三段 + §3/一句话/铁律
- [x] 记忆 `four-segment-log-debug.md` 三段重写 + `MEMORY.md` 索引 + `uc-rollout-domain-a.md` 已弃标注
- [x] 新建 `docs/cutover/` spec + checklist
- [x] test specs（5.5b/5.6w/3.2）+ src（app.component/im-store）注释 `go-mattermost :8065`→`cses-im-server :8066`（spec §5.2·im-store:2355 z-base-32 保留）
- [x] `src-tauri/src/commands.rs` ×4 注释（im_announcement_save/read/delete + im_post_pin）`go-mattermost`→`cses-im-server`·并把陈旧「阻于 cses-java」诚实重述为「阻于后端 WS 业务广播链（切 cses-im-server 后待复验）」（2026-06-26 补·§5.2 漏项·镜像 app.component:981/im-store:1188 既有处理）
- [x] `CLAUDE.md` + `AGENTS.md` §8.3 line 101 「四段日志…重启 cses-java」→「三段日志…cses-im-server :8066 默认对」（镜像对齐·gate 镜像闸复验绿）
- [ ] **复验后再改**（禁 find-replace·C011）：`docs/uc-coverage-ledger.md` / `coverage-crossmap.md` / `pure-ui-audit` 的「go :8065 真绿」可达性断言——须重跑 e2e 复验绿后再就地更新（spec §5.3）
- [x] 不碰：`test/expect/*.expect.json`（冻结 oracle·C004）+ `docs/harness/log.md`（append-only）+ pre/prod.json（路径不变）（spec §5.4）

## B. 后端起栈（每次联调前·本机）

- [ ] PG 起：`pg_isready`（DSN `CSES_IM_DB_DSN`·默认 `postgres://localhost:5432/cses_im?sslmode=disable`）
- [ ] Redis 起：`redis-cli ping` → PONG（`CSES_IM_REDIS_ADDR`·默认 `localhost:6379`）
- [ ] 首次建表：`psql "$DSN" -f sql/001_channel_event.up.sql` + `sql/002_msg_count_all.up.sql`（cses-im-server repo 内）
- [ ] 起 cses-im-server（落文件）：
      `cd /Users/mac28/workspace/golangProject/cses-im-server && CSES_IM_LISTEN_ADDR=:8066 CSES_IM_LOG_FORMAT=json go run ./cmd/server > /tmp/cses-im-server.log 2>&1 &`
- [ ] 就绪：`tail /tmp/cses-im-server.log` 见 `listening addr=:8066`
- [ ] paas-grpc 留空（三段模式·优雅跳过 legacy user 元数据）
- [ ] 停旧栈（避免端口/认知混淆）：旧 mattermost(:8065) + cses-java 可不起；如并存则确认 loopforge 打的是 :8066

## C. 冒烟验证

- [ ] health：`curl -s -o /dev/null -w "%{http_code}" localhost:8066/api/cses/health` → 200
- [ ] gate：`bash scripts/gate.sh` 全绿
- [ ] 竖切：`bash scripts/harness.sh up` → `bash scripts/run.sh -- --spec test/specs/uc-1.1.e2e.mjs`（seeded DB）→ 四面 reducer 全绿
- [ ] L2 观测：`node scripts/l2-observe-678.mjs`（连 :8066·收 hello）
- [ ] L2 动作鉴权：`scripts/l2-act.sh whoami` → 200（cookieId 桥）
- [ ] 三段 tail 验日志：`tail -f /tmp/loopforge/run-app.log /tmp/cses-im-server.log`

## D. 收口

- [ ] 代表性回归（暖栈 warm spec 抽样若干 UC·四面/可达面绿）
- [ ] `docs/harness/log.md` 追加切流终态行（`✅ DONE 后端切 cses-im-server 三段 @ts | ...`）
- [ ] commit（conventional 中文·触发结构化 body）+ 不 merge main（留 PR/人审）
- [ ] 如出现同根因 ≥3 → 评估新建 harness card（C013+·三铁律）

## 排障速查（红时）

| 症状 | 判端 | 处置 |
|---|---|---|
| 出站 HTTP 全 000 / WS 连不上 | ③ cses-im-server 未起 | `pkill -f 'cmd/server'` → 重起（B 节命令） |
| health 非 200 | ③ 后端挂 / 依赖缺 | 查 PG/Redis 起·`tail /tmp/cses-im-server.log` 看 panic |
| 出站 body 字节偏离 expect | ① loopforge 壳 / ② helix outbound | 改实现（契约只读）→ 复跑 |
| increment/acl/gate 异常 | ② helix | helix 仓修 + 验证 |
| `lsof` 找不到 cses-im-server 日志文件 | slog stdout-only | 启动须加 `> /tmp/cses-im-server.log 2>&1`（非缺陷） |
