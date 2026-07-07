# loopforge 编排总规划 — UI 升级 + helix 纯渲染壳迁移（双流水线 · 动态 loop reactor）

> 2026-06-26 grilling 拍板。本文件 = 本轮大工程的**编排真源**。配套：
> `6-facet-oracle.md`（Phase 0b 验证边界扩展）· `conductor.md`（动态 loop reactor + 骨架）·
> A1/A2 workflow 骨架在 `.claude/workflows/ui-a1-design.js` / `ui-a2-bind.js`。
> 本仓所有 md 一律中文。

---

## 0. 一句话

用**一个动态 loop（Conductor reactor）**驱动两条流水线——**B = helix 纯渲染壳迁移（长 loop-Engineer · 串行 · 三端联调）** 与 **A = UI 升级（A1 pencil 设计 workflow 并行 + A2 解锁批绑定 workflow）**——靠 main 上三个单写者 append-only 信号 log 通信，把第一北极星（UC 覆盖）与第二北极星（纯绑定覆盖率）一起单调推到顶。

---

## 1. Problem / Solution（用户视角）

- **Problem**：① 台账 §2 覆盖率分母过时（24 vs 实测 19）误导进度；② UI 是单文件 1463 行 `app.component.ts`、`routes=[]` 无路由、左侧群聊列表缺「最后一条消息 / 加急 / 艾特」、多处仍 mock；③ 19 条渲染路径里多数是壳内 shaping（欠 helix render-ready），违 C013 纯渲染壳铁律；④ 三端（loopforge + helix + cses-im-server）联调「互相补齐代码」缺一个能长跑、可中途统筹的自驱编排。
- **Solution**：把上述拆成两条可并行的流水线 + 一个动态 loop reactor 统筹，使「helix 补 render-ready → 壳删 shaping 绑定 → 四面 reducer 裁绿」逐行滚动闭环，UI 同时升级成真 Router 多 tab、全链路真 HTTP+WS、测试全覆盖，且全程 test-only 不影响 dev 开发路径。

---

## 2. 拓扑（链式 · 已拍板）

```
P0(main 上做) ─┬─ P0a 校正数字（台账§2 分母 24→19 + C013 闸门回填禁区真值）
               ├─ P0b 6 面 oracle 扩展（test-only·见 6-facet-oracle.md）
               └─ P0c scaffold（3 信号 log 空骨架 + render-board.sh）
                        │ 分叉（df -g ≥10GB 预检）
        ┌───────────────┴───────────────┐
   B(helix投影·串行)              A1(pencil资产·并行)
   长 loop-Engineer                workflow
        │ HELIX_READY.log               │ 7 屏 export_html 100%复现
        └──────────► main ◄─────────────┘
                        │ 首个 HELIX_READY 解锁
                   A2(绑定+真Router tab+删shaping+改/补spec)
                   解锁批 workflow（codegen 并行·spec 串行）
                        │
            Conductor 动态 loop（reactor）全程统筹
```

**A 是 B 的下游**：UI 要渲染的「最后一条消息 / 加急 / 艾特」等字段，按 C013 必须 helix 吐 render-ready（B 的活），不在壳内 shaping。A1（纯 pencil 资产·零代码碰撞）可与 B 真并行；A2（碰 `src/app`）等对应行 `HELIX_READY` 再上。

---

## 3. 解锁状态机（每条台账渲染路径一条泳道）

```
⬛ PENDING        helix 吐瘦投影·台账 ❌/〜
   │ B: helix-im 补 render-ready + 三端四面 reducer 裁绿 + loopforge re-pin Cargo
   ▼
🟦 HELIX_READY    re-pin 已 merge 进 main（= 物理解锁 · 写 HELIX_READY.log）
   │ ← A2 对这一行的 stage gate
   ▼
🟨 BINDABLE       A2: HTML→组件 + [attr.data-*] 绑 render-ready + 真 Router route
   │ A2: 删本仓该 apply* shaping 段 + 改旧 spec(url 跳转) + 补新 spec
   ▼
🟩 BOUND_GREEN    禁区 grep 该行归零·覆盖率 +1·四面 reducer 裁绿（写 BOUND_GREEN.log）
```

A2 不等 B 全做完——某行进 `HELIX_READY` 即可抢绑。A2 绑到一半发现 helix 缺字段 → 写 `NEED_HELIX.log` 反向给 B（互相补齐双向边）。

---

## 4. 通信 = main 当总线 + 三单写者 append-only log（零 merge 冲突）

| log（`docs/migration/`） | 单写者 | 语义 | 方向 |
|---|---|---|---|
| `NEED_HELIX.log` | A2 | 绑定时发现 helix 没吐这个字段 | A2 → B |
| `HELIX_READY.log` | B | render-ready 投影已 merge 进 main | B → A2（解锁） |
| `BOUND_GREEN.log` | A2 | 该行已绑 + 四面绿 | 收口 |

**文件所有权切分（零交集 → 永不 merge 冲突）**：

