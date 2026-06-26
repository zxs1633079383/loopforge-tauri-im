# C013 — 纯渲染壳·零业务逻辑（处理逻辑必须在 helix·本仓只绑定）

> 状态：active · 2026-06-26 grilling 拍板 · 真源 `docs/纯渲染壳-铁律与helix迁移台账.md`

## 1. 问题（踩了什么坑）

本仓定位是「helix 投影的纯渲染验证场」，但 store（`im-store.service.ts` 2365 行）里堆了一大坨
**本该在 helix 的处理逻辑**：tmp→server 对账（`applyMessageItem`）、wire body 解析重组
（`extract*`/`applyMembersSnapshot`）、格式归一（`normalize*`）、业务规则（role→admin）。
每加一个 UI 功能就顺手在本仓再写一段 TS/Rust 处理——**方向反了**：缺东西该去 helix 补投影/指令，
不是在本仓对接额外逻辑。

## 2. 铁律（违反即拒）

本仓 TS **只能**：(a) 投影字段 1:1 绑 `data-*`/DOM；(b) 纯展示格式化（hash 色/HH:MM/首字母）；
(c) signal 持快照；(d) 用户动作发 IPC。

**禁**：解析/重组 payload · 合并/对账状态（tmp→server·upsert·dedup）· 归一 wire 格式 ·
编码业务规则。缺 render-ready 数据 → **去 helix-im 补投影/指令**，回本仓只绑。

试金石：「helix 已整形好吐出来，这行还需要存在吗？」答否 = 债。

## 3. 北极星 + 迁移

- 北极星 = `纯绑定渲染路径 / 总渲染路径` → 100%（path = 一个 `apply*` 函数·纯绑定 = 只 upsert+赋值）。
- 背靠背：`src/app/im/*.ts` 禁区 grep 命中 → 0。精确闸门基线 2026-06-26 = 31 命中（§4 模式）。
- 迁移：冻结（不增）+ 台账（§4 真源）+ 顺手迁（碰 UC 就把 shaping 搬 helix·删本仓 apply\*）。
  头阵 = `applyMessageItem`（helix 入库成功吐 render-ready 终态行·本仓直接渲染+取消转圈）。

## 4. Verification（机器闸门·可跑）

```bash
# 禁区命中数（覆盖率背靠背指标·应单调 ≤ 基线·冻结=不增）
HITS=$(grep -roE "extract[A-Z][A-Za-z]+|normalize[A-Z][A-Za-z]+|_rows\(\)\.findIndex|role *=== *['\"]CREATOR|role *=== *['\"]ADMIN|role *=== *['\"]MANGER" src/app/im/*.ts | wc -l | tr -d ' ')
BASELINE=22   # S4(applyMessageItem 迁移)后下调 31→22·随迁移单调下调·禁上调
echo "纯渲染壳禁区命中: $HITS / 基线 $BASELINE"
[ "$HITS" -gt "$BASELINE" ] && echo "⛔ C013 违反：本仓新增了处理逻辑（应去 helix 补投影/指令）" && exit 1
echo "✅ C013：未新增本仓处理逻辑（冻结生效）"
```

> 接入 `scripts/gate.sh`（pre-push 强制）。每完成一批 helix 迁移 → 下调 `BASELINE` 到新命中数
> （台账 §4 同步 +1 纯绑定）。`HITS == 0` ⟺ 北极星 100%。

## 5. 关联

- 铁律真源 `docs/纯渲染壳-铁律与helix迁移台账.md`（含 apply\* 台账 + 迁移设计）。
- 上游对照：helix `HX-C001` sans-IO（本仓不改 helix 引擎·只在 helix 补投影/指令）。
- 第一北极星 `docs/NORTH-STAR.md`（UC 覆盖）正交互补。
