# LoopForge 全 UC UI/UX 交互补齐 Spec

Date: 2026-07-03

## 0. 结论

Apifox 测试套件通过只证明 HTTP 接口面可达；本 spec 的目标是把所有非排除 UC 补成可从 LoopForge UI 驱动的真实交互闭环：

```text
Angular UI -> ImStoreService -> Tauri invoke -> helix -> cses-im-server -> WS/HTTP -> helix projection/storage -> DOM
```

本轮排除项：

- bot / agent 领域
- `UC-8.x` 投票
- `UC-8.x` 平均分
- `UC-12.1` 健康探针作为基础设施 preflight，不作为 IM UI 业务闭环

Apifox 协作套件：

```text
https://app.apifox.com/link/project/8449651/api-test/suite-22236?branchId=8220219
```

本地 Apifox CLI 已确认存在：

```text
apifox 2.2.5
```

## 1. Definition of Done

每个非排除 UC 要满足对应等级：

| 等级 | 交付物 | 证据 |
|---|---|---|
| UI-linked | 用户有可见入口，点击/输入/切换会触发真实 store/Tauri 调用 | WDIO 能点击真实 DOM |
| Helix-linked | Tauri 命令进入 helix 或 debug-only L2 真实 HTTP path | `run.jsonl` outbound hop |
| Render-proven | 结果来自 helix projection/read result，而不是 Angular 乐观造状态 | DOM `data-*` + projection hop |
| Evidence-proven | 自动化结果可归档、可复跑、可定位 | WDIO spec + reducer/report archive |

不得使用：

- Angular catch 里合成业务成功/失败
- 随机 fake id
- debug patch 直接改 DOM/状态
- Apifox HTTP 绿冒充 WS/DOM/DB 绿

## 2. UI 区域规格

| 区域 | 责任 | 必须覆盖 UC |
|---|---|---|
| H 状态栏 | ready、当前用户、当前频道已读入口、debug 状态、右上角发送者账号切换 | UC-4.1、UC-3.1、L2 双账号 |
| SR 左侧服务器栏 | 视觉/空间导航，不承载业务真相 | 无独立 UC |
| CL 会话列表 | 群聊切换、最新消息、未读、@、加急、置顶、公告/团队标识 | UC-2.1、UC-3.1、UC-5.1、UC-5.2、UC-5.3、UC-5.4、UC-5.5、UC-11.1、UC-11.2 |
| ML 消息列表 | 消息气泡、发送状态、撤回、重发、转发、快捷回复、已读、模板、置顶、书签 | UC-1.x、UC-2.x、UC-3.2、UC-3.3、UC-5.5、UC-9.x |
| CP 输入区 | 文本、文档、图片/文件、加急、定时、取消定时、发送目标 | UC-1.1、UC-1.2、UC-1.3、UC-1.9、UC-1.10 |
| MB 成员区 | 成员列表、拉人/踢人、改昵称、管理员、在线状态、成员广播 | UC-5.7、UC-6.1、UC-6.2、UC-6.3、UC-6.4 |
| AX 辅助面板 | 待办、公告、书签、模块、频道查询、回复分支、系统通知 | UC-2.4、UC-5.6、UC-5.8、UC-9.x、UC-10.x |
| L2 调试面板 | 右上角可切换发送者账号：`444` 默认、`678` 可选；发送/@/加急/已读/成员动作都走当前选择账号 | UC-3.1、UC-3.2、UC-5.3b、UC-6.1b、UC-6.2b、UC-11.2 |

## 2.1 右上角双账号发送者切换

右上角必须提供一个 debug-only 发送者切换控件：

| 项 | 规格 |
|---|---|
| 默认值 | `444` |
| 可选值 | `444`、`678` |
| 视觉 | 右上角 segmented control 或两枚紧凑按钮，当前发送者高亮 |
| 状态文案 | 必须同时区分“观察窗口/当前会话”和“发送者”；例如 `视图 444 · 发送者 678` |
| 作用范围 | composer 发文本/文档、@、加急、已读、成员/管理员 L2 动作 |
| 真实链路 | 切到 `678` 后，请求 header/cookieId/userId 必须使用 `678`，不可只改 DOM 名称 |
| 主窗口 | 默认观察窗口仍可保持 `444`，用于验证 678 的动作是否能通过 WS/projection 回到 444 视图 |
| DOM 证据 | 顶栏暴露 `data-active-user-id="444"` 和 `data-sender-user-id="444|678"`；消息行暴露真实 sender id |
| 自动化 | WDIO 必须能选择 678，发送消息，断言出站 cookie/user 为 678，DOM sender 为 678，且 444 视图能收到 |

交互规则：

1. 初始打开应用时，发送者为 `444`。
2. 点击右上角 `678` 后，composer 后续发送都以 `678` 发起。
3. 再点击 `444` 后，composer 恢复以 `444` 发起。
4. 切换发送者不等于清空当前频道、重置历史、或重新登录主窗口。
5. 所有双账号动作必须真连 helix/cses-im-server；禁止只在 Angular 层替换显示名。

