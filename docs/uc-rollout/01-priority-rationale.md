# UC 铺开顺序的理由（依赖链 + 风险 + 竖切机器复用度）

> 配套 `00-rollout-plan.md` §1 的有序台账。本文回答「**为什么是这个顺序**」。
> 三条排序轴：① 依赖链（谁出才能验谁）② 风险（认领难度 / 后端缺口）③ 复用竖切机器的程度（越复用越早）。

---

## 1. 三条排序轴

### 轴一：依赖链（上游不通，下游无法认领）

铺开不是任意挑 UC，存在硬依赖：

```
UC-1.1 发消息（竖切）
   │  装好整台机器：四面装饰器 / reducer / corr_key / golden-tape / 就绪 probe
   ▼
UC-3.1 已读 ── 需要先有「一条已上屏的消息」才能对它做已读 → 依赖 UC-1.1 的 message 行
UC-1.5 撤回 ── 同理，撤回的对象是已发出的消息 → 依赖 UC-1.1
UC-1.6 编辑 ── 编辑对象是已发出的消息 → 依赖 UC-1.1
   ▼
UC-2.x 历史读 ── 需要 channel 内已有 N 条消息才有「首屏 / 上拉 / 定位」可读 → 依赖发消息累积
   ▼
UC-4.1 hello 增量 ── 是「就绪 probe」的锚点（increment_channel_end 收齐是认领窗口开窗前提）；
                     域 B 全部 UC 的认领都依赖 increment 就绪，所以 UC-4.1 是域 B 第一块
   ▼
UC-4.2 sync notify / UC-4.3 too_long ── 依赖 cursor 状态机已被 UC-4.1 喂过种子（seed cursor）
   ▼
UC-5.x 频道管理 / UC-6.x 成员 ── 操作对象是已存在的 channel，依赖 UC-4.1/UC-5.1 先把 channel 建/拉进来
```

**结论**：依赖链天然把 `UC-1.1 → posts 收发/已读/历史 → UC-4.1 increment → channel/member 管理` 排成偏序。台账 §1 的 P# 即此偏序的拓扑序。

### 轴二：风险（认领难度递增 + 后端缺口靠后）

认领难度（`00-rollout-plan.md` 标 S/M/D）决定铺开成本：

- **S（最低风险）**：自发回流，单连接静默窗口即可认领（`temporaryId` ↔ echo `id` 领域键贯穿）。竖切 `UC-send-1` 就是 S。**S 类全部排前**（P1-9 多为 S）。
- **M（中风险）**：需 `increment_channel_end` 收齐 + HTTP inflight==0 + cursor 稳的就绪 probe 才能干净归属（domain B/C 多为 M）。**M 类排中**。
- **D（高风险 / 够不到）**：物理资源（文件上传）、后端真阻塞缺失（在线状态 P1-2 / 搜索 P2-1 空桩）、纯 Rust 自驱无 DOM（心跳）、跨账号广播（bot fanout P1-3）。**D 类排最后或标 untested**（`00-rollout-plan.md` §2）。

**后端缺口靠后铁律**：缺口矩阵 P1/P2 真阻塞（createUser / users-status / search 空桩 / bot Pulsar）对应的 UC**不能**红转绿——红转绿只能改 helix 实现，而这些是「后端根本没实现/外部依赖未接」，强转绿 = 改 oracle = 违自动修复护栏（PRD US-7）。所以它们标 untested，绝不排进绿台账。

### 轴三：竖切机器复用度（越复用越早，边际成本越低）

竖切 `UC-send-1` 搭好的机器（四面装饰器 / JSONL reducer / corr_key 规则 / golden-tape record-replay / 就绪 probe / WebdriverIO 接线）是**沉没成本**。铺开优先挑「**直接复用、零新增机器**」的 UC：

