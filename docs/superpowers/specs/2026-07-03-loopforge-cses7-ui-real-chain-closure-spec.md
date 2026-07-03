# LoopForge CSES7 UI + Real-Chain Closure SPEC

> 日期：2026-07-03
> 范围：`loopforge-tauri-im` 本仓；验证依赖 `helix` 与 `cses-im-server`
> 设计基线：`http://pd.cses7.com/message/pages/message/index.html`

## Goal

本轮目标不是重新定义所有 UC，而是把当前最新真实链路收稳，并启动 cses7 消息页风格统一与 MB 成员区细组件拆分：

```text
Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> helix projection/storage -> Angular DOM
```

所有路径禁止 mock、假 id、debug patch、前端乐观业务态。

## Hard Boundaries

- Apifox 必须通过安全环境变量读取 token：`APIFOX_TOKEN`。脚本、文档、日志、命令行示例不得写入真实 token。
- 本轮 Apifox 默认只跑 `go-only`，排除 Java 投票和平均分场景。投票、平均分只可作为明确排除项记录。
- UC-3.1、UC-6.2、UC-11.2 保留现有 spec 边界，不升级成四面全断言。
- UI 子组件只接 `@Input()` 并通过 `@Output()` emit，不注入 `ImStoreService`，不调用 Tauri，不做业务推导。
- 冻结 expect、projection schema、真机 curl 真源只读。绿灯只能来自实现修复或真实环境修复。

## UC Boundary Lock

| UC | 本轮 L1 断言 | L2 边界 |
|---|---|---|
| UC-3.1 会话已读 | ① 出站 `channels/view` 与当前 UI 触发链；单账号可观察的 `data-read-bits` 保持现有 expect 口径 | 多账号 read echo / unread 收敛由 `uc-3.1-l2.e2e.mjs` 证明 |
| UC-6.2 设/撤管理员 | ① 出站 `channel/add/manger` / remove manager；禁止出站成功后乐观写 `data-admin` | `data-admin` 必须来自后端/helix 成员投影，权威在 L2 |
| UC-11.2 退出公司 | ① `DELETE teams/member/quit {userId, teamId}` | 退出后的其它账号广播、频道移除、成员可见性由 L2 证明 |

## CSES7 Visual Baseline

已抓取页面 HTML/CSS 与截图：

- `/tmp/cses7-message.html`
- `/tmp/cses7-message-desktop.png`
- `/tmp/cses7-message-mobile.png`

从页面抽取的硬视觉口径：

- 顶栏/服务器栏为深色：`#2c2a3a`、`#413f50`。
- 主内容背景：`#F5F7FB`。
- 左侧会话列表宽度：`clamp(240px, 30vw, 330px)`。
- 会话项：白底，hover `#F1F3F6`，active `#E6E8ED`，置顶 `#F4F6F9`。
- 品牌主色：`#4857e2`。
- 强调绿：`#00baa0`。
- 头像：会话头像 40px、圆角 8px；成员/小头像保持 22-32px。
- 消息区：白色气泡，主区浅灰蓝背景，底部输入框固定且白底圆角。
- 成员入口在头部工具按钮，但 LoopForge 为测试保留 MB 成员区；MB 必须视觉上像右侧抽屉/面板，不变成业务 mock 区。

## UI/UX Split Target

MB 当前 `im-member-panel.component.ts` 需要拆成更细展示组件：

| Component | Responsibility |
|---|---|
| `ImMemberPanelComponent` | 容器壳，保留 `data-testid="member-list"`、`data-member-count`、`data-members` |
| `ImMemberPanelHeaderComponent` | 标题、加载成员按钮、成员数 |
| `ImMemberActionsComponent` | 成员 id 输入、拉人、踢人 |
| `ImMemberRowComponent` | 单个成员行、`data-member-id`、`data-admin`、昵称、管理员标识、行内操作 |
| `ImMemberEmptyComponent` | 空状态展示，不生成假成员 |

所有新组件必须保持纯展示，事件向上 emit，最终仍由 root component 调 store。

## Verification Gates

本轮完成标准：

- `node --check` 覆盖新增脚本。
- `npm run check:static`
- `npm run check:specs`
- `npm run check:real-chain`
- `bash scripts/gate.sh`
- `bash scripts/multi-end-loop.sh --area MB`
- `APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox`，且必须通过 `APIFOX_TOKEN` 环境变量注入 token。
- UI 截图至少保留桌面和移动证据；如果 gstack browse 仍因缺 `bun` 不可用，允许使用项目现有 Playwright/截图脚本作为替代证据。

Apifox 全绿只能报告为 HTTP preflight green，不得报告为 WS/DOM/业务全通过。