## 3. 全 UC 交互矩阵

### 阶段 0：启动与同步

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-4.1 hello 全量增量 | 应用启动后状态栏/会话列表自动 ready | helix hello/increment | `data-ready`、频道列表、首屏消息 | L1 ready probe，保持现有 WDIO |
| UC-4.2 sync notify | 状态栏/同步提示区域 | sync notify projection | 同步提示不遮挡主流程 | L1 self-driven |
| UC-4.4 heartbeat gap | 状态栏弱提示 | WS heartbeat/gap | 不弹业务假错误 | 自驱三面 |
| UC-4.5 陌生 channel | 切换/增量遇到未知频道 | fallback read/increment | 可恢复，不污染当前频道 | 读族 L1 |

### 阶段 1：频道创建与切换

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-5.1 创建群聊 | CL 顶部 `+群` | channel/create type=P | 新群出现在 CL，可切换 | L1 已有，需 UI 重跑 |
| UC-5.2 创建话题 | CL/频道工具区创建 topic | channel/create topic | topic 出现在 CL，首屏可发消息 | L1 已有 |
| UC-2.1 切群首屏 | 点击 CL 群聊行 | query messages + channels/view | ML 首屏换到目标群；composer 对应当前群 | L1 读族 |

### 阶段 2：发送族

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-1.1 发文本 | CP 输入 + 发送 | posts/create | ML 新行 pending/sent；CL 最新消息刷新 | L1 已绿，需回归 |
| UC-1.2 发文档 | CP 文档按钮 | posts/create type=DOC | 文档消息行、文件名/类型可见 | L1 已绿，需回归 |
| UC-1.3 图片/文件 | CP 上传入口 | upload + posts/create | 上传进度/失败/完成状态 | night-only，依赖上传管线 |
| UC-1.8 快捷回复 | ML 行内快捷回复 | posts/create reply props | 回复关系/快捷文案可见 | L1 已绿，需回归 |
| UC-1.9 加急/确认 | CP/ML 加急按钮 | urgent send/confirm | 消息加急 badge；CL 加急提示；确认状态 | L1 已绿，需回归 |
| UC-1.10 定时/取消 | CP 定时按钮/取消按钮 | schedule/cancel | 定时态、取消态、最终发送态 | L1 已绿，但按钮链重点复核 |

### 阶段 3：消息操作与已读

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-1.4 失败重发 | 失败消息行 `resend-btn` | failed projection -> resend same tmp id | failed -> sending -> sent，同一 temporaryId | P0，当前已开始修 UC spec，需 live 归档 |
| UC-1.5 撤回 | ML 行内撤回按钮 | post revoke | 行变撤回态 | L1 已绿 |
| UC-1.7 转发 | ML 行内转发 + 目标频道选择 | forward real target | 目标频道出现转发消息 | L1 多频道已绿 |
| UC-2.2 更早历史 | ML 上拉/加载更多 | load older | 老消息插入，不跳当前视口 | L1 已绿 |
| UC-2.3 定位 postId | 搜索/定位入口 | locate by postId | 滚动定位并高亮目标行 | L1，禁止 debugLocatePost |
| UC-2.4 回复/分支 | AX 回复分支面板 | query replies/branch | AX 列出回复链 | 读族 L1 |
| UC-3.1 会话已读 | 切群、composer focus、H 已读按钮 | channels/view | 当前群 unread 清零；CL badge 更新 | L2 必证 444/678 收敛 |
| UC-3.2 单条已读 | ML 行内已读按钮 | post read/mark | 行 read bits 更新 | L2 必证 |
| UC-3.3 模板已收到 | ML 行内收到/模板按钮 | template received | 行显示已收到/模板状态 | L1 已绿 |

### 阶段 4：频道属性、公告、在线

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-5.3 关闭/退出群 | CL/MB 群设置退出/关闭 | quit/close channel | CL 移除或标记关闭 | L1 已绿；广播走 L2 |
| UC-5.3b leave 广播 | L2 面板用 678 观察 | member leave WS/projection | 观察端成员/频道变化 | P0，需 projection+DOM 归档 |
| UC-5.4 群属性修改 | CL/MB 群设置表单 | update channel props/name | CL 名称/属性刷新 | L1 需重跑 |
| UC-5.5 置顶 | CL 置顶、ML 消息置顶 | channel top / post pin | CL 置顶排序；消息 pin badge/列表 | channel top L1；post pin 需分项证据 |
| UC-5.6r 公告读 | AX 公告列表/详情 | announcement list/detail | 公告列表和详情真实渲染 | P1，需补 read-result render |
| UC-5.6w 公告写 | AX 新建/删除公告 | announcement save/delete | 公告回显/删除从后端 echo 来 | P0/partial，需重验 backend echo |
| UC-5.7 在线状态 | MB 在线状态块 | channel onlineStatus | 在线人数/成员在线态 | P1，需补 response render |
| UC-5.8 条件查频道 | AX 频道查询 | channel query | 结果列表与 CL 当前列表分离 | P1，需补 query result surface |

