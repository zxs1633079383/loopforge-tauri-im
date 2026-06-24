# Rule — 双轨 + 金标帧 test-only + 回放确定性

> 根 CLAUDE.md §4 展开。核心：**自动修复闭环必须确定性 → 日常跑金标帧；真 go 夜间抓漂移。**

## 1. 双轨

| 轨 | 何时 | 输入 | 验什么 |
|---|---|---|---|
| 金标帧（确定性·秒级） | 日常 / 自动修复闭环 | 录好的 go 帧 + 时钟/id（tape） | 整个客户端栈（经真实 Tauri+WKWebView+WebdriverIO） |
| 真 go | 夜间 / 按需 | 真连 go | go 后端行为漂移 |

## 2. 金标帧确定性三要素（缺一即非确定）

录 tape 时三样一起录、回放时三样一起喂：

1. **go 帧**：Transport 装饰器抓的 WS/HTTP 出入站字节。
2. **时钟**：Clock 装饰器抓的 now_ms 序列（helix 确定性要求时间由 host 注入）。
3. **id**：IdSource 装饰器抓的 id 序列（确定性要求 id 由 host 注入）。

> 只录 go 帧、不录时钟/id = 回放仍非确定（helix 内部 timer/id 漂移）。

## 3. 铁律

- ❌ 金标帧录放代码进 release 构建。
- ❌ 改 tape 让测试过（见 contract-readonly-autofix，tape 只读）。
- ✅ tape 落 `tests/fixtures/`，命名锚 UC + 帧类型（echo / sync-with-messages / type2-3-6）。
- ✅ 录制走真 go 一次，之后回放；go 漂移由夜间真 go 轨发现 → 触发重录（人审后）。
