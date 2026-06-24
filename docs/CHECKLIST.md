# LoopForge v1 — Todolist & Checklist

> 从 [`PRD.md`](PRD.md) + [竖切 spec](spec/send-message-vertical-slice.md) 派生。issue 见 GitHub `zxs1633079383/loopforge-tauri-im`。
> 图例：✅ 完成 · 🔶 进行中 · ⬜ 待办 · 🔒 阻塞依赖。

---

## 0. 已完成

- ✅ 设计 grilling（12 决策点） → PRD 落盘
- ✅ 新仓 + CLAUDE.md/AGENTS.md/rules（4 条）
- ✅ 竖切 spec（发消息 round-trip）
- ✅ **`helix-driver-instrument` 完整代码**（6 port 装饰器 + Tape + LogSink + InstrumentCtx；10/10 测试绿，含 Record→Replay 往返）
- ✅ **W1-W4 并行落地 + 集成**（src-tauri 宿主 / Angular 薄壳 / 四面 reducer / 录放脚本 / CI / gate 闸门 / UC rollout 蓝图）
- ✅ **配置 profile 系统**（dev-local/pre/prod JSON，src-tauri config loader 读，替掉 env creds）
- ✅ 🎯 **竖切 UC-send-1 四面契约全绿端到端**（真 Tauri+WKWebView+WebdriverIO 对真 Go，真实严格数据）：
  - **① 出站体**严格对齐冻结真机curl真源（`POST /api/cses/posts/create` body）
  - **② 投影**fat `im:post:received` 13 键对齐 projection-schema
  - **③ DOM**点发送→`im:post:sending`乐观转圈→真出站→echo 覆写**真 Go server id**+sent
  - **④ 落库**message 表真落行（storage 装饰器加 corr 列关联到 send 束）
  - 引擎装配走 helix-driver-host 泛型壳 + 5 port 装饰器（RecordingSink<EventSink> + Recording<Storage/Http/Transport/Clock>）；helix 引擎零逻辑改；dev-local 配置驱动；壳零业务逻辑。
  - corr_key 四维全串（ch+tmp+sid+seq）；护栏三闸全绿无作弊。
  - ✅ DONE 竖切 UC-send-1 四面全绿 @run7 | commit 79cae9f | 真 Go server id srd4dk7j8j89xbuaju3jkuqgcy | loopforge/main
  - 待续：tape 回放确定性（send UC 需 tmp 控制，receive/sync UC 更自然）+ IdSource 注入缝（core 侧）+ UC rollout（39 UC）

---

## 1. 工作流（并行，issue W1–W4）

### W1 — src-tauri 宿主（Rust）🔒依赖 helix path dep
- ⬜ Tauri 2 app 骨架（单窗口·无窗口池·无 overlay）
- ⬜ 内嵌 helix 引擎：`run_engine_loop_with_transports` + `EngineDeps` 拼装
- ⬜ 组装根 **debug 构建**包 `Recording<P>` 装饰 Transport/Http/EventSink/Storage/Clock/IdSource
- ⬜ 处理 `BatchSink` vs core `EventSink` 集成缝（driver-host 关注点）
- ⬜ `tauri-plugin-webdriver`（仅 debug，4445）
- ⬜ `#[tauri::command] im_send({channelId,text,temporaryId})`
- ⬜ `im:__bus__` emit 桥（投影 → app.emit）
- ⬜ 就绪 probe 标志（increment_end + inflight0 + cursor 稳 → 暴露给前端）
- ⬜ debug-only `set_uc` 注入命令
- ✅ 验收：`cargo check` 过 + app 起得来 + 4445 可连

### W2 — 前端薄壳（Angular 20）
- ⬜ Angular 20 + Tauri 2 薄壳骨架（抄 chat-virtual-demo）
- ⬜ 语义 DOM 消息行（data-* 直映投影，见 spec §4）
- ⬜ 发送框 + 生成 temporaryId + invoke `im_send`
- ⬜ listen `im:__bus__` → 按 message_item_data 渲染/echo 覆写
- ⬜ 就绪标志渲染（data-ready）
- ⬜ WebdriverIO 接线（wdio.conf.mjs 直连 4445）
- ✅ 验收：`pnpm start` 1420 + 乐观上屏 + echo 覆写手测

### W3 — 测试与 oracle（JS/TS）
- ⬜ 四面 reducer：读 run.jsonl → 按 corr_key 聚束 → 与期望 diff → 「断在哪一跳」报告
- ⬜ corr_key 领域规则（ch+tmp+sid+seq）
- ⬜ 四面期望文件格式 + UC-send-1 期望（① body/② 投影/③ DOM/④ 落库）
- ⬜ send-message e2e spec（WebdriverIO，spec §7）
- ✅ 验收：reducer 对样例 JSONL 出正确束 + e2e 跑通（配 W4 tape）

### W4 — 金标帧 & 运行 harness
- ⬜ Record 脚本：真 go 跑 UC-send-1 → 录 tape → 存 fixtures
- ⬜ Replay 脚本：load tape → 起 app(Replay) → wdio
- ⬜ run 脚本（pnpm 1420 + cargo debug 4445 + wait-on + wdio）
- ⬜ dev-loop 脚本（跨 helix/loopforge 两 repo：改→重建→重跑→读 diff）
- ✅ 验收：一条命令从零到四面报告

---

## 2. 竖切通过后（rollout）

- 🔒 按 UC 顺序铺开，覆盖全 HTTP+WS + 命令集（89 命令/19 WS/27+ UC）
- 🔒 逐 UC 金标帧化 + 四面期望文件
- 🔒 L2 并发场景层（冷启动风暴/交错收发/重连补洞 → 不变量断言）

---

## 3. 验收 checklist（竖切 Definition of Done）

- [ ] W1–W4 各自验收绿
- [ ] UC-send-1 四面全绿（① body 对齐真机curl真源 / ② 投影字段集对齐 projection-schema / ③ DOM tmp→server 覆写 / ④ message 落行 + cursor 推进）
- [ ] Replay 确定性：同 tape 重跑 ≥3 次结果一致
- [ ] reducer 报告无「断点」
- [ ] 契约只读护栏生效（agent 改实现不改期望/golden）
- [ ] 全程 mac 上跑通（tauri-plugin-webdriver WKWebView）