### 阶段 5：成员与权限

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-6.1 拉/踢人 | MB 拉人/踢人 | channel member add/remove | 成员列表变化 | L1 已绿；L2 广播需新证据 |
| UC-6.1b 拉人广播 | L2 678 观察 | channel_member_update | 观察端看到成员变化 | P0，需 projection+DOM 归档 |
| UC-6.2 设/撤管理员 | MB 管理员按钮 | add/remove manager | `data-admin` 只能来自 projection | L1 只验出站；L2 权威 |
| UC-6.2b 管理员广播 | L2 678 观察 | admin/member projection | 观察端 `data-admin` 更新 | P0，禁止 UI 乐观刷 |
| UC-6.3 改群昵称 | MB 成员昵称输入 | member nickname | 成员行昵称刷新 | L1 需重跑 |
| UC-6.4 成员快照/全量 | MB 成员列表刷新 | member snapshot/full | 成员列表完整、数量可见 | L1 需重跑 |

### 阶段 6：辅助业务

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-9.x 书签 | ML 书签按钮 + AX 书签列表 | bookmark create/delete/load | 行 bookmark badge；AX 列表有真实 rows | P1，需补 `_bookmarks` read render |
| UC-10.1 待办 | AX 待办面板 | posts/queryTodoList | 待办列表来自 projection/read result | P0，需修 UC window attribution |
| UC-10.2 系统通知 | AX/状态栏通知入口 | notification/system | 通知列表/状态可见 | L1 |
| UC-10.3 模块读 | AX 模块入口 | modules/getAll | 模块列表真实渲染 | P1，需补 response render |

### 阶段 7：团队/公司与 L2

| UC | UI/UX 入口 | 真实动作 | UI 状态 | 自动化 |
|---|---|---|---|---|
| UC-11.1 维护公司大群 | CL/团队入口 | company/team channel maintain | 公司群标识、列表可见 | L1 |
| UC-11.2 退出公司 | MB/团队设置退出 | teams/member/quit | 当前/观察端频道和成员状态收敛 | P0，L2 projection+DOM 归档 |
| L2 双账号调试 | 右上角 444/678 发送者切换 | 当前选择账号 real HTTP send/read/urgent/mention | 默认 444；切 678 后发送者、请求身份、消息 sender 都是 678；444 视图可观察 678 影响 | 必须覆盖 send、read、mention、urgent、member/admin |

## 4. P0/P1 补齐清单

### P0：先补证据完整性

1. UC-1.4：真实失败投影 + 同 temporaryId 重发完整 live 归档。
2. UC-10.1：修正 `__quiescence__` 归属，待办动作必须落在 UC window。
3. UC-3.1/UC-3.2：L2 已读证据归档，包含 projection + DOM，不只 raw WS。
4. 右上角发送者账号切换：默认 444，可切 678；composer 与 L2 动作使用当前发送者真实身份。
5. UC-5.3b/UC-6.1b/UC-6.2b/UC-11.2：L2 广播证据归档，观察端必须有 DOM 状态。
6. UC-5.6w：公告写回显必须来自真实后端/helix，不可 UI 造公告成功。

### P1：补 read-result UI surface

1. AX 书签列表：`im_bookmark_load` -> `_bookmarks` -> `data-bookmark-id` rows。
2. AX 公告列表/详情：announcement list/detail -> `data-announcement-id` rows/detail。
3. MB 在线状态：onlineStatus response -> `data-online-count` / `data-member-online`。
4. AX 模块列表：modules/getAll -> `data-module-id` rows。
5. AX 频道查询：channel query -> 独立 `data-query-channel-id` result rows。

## 5. 测试门禁

每批实现后至少跑：

```bash
npm run check:static
bash scripts/multi-end-loop.sh --area CL
bash scripts/multi-end-loop.sh --area ML
bash scripts/multi-end-loop.sh --area CP
bash scripts/multi-end-loop.sh --area MB
bash scripts/multi-end-loop.sh --area AX
```

全量收口时跑：

```bash
bash scripts/multi-end-loop.sh --all
APIFOX_PROFILE=go-only bash scripts/multi-end-loop.sh --apifox
```

Apifox 相关约束：

- token 只能来自 `APIFOX_TOKEN`
- project 使用 `8449651`
- cookie/user 使用 `444` / `678`
- companyId/teamId 使用 `64118eebd2b665246b7880eb`
- 报告只能证明 HTTP，不证明 UI/WS/DB

## 6. 实施边界

- LoopForge 前端是纯渲染壳：允许绑定、发命令、显示 projection/read result；不允许业务推导。
- helix 改动必须走 `/System/Volumes/Data/workspace/rust/helix/worktrees/...`。
- cses-im-server 改动必须走 `/System/Volumes/Data/workspace/golang/cses-im-server/worktrees/...`。
- 如 UI 需要的新字段 helix 没吐，先写 NEED_HELIX，不在 Angular 里补业务逻辑。
- 如后端缺 echo/WS 广播，先写 NEED_CSES_IM_SERVER，不在 UI 层冒充。
