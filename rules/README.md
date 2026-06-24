# Rules — loopforge-tauri-im

根 [`CLAUDE.md`](../CLAUDE.md) 的约束层展开（按需 Read）。优先级：用户当前会话指令 > 本仓 rules > helix 上游 rules > 全局 `~/.claude/rules`。

| 文件 | 管什么 | 级别 |
|---|---|---|
| [port-decorator-seam.md](port-decorator-seam.md) | 唯一新缝：Recording<P> 装饰 port，helix 引擎零改 | 硬顶 |
| [four-facet-oracle.md](four-facet-oracle.md) | 四面契约断言 + 领域键认领 + 静默 probe | 硬顶 |
| [contract-readonly-autofix.md](contract-readonly-autofix.md) | 自动修复护栏：引擎可改·契约只读·改契约需人审 | 硬顶 |
| [golden-replay-determinism.md](golden-replay-determinism.md) | 双轨 + 金标帧 test-only + 回放确定性（clock/id 注入） | 硬顶 |