| 复用层级 | UC 特征 | 新增成本 | 举例 |
|---|---|---|---|
| **L0 零新增** | 同 outbound 形态（posts/create 家族）+ 同 message-row fat 投影 + 同 message 行 DOM | 仅写一份四面期望文件 | UC-1.2/1.4/1.6（发文档/重发/编辑都走 posts/create + emit_post_received/updated）|
| **L1 换工厂** | 不同投影工厂但同 message 行渲染 | 期望文件 + 1 个新 corr_key 子规则 | UC-1.5 撤回(`emit_post_deleted`)、UC-3.1 已读(`emit_post_read`)|
| **L2 换 facet 锚** | 透传类投影（query_result / read:result）或 channel-row thin | 期望文件 + reducer 加透传面解析 | UC-2.1 首屏(query_result)、UC-5.4 群属性(channel:update thin)|
| **L3 新认领窗口** | 需 increment 就绪 probe / 跨帧累计 | 期望文件 + 就绪 probe 接线 + thin 回读断言 | UC-4.1 increment、UC-5.x 频道管理 |

**结论**：L0/L1 排最前（P1-9），L2 排中（P10-17 + 域 B 透传），L3 排后（域 B/C 需就绪 probe）。

---

## 2. 三轴合成 → 台账 P# 顺序

三轴高度一致地指向同一偏序（依赖链 ≈ 风险 ≈ 复用度的递增方向），故台账 P# 直接采用合成序：

1. **P1-9（域 A 核心）**：S 风险 + L0/L1 复用 + 依赖链根部。先把「单连接自发回流窗口」吃透——这是整个 L1 认领策略的地基，吃透后所有 message-row UC 都是套模板。
2. **P10-17（域 A 扩展）**：M 风险 + L2 复用（透传 / 上拉 / 加急 / 定时）。引入透传面 reducer 解析 + 多轮编排（postContext）。
3. **P18-29（域 B）**：M 风险 + L3 复用（就绪 probe）。UC-4.1 是这一段的钥匙——increment 就绪 probe 接通后，sync / 频道管理 / 独立窗口兜底全部解锁。
4. **P30-36（域 C）**：M 风险 + 成员/读族透传。依赖域 B 的 channel 已建立。
5. **P37-39（域 D）**：互动卡片走 `emit_post_updated` fat（复用 message-row 机器），但走 `api`(AppHttpService) 非 imHttp，outbound 面 path 不同；系统通知靠 WS 帧触发。bot 域整体 untested。

---

## 3. 为什么前 5 个就是 §3 那 5 个

`00-rollout-plan.md §3` 推荐前 5 = UC-1.1 / UC-3.1 / UC-1.5 / UC-1.6 / UC-2.1，理由收敛：

- **全在域 A**（依赖链根部，无外部缺口风险）。
- **认领 S/M**（单连接窗口即可，不卡就绪 probe 接线——把 probe 留到 UC-4.1 一次性做对）。
- **复用度 L0-L2**（边际成本最低，每个只需一份四面期望文件 + 少量 reducer 子规则）。
- **覆盖四面四态**：
  - UC-1.1 验 message-row **fat** + tmp→server 覆写（①②③④ 全面）
  - UC-3.1 验 **read_bits** 单调覆盖（④ 落库不变量 + ② fat read 工厂）
  - UC-1.5 验 **在线/离线双路径**（② 双工厂 `batch_updated`/`deleted`）
  - UC-1.6 验 **fat 完整字段集证伪点**（projection-schema §2「少一字段即漂移」反转契约）
  - UC-2.1 验 **透传类**投影（query_result）+ **Scan** 读路径（④ 读不只写）
- **打通后**：四面四态（fat / thin / 透传 / 双路径 + 读写 cursor 不变量）全部验过一遍 → 后续 UC 都是这四态的组合，铺开变成「填台账」而非「探路」。

---

## 4. 收敛一句话

依赖链把顺序定成偏序，风险轴把后端缺口/物理够不到的 UC 推到 untested，复用度轴把零新增机器的 UC 拉到最前——三轴同向，故台账 P# 是唯一合理拓扑序：**先吃透单连接自发回流窗口（域 A 前 9），再一次做对 increment 就绪 probe（域 B 钥匙 UC-4.1），最后填成员/卡片/读族透传**。绿台账只收物理够得到 + 后端已实现的 UC；够不到的诚实记 untested，绝不靠改 oracle 凑绿。
