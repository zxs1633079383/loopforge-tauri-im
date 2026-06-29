# docs/harness/ — loopforge-tauri-im Harness Engine（Layer B 索引）

> 方法论真源（Layer C·按需读）：`/Users/mac28/workspace/angular/cses-client/docs/harness-Engineer最佳实战.md`。
> 索引指针（Layer A·开局必读）：项目根 `CLAUDE.md` §9 + 本表。
> **三铁律**：① 踩坑→写 `/workspace/java/logs/{date}.json` ② 同根因≥3/用户明确/Spec 拍板→即时新建 `C{NNN}-*.md` ③ harness 增删→同步 CLAUDE.md §9 索引 + 本表（一次 commit）。

## §1 当前在册 cards
| 编号 | 标题（一句话） | 状态 |
|---|---|---|
| C001 | helix 依赖单一 git 快照（全 helix-* 同源同 rev·禁 path/git 混用） | active |
| C002 | 就绪 probe 判据与投影名解耦（禁硬编 name.contains("increment")） | active |
| C003 | live 验证须 seeded DB（清 DB 无 active channel·send 族全卡） | active |
| C004 | 四面契约只读·红转绿改实现不改 oracle（helix/loopforge 缺陷确认即修+验证） | active |
| C005 | reducer 跨形态归一（corr-key 探 posts[]·storage rows‖keys） | active |
| C006 | UC rollout 依赖序 + 每阶段全绿→tag+补用例 | active |
| C007 | Angular 模板加 (event) 必同步加组件方法（否则 ng serve 挂·run 假死） | active |
| C008 | 测试可证伪铁律——破坏即 fail·禁墙钟下界·禁 tautology（借鉴 helix HX-C011） | active |
| C009 | 自动修复 agent 禁自产自判——红转绿由独立 reducer 裁定（借鉴 helix HX-C009/C012） | active |
| C010 | 金标帧=现网真抓非手写猜测·补帧 playbook（借鉴 helix golden fixtures） | active |
| C011 | UC 台账诚实出账——分级图例·禁橡皮章借证据冒充（借鉴 helix ledger） | active |
| C012 | 提交闸门机器强制——pre-push hook 跑 gate.sh + clippy 卫生（借鉴 helix install-hooks/clippy） | active |
| C013 | 纯渲染壳·零业务逻辑（处理逻辑必须在 helix·本仓只绑定·第二北极星纯绑定覆盖率→100%·禁区 grep→0） | active |
| C014 | 每-UC 状态隔离（暖栈 spec 跑序无关·reload 复位 DOM/inflight/in-memory·自驱保 boot hop·禁 stale-cursor restore） | active |
| C015 | 可观测性逐跳覆盖（4 跳每跳必有 hop 探针·Tick::Inbound 等旁路绕过 Recording 致②盲点·缺一跳即诊断盲点·补 HOP2/HOP3） | active |

> 稳态目标 10-20 条；当前 15（C001-C007 本会话踩坑·C008-C012 借鉴 helix·C013 纯渲染壳铁律·C014 暖栈 flaky-state 隔离·C015 逐跳可观测）。超 30 → 跑 merged/deprecated 清理（见 §3）。
> 闸门：`bash scripts/gate.sh`（镜像/索引不变量/录放 feature 闸/reducer 自测/expect JSON/helix 单版本/行数）。

## §2 cards 与 UC rollout 的关系
UC rollout 是本 harness 的核心长任务。每铺一个 UC 必走 C006 闭环；途中踩坑按三铁律沉淀新卡。
- 计划/勾选：`docs/uc-rollout/rollout-checklist.md`（依赖序 31 UC + L2 4）
- 端点账：`docs/uc-rollout/coverage-crossmap.md`（124 HTTP/19 WS 逐个对 UC）
- 四面契约：`docs/uc-coverage-ledger.md`

## §3 生命周期
`drafting`（新建未实战）→ `active`（在册执行·grep/CI/test 自证）→ `merged`（30 天零复现 + inline 进 ~/.claude/rules/）/ `deprecated`（场景消失·文件留作历史）。

## §4 7 节卡片格式
见 `TEMPLATE.md`：§1 触发场景 §2 背景 why §3 Required/Forbidden §4 Verification(可执行) §5 Recurrence Log §6 关联 §7 历史与演进。**写不出可执行 §4 → 不是 harness**（走 SESSION/log/coding-style）。

## §5 运营流水
新建/升级/退役/未达门槛的踩坑 → 追加 `log.md`。
