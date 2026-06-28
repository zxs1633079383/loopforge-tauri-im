---
description: 启动 loop-Engine 真 autonomous run(确定性内核 + 真 agent 数据面·自驱 UC 到四面绿)
---

# /loop-engine — 启动自治研发引擎

把 `scripts/loop-engine/` 的确定性内核(调度/路由/安全阀/状态·288 测试绿)接上真 agent 数据面,自驱 UC 到四面契约全绿。

## 用法

- `/loop-engine` — **single 模式(默认)**:按依赖序挑第 1 个 issue 驱动一遍 = **L3 首证**(证明引擎能把一个真 red UC 自驱到绿)。
- `/loop-engine single UC-1.9` — 指定单个 UC 做首证。
- `/loop-engine full` — **full 模式**:依赖序驱动全部 #7-#41(通宵·受 token 预算约束·预算 <15% 自停 + resume)。

## 执行(用 Workflow 工具)

收到本命令时,用 **Workflow 工具**调用已存的脚本(仓库约定 `.claude/workflows/`):

```
Workflow({
  scriptPath: ".claude/workflows/loop-engine.js",
  args: { mode: "single" | "full", uc: "<可选·如 UC-1.9>" }
})
```

> 默认 `mode:"single"`(最安全·先做 L3 首证)。用户说 "full" / "通宵" 才传 `mode:"full"`。

## 它会做什么(每个 issue)

1. `gh issue view` 读四面锚点 → 接最简 UI/实现(grill 接地·provenance·不臆造)
2. `bash scripts/run.sh -- --spec test/specs/uc-X.e2e.mjs` → reducer 四面裁决(C009 绿由 reducer 裁定)
3. 红 → 三段日志(loopforge/helix/cses-im-server)定位哪一仓 → 调 `route()` 拿动作 → 修(helix 分支/壳绑定/pencil/重启后端)→ 重跑
4. 四面全绿 → append `issue_green` + `gh issue close`;不可逆/修不动 → park 写 `NEEDS_HUMAN_*.md` 不阻塞

## 护栏(机器强制)

- 契约只读(C004)· 纯壳(C013)· helix 分支修=可逆自决 / 合 main=park · 禁 merge main / 禁 push · 预算储备 15% 自停 · 连败 3 park · 同 gap 第 3 次 quarantine。
- 真源:`docs/loop-engine/SPEC.md`(设计)· `FLOW.md`/`flow.mmd`(执行流)· `IMPL-STATUS.md`(落地)。
