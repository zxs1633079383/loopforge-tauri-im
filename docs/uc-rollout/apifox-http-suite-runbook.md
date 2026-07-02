# Apifox HTTP 回归套件 Runbook

> 本文件沉淀 `scripts/apifox-suite-create.py` 的使用约束、踩坑、修复流程。
> 目标：用 Apifox CLI 生成并运行 loopforge/cses-im-server 的 **HTTP 面**自动化集合，后续作为 WebdriverIO e2e 前置流程。
> Apifox 只做 HTTP preflight，不代表 WS / DOM / reducer / L1 / L2 通过。

---

## 0. 适用范围

本套件覆盖：

- Project：`8449651`
- Go IM server：`http://localhost:8066`
- Java 旧接口（vote/average）：`http://localhost:3399`
- 主账号：`cookieId=444`
- L2 第二账号：`cookieId_B=678`
- company/team：`64118eebd2b665246b7880eb`
- 场景规模：44 个场景，按 9 个阶段分组装入测试套件

边界：

- 只验证 **HTTP 面**：请求体、响应信封、关键数据链路、读回补偿。
- 不验证 WS 推送是否被客户端收到。WS 面由独立双账号 WS/e2e harness 承接。
- 不替代 WebdriverIO 四面 e2e。Apifox 是后端 HTTP 前置门禁和数据准备层。

---

## 1. 当前脚本

入口：

```bash
python3 scripts/apifox-suite-create.py
```

脚本职责：

1. 创建 Apifox 环境 `loopforge-im-local`
2. 写入环境变量：
   - `base_url=http://localhost:8066`
   - `base_url_java=http://localhost:3399`
   - `cookieId=444`
   - `cookieId_B=678`
   - `companyId=64118eebd2b665246b7880eb`
   - `groupChannelId` / `postId` / `schedulePostId` 等运行期变量
3. 创建测试套件 `loopforge-im-full`
4. 创建 44 个测试场景
5. 用 `test-scenario update --file` 写入自定义 HTTP 步骤
6. 用 `test-suite update --file` 一次性装配 9 个阶段组

不要使用 `test-suite update --add-scenario`。Apifox CLI 没有这个 flag；它会导致套件为空。

---

## 2. Token 规则

脚本创建/更新资源时可以使用 Apifox 桌面端 LevelDB 里的会话 token。

运行套件时必须使用 **Personal Access Token**：

```bash
export APIFOX_TOKEN=<Apifox API Access Token>
```

生成位置：

```text
Apifox 桌面端 → 头像 → 账号设置 → API 访问令牌 → 生成新令牌
```

会话 token 的典型失败：

```text
错误: 无效的访问令牌。
```

结论：LevelDB token 只能当 create/update 降级方案，`test-suite run` 必须用 PAT。
如果 `APIFOX_TOKEN` 缺失，Apifox HTTP 门禁就是 blocked / not-run，禁止补跑或假记为 green。

---

## 3. 生成套件

推荐：

```bash
cd /System/Volumes/Data/workspace/rust/loopforge-tauri-im

export APIFOX_TOKEN=<PAT>
export COMPANY_ID=64118eebd2b665246b7880eb
export TEAM_ID=64118eebd2b665246b7880eb
export COOKIE_ID=444
export MEMBER_B=678

python3 scripts/apifox-suite-create.py
```

`TEAM_ID` 默认等于 `COMPANY_ID`。本地可以不显式 export，但 CI/共享环境建议显式写清楚。

脚本完成后会输出：

```text
apifox test-suite run <suite_id> --project 8449651 --access-token $APIFOX_TOKEN --environment <env_id>
```

以上输出的一行命令是基础运行命令；`scripts/multi-end-loop.sh --apifox` 会追加 `--reporters cli,json --out-dir ... --out-file ...`，并且只有解析到 JSON 报告全绿才写 `apifox-status.json`。

---

## 4. 运行套件

示例：

```bash
apifox test-suite run <suite_id> \
  --project 8449651 \
  --access-token "$APIFOX_TOKEN" \
  --environment <env_id> \
  --reporters cli,json \
  --out-dir /tmp/loopforge/runs/<run-id>/apifox-reports \
  --out-file apifox-report
```

这一步只产出 HTTP preflight 证据，不代表 WS、DOM、reducer 或 L1/L2 green。

注意：

- `--environment` 接环境 ID，不是环境名。
- 当前 CLI 报告参数是 `--reporters cli,json`；不要再用旧的 `--report`。
- 多行命令的反斜杠后不能有空格；否则 zsh 会把下一行当新命令。
- 若用 `apifox run` 新语法，先用 `apifox run --help` 对齐当前 CLI 版本，不要凭旧文档猜参数。

---

## 5. Header 注入规则

不要把认证头写进 `parameters.header`，也不要用 `auth.apikey.value="{{cookieId}}"`。

已实测问题：

- `parameters.header` 的值在 Apifox UI/运行时表现不稳定。
- `auth.apikey.value` 会把 `{{cookieId}}` 原样发给后端，不做变量替换。

正确方式：每个 HTTP step 的 `preProcessors.customScript` 运行期注入：

```javascript
pm.request.headers.upsert({key: 'cookieId', value: pm.environment.get('cookieId') || '444'});
pm.request.headers.upsert({key: 'companyId', value: pm.environment.get('companyId') || '64118eebd2b665246b7880eb'});
```

L2 第二账号请求用 `cookieId_B`：

