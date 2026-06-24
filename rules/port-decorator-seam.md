# Rule — port 装饰器是唯一新缝（helix 引擎零改）

> 根 CLAUDE.md §1/§2 展开。核心：**仪表化（日志/录制/回放）只用 Decorator 模式包 helix 的 port trait，不改 helix 引擎一行。**

## 1. 缝的位置

四面要看的每一面都已是 helix 的一个 port → 仪表化 = 包现有 port：

| 面 / 职责 | port | Recording<P> 干什么 |
|---|---|---|
| ① 出站命令体 + 录/放 go 帧 | `Transport` | Live 透传真 go + tee 日志；Record 旁路存 tape；Replay 不调 inner、从 tape 喂 |
| ② 投影 envelope | `EventSink` | tee 日志（投影抵达 Tauri emit 之前抓到） |
| ④ DB 落库行 | `Storage` | tee 日志（或直接查库） |
| 回放确定性 | `Clock` / `IdSource` | Replay 喂录好的时钟/id，helix 才能字节级复现 |
| ③ DOM | （非 port）| WebdriverIO ↔ tauri-plugin-webdriver 内嵌 W3C server |

## 2. 铁律

- ❌ 禁改 helix-core / helix-im / helix-driver-native（path dep 只读消费）。
- ❌ 禁在 helix 引擎内部加日志/录放钩子（侵入 sans-IO，破 HX-C001）。
- ✅ `Recording<P>` 只依赖 helix-core 的 port trait，住 `crates/helix-driver-instrument`。
- ✅ 组装根（src-tauri 拼装 EngineConfig 处）**仅 debug 构建**把真实 port 包一层；production 交裸 port。
- ✅ 装饰器对 Send/!Send 边界透明（透传 inner 的 `MaybeSend`/`MaybeSync` 约束，不硬加 bound，守 HX-C002）。

## 3. 坑

| 反模式 | 危害 | 解 |
|---|---|---|
| 在 IPC 层（Tauri command/emit）做录放 | 看不到真实出站 HTTP body → 第①面丢 | 包 Transport port |
| 在 OS 网络架代理录放 | 回放 go 不在场、时序难还原 | 包 port，clock/id 一并注入 |
| 装饰器硬加 `Send` bound | wasm/FFI !Send future 冲突 | 透传 inner 的 MaybeSend |
