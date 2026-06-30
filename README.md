# loopforge-tauri-im

> UI 精简、功能五脏俱全的轻量 IM 成品客户端，**内嵌真实 helix 引擎**，经真实 Tauri + WKWebView 跑端到端自动化测试，喂「自动测试 → 自动修复 → 自动验证」闭环。
> 它是「消息系统正式接入 cses-client 之前」的契约一致性自动化夹具：与 cses-client 消费**同一个 helix 引擎 + 同一份冻结契约**，本仓负责机器断言、cses-client 负责生产渲染。
>
> 完整需求见 [`docs/PRD.md`](docs/PRD.md)，项目约束见 [`CLAUDE.md`](CLAUDE.md)。

## 目录地图

三层架构：**前端薄壳 (`src/`) → Tauri Rust 后端 (`src-tauri/`) → 仪表层 (`crates/`) → helix 引擎（上游 path dep，不在本仓）**。

### 主目录

| 目录 | 作用 |
|------|------|
| `src/` | 前端薄壳（Angular 20）。纯渲染壳，消息行 DOM 的 `data-*` 直映投影字段供机器断言；零业务逻辑，只做绑定/展示/发 IPC。 |
| `src-tauri/` | Tauri 2 Rust 后端。内嵌 helix-driver-native + helix-im 真正接管引擎，暴露 89 个 invoke 命令 / 21 投影事件总线（`im:__bus__`），debug 构建注入 webdriver。 |
| `crates/` | 本仓唯一新增 Rust crate（仪表层 `helix-driver-instrument`），用 `Recording<P>` 装饰器包 helix 的 port trait 做日志/录制/回放，守 helix 引擎零改。 |
| `docs/` | 全部文档真源：PRD、UC rollout 纪律、harness 知识卡、契约 spec、架构 review、迁移与切换台账。 |
| `test/` | 端到端测试场：WebdriverIO e2e spec、四面契约期望文件、四面 reducer、金标帧 fixtures。 |
| `scripts/` | 工程脚本：`run.sh`(跑 e2e)、`gate.sh`(提交闸门)、`record.sh`/`replay.sh`(录放)、loop-engine 自动闭环、DB seed。 |
| `config/` | 三套环境配置（`dev-local` / `pre` / `prod`）。 |
| `design/` | UI 设计稿与导出（screens / export）。 |
| `rules/` | 编码/测试/git 等通用规约镜像。 |
| `tools/` | 辅助工具（gate 相关）。 |

### 前端业务模块（`src/app/im/`）

| 文件 | 作用 |
|------|------|
| `tauri-bridge.service.ts` | IPC 桥：封装 invoke 命令调用 + listen 投影事件总线，前端唯一对 Rust 的通道。 |
| `im-store.service.ts` | 前端状态快照：持有投影下来的 render-ready 数据，驱动模板渲染。 |
| `message-row.model.ts` | 消息行模型：定义 DOM `data-*` 字段与投影字段的 1:1 映射。 |
| `projection.types.ts` | 21 个投影工厂的 TS 类型定义（对齐冻结的 `projection-schema.md`）。 |

### Tauri 后端模块（`src-tauri/src/`）

| 文件 | 作用 |
|------|------|
| `lib.rs` | 瘦入口：组装 State、注册命令、装配仪表化引擎。 |
| `commands.rs` | 89 个 `#[tauri::command]` 实现（HTTP/WS/UC 全命令集）。 |
| `engine.rs` | helix 引擎装配根：注入 native driver + instrument 装饰器。 |
| `state.rs` | Tauri State（引擎句柄等运行时状态）。 |
| `config.rs` | 后端配置加载。 |
| `tick_tee.rs` | tick 旁路分流（可观测性逐跳 hop 探针）。 |

### 仪表层模块（`crates/helix-driver-instrument/src/`）

`recording.rs` 是核心 `Recording<P>` 装饰器；按 port 拆 `transport.rs` / `event_sink.rs` / `storage.rs` / `clock.rs` / `id.rs` / `http.rs` / `blob.rs`，分别装饰对应 helix port；`event.rs` + `log_sink.rs` 吐结构化 JSONL hop 事件，`tape.rs` 录放金标帧。