| 路径 | B 写 | A2 写 |
|---|---|---|
| helix 仓 `helix-im/*`、`helix-driver-instrument/*` | ✅ | — |
| loopforge `Cargo.toml`/`Cargo.lock`（re-pin） | ✅ | — |
| loopforge `src/app/**`（删 shaping + 绑定 + tab） | — | ✅ |
| `test/specs/**`、`test/expect/**` | — | ✅ |
| `HELIX_READY.log` | ✅ | — |
| `NEED_HELIX.log` / `BOUND_GREEN.log` | — | ✅ |

**信号=真 merge**：`HELIX_READY` 这行只在 B 把 re-pin merge 进 main 之后追加 → A2 grep 命中时对应 helix 字段保证已在 main，`git merge main` 即编过。人读台账板 = `render-board.sh` 把三 log 聚成泳道表（台账本身不再被两边手改 → 不进黑名单冲突区）。

跨仓后端 gap（如老群 `channel_member` 缺行）→ 写 `worktrees/<wt>/NEED_CSES_IM_SERVER_FIX.md`，Conductor fork cses-im-server 协调 worktree 修，回写 `RESOLVED` 后切真接口（§6.5 跨项目契约协调）。

---

## 5. 编排器分工

| 谁 | 编排器 | 并行度 | 为什么 |
|---|---|---|---|
| **B** | 长 loop-Engineer（`helix-loop-engine` skill） | **串行** | 三端 debug 靠单一暖栈（一个 ng+app+一份 run.jsonl·warm-stack 铁律），N 行迁移**不能并行跑三端** |
| **A1** | workflow | **并行** | N 屏 pencil 设计·纯资产无栈·可 fan-out |
| **A2** | 解锁批 workflow | codegen 并行 / **spec 串行** | spec 共享暖栈（`harness.sh spec ~3s` 不重起 app）→ 验证串行 |
| **Conductor** | 动态 loop（ScheduleWakeup reactor） | — | 控制面：每 tick 读 3 log 算 runnable→派活→自动 merge(双闸)→状态窗。事件驱动(完成通知)+动态心跳兜底(270s 热 / 1200s+ 卡)，详见 `conductor.md` |

**merge 权**：Conductor 自动 merge，双闸——① 前置冲突分析 `git diff --name-only main..<branch>` 交集必须为空 ② 四面 reducer 裁绿。**唯一硬停** = `NEED_*_FIX.md` 跨仓 gap / reducer 红 → 停下挂状态板找人。

---

## 6. 启动序

```
P0a  校正数字          main·trivial
P0b  6 面 oracle 扩展   B(instrument 缝·test-only)·见 6-facet-oracle.md·先于迁移 loop
P0c  scaffold          docs/migration/{NEED_HELIX,HELIX_READY,BOUND_GREEN}.log 空骨架 + render-board.sh
──── 以上 main 上做完再分叉 ────
df -g 预检 ≥10GB → 开 worktree（项目内 worktrees/·已 .gitignore）
B   长 loop（helix 仓 worktree·串行·暖栈）→ 滚 HELIX_READY.log
A1  workflow（ui worktree·并行·pencil 7 屏 → export_html 100% 复现）
A2  解锁批 workflow（首个 HELIX_READY 后开）
Conductor 动态 loop 接管轮转
```

---

## 7. UC / tab 边界

- **tab 粒度 = 7 屏功能区**（① 3 栏主壳 ② 聊天主区 ③ 输入态 ④ 话题/回复链 ⑤ 成员管理 ⑥ 杂项卡片 ⑦ Teams/运维），用**真 Angular Router**（填 `routes=[]`）实现跳转 → URL-addressable 利于 wdio `url()` 定位。
- **UC 设计图边界 = 所有非 ⛔ UC**（含 2026-06-26 翻案的 5.6 公告 / 5.7 在线状态）分布进 7 屏。⛔ 不画：1.6 编辑、4.3 too_long、bot/agent。
- **全链路真 HTTP+WS 零 mock**：A2 翻译后一律接真链路（IPC→helix→cses-im-server）。

---

## 8. 两条北极星（验收）

- **第一**（`docs/uc-rollout/README.md`）：UC real-chain / 四面证据当前状态。
- **第二**（`docs/纯渲染壳-铁律与helix迁移台账.md`）：纯绑定覆盖率 → 100%（禁区 grep → 0 · 全 19 行 ✅）。
- 两者正交：UC 铺得多**且**壳越纯 → helix 投影越被证明 render-ready。掉任一即红灯。

---

## 9. 不在范围（Out of Scope）

- ⛔ 后端阻塞/已移除 UC：1.6 编辑、4.3 too_long、bot/agent（37 HTTP+1 WS 已移除）、5.6r/5.7 早先 blocked 分支中后端未起的部分。
- 像素/组件保真——本仓只追 data-* 语义锚点 + Discord 质感，不追 cses-client 级生产渲染。
- release/prod 路径——6 面 oracle、录放、webdriver 全 test-only，dev/release 零影响。
- L2 并发场景（双账号不变量）——L1 全绿后另起（`uc-rollout-l2`），不在本轮编排。