```javascript
pm.request.headers.upsert({key: 'cookieId', value: pm.environment.get('cookieId_B') || '678'});
```

---

## 6. 断言脚本规则

不要把断言放成独立 `script` step 后再读取 `pm.response`。

Apifox 独立 script step 中：

```javascript
pm.response === undefined
```

会报：

```text
Cannot read properties of undefined (reading 'json')
```

正确方式：`scripts/apifox-suite-create.py` 中的 `merge_script_steps()` 会把 `[customHttp, script]` 连续对合并为：

```text
customHttp.customHttpRequest.postProcessors[].customScript
```

此时 `pm.response.json()` 才能读取当前 HTTP 响应。

---

## 7. 响应信封与 data 断言

cses-im-server HTTP 响应信封：

```json
{
  "status": "SUCCESS",
  "data": {}
}
```

规则：

- 成功断言：`r.status === "SUCCESS"`
- 没有 `code` 字段，不要写 `code == 0`
- HTTP status 基本恒 200，业务成功看 `status`
- 对只返回 `{ "status": "SUCCESS" }` 的接口，不要强断 `r.data`
- 需要实体返回的接口，用 `pm.expect(r.data).to.exist`

踩坑：

```javascript
pm.expect(r.data).to.not.be.null
```

当 `r.data === undefined` 时会静默通过，是假绿。应使用：

```javascript
pm.expect(r.data).to.exist
```

---

## 8. 数据依赖顺序

套件按依赖序运行：

1. 阶段0 就绪探针
2. 阶段1 建频道
3. 阶段2 发消息
4. 阶段3 消息操作
5. 阶段4 历史浏览
6. 阶段5 频道管理
7. 阶段6 杂项
8. 阶段7 teams
9. L2 双账号

关键运行期变量：

| 变量 | 来源 | 用途 |
|---|---|---|
| `groupChannelId` | `channel/create` | 后续发消息、读、撤回、成员、频道管理 |
| `postId` | `posts/getLatestPost` read-back | 已读、撤回、加急、回复、公告等 |
| `topicChannelId` | `posts/makeTopic` | 话题相关验证 |
| `schedulePostId` | `posts/createSchedule` | cancelSchedule |
| `voteId` / `avgId` | Java vote/average | 8.x |

不得把后序 UC 提前运行。没有 channel 就不能发消息；没有 postId 就不能撤回/已读/加急。

---

## 9. WS 依赖写入的补偿

Apifox 场景不支持 WS step。对消息写入类接口，采用方向 A：

```text
HTTP write → delay(200~300ms) → HTTP read-back
```

例：

```text
posts/create → delay → posts/getLatestPost → 提取 postId
```

这只能证明后端 HTTP 写入已处理并可读回，不证明客户端 WS 已收到。WS 到 UI 的验证仍由 WebdriverIO e2e 负责。

---

## 10. 报告修复流程

用户给 HTML 报告后：

1. 先提取失败 UC、失败 step、返回数据长度、错误消息。
2. 分清三类：
   - body 缺字段 / 字段名错：修脚本 request body
   - 响应只返回 status：修断言，不要强断 data
   - 后端真实 bug：不要削弱断言，写 NEED 后端修复说明
3. 修完脚本后重新生成新 suite，不要手动改旧 suite。
4. 删除旧 suite，只保留最新 suite。
5. 用新 suite 的报告继续迭代。

常见修复记录：

| UC | 已踩坑 |
|---|---|
| UC-1.9 | `urgentPost` 必须带 `targetIds` |
| UC-1.10 | `getSchedule` 必须带 `userId`；`scheduleTime` 单位要按后端期望 |
| UC-5.2 | `makeTopic` 可能只返回 `{status}`，不要强断 `data` |
| UC-2.4 | 文本帖无回复线时 read-back 不能按有回复强断 |
| UC-6.2 | 被 UC-6.1 踢出的人不能再做 admin 操作 |

---

## 11. e2e 前置集成计划

后续接 WebdriverIO 前置流程时，建议拆两层：

```text
scripts/apifox-suite-create.py   # 生成/刷新 Apifox 项目资源
scripts/apifox-suite-run.sh      # 只运行指定 suite/env，输出报告路径
test/specs/*.e2e.mjs             # 真 Tauri + DOM 四面断言
```

CI/本地顺序：

```text
1. 确认 cses-im-server:8066 启动
2. 确认 cses-java:3399 启动（仅 8.x 需要）
3. 运行 Apifox HTTP suite
4. Apifox 全绿后再跑 WebdriverIO e2e
```

Apifox 失败时，不应继续 UI e2e。因为后端 HTTP 面已经不满足前置条件。
Apifox 即使成功，也仍然只是 HTTP preflight；它永远不能单独证明 L1/L2 绿色。

---

## 12. 下一阶段：UI/UX 拆分与 mjs 补全

本 runbook 完成后，下一步进入 UI/UX 拆分：

1. 按 `docs/spec/angular-ui-plan.md` 拆语义区：
   - channel-list
   - message-list
   - member-list
   - composer
   - aux-panel
2. 每个交互件必须有：
   - `data-testid`
   - 对应组件方法
   - 对应 Tauri invoke
   - 对应 DOM `data-*` 断言锚
3. 每个 UC 补齐对应 `test/specs/uc-X.e2e.mjs`
4. 每个 UC 补齐对应 `test/expect/uc-X.expect.json`
5. 严守 C013：UI 只绑定投影，不写业务解析/合并/归一逻辑。
