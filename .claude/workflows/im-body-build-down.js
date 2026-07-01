export const meta = {
  name: 'im-body-build-down',
  description: '把 5 个建群/成员命令的出站 HTTP wire body 构造从 loopforge 壳下沉到 helix-im(壳回归纯 args 透传)。helix worktree(off main)定契约·loopforge 壳跟进 re-pin·重跑 29 warm spec 验回归。机械搬运·不改冻结契约。',
  phases: [
    { title: 'Design-map' },
    { title: 'Helix-impl' },
    { title: 'Loopforge-thin' },
    { title: 'Re-validate' },
    { title: 'Finalize' },
  ],
}

const HELIX_WT = '/System/Volumes/Data/workspace/rust/helix/worktrees/im-body-build'
const LOOPFORGE = '/Users/mac28/workspace/rustWorkspace/loopforge-tauri-im'

const STEP_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['phase', 'status', 'note'],
  properties: {
    phase: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'blocked'] },
    files_changed: { type: 'array', items: { type: 'string' } },
    commands_done: { type: 'array', items: { type: 'string' } },
    regression: { type: 'string', description: '回归验证结果(29 warm spec 绿数/红清单)' },
    note: { type: 'string' },
  },
}

const CONTEXT = `
# 任务背景：纯薄壳合规修复——5 命令出站 wire body 下沉 helix-im
架构审计(docs/architecture-review/pure-ui-audit-2026-06-26.md)裁定 PARTIAL：核心边界守住(helix 零改/壳无落库对账cursor/前端纯渲染)，但 **5 个建群/成员命令在 loopforge 壳内构造完整出站 HTTP wire body + role 业务赋值**，根因=helix-im 对应 command 降级为 args 直透把 body 成形责任推给壳。修=把 body 构造**下沉 helix-im**，壳回归纯 args 透传。

## 5 个命令(loopforge 壳现状·audit file:line)
1. im_create_channel (UC-5.1)·commands.rs:716-766·拼 channel/create body{teamId,displayName,orient,type:P,users[{id,role:CREATOR/MEMBER}],picturetype,picture,forceCreate}
2. im_make_topic (UC-5.2)·commands.rs:820-830·拼 posts/makeTopic body{rootId,teamId,postId,type:T,...,users[role]}
3. im_team_upsert (UC-11.1)·commands.rs:891-901·拼 CreateChannelSpecifyOwner team 对象+owner CREATOR
4. im_channel_member_change (UC-6.1)·commands.rs:1099-1142·拼 channel/member/change body{channelId,joinUsers[{id,teamId,role:MEMBER}],leaveUsers}
5. im_channel_set_manger (UC-6.2)·commands.rs:1168-1209·拼 channel/add|remove/manger body{users[{id,name,role,teamId}]}+role=set?ADMIN:MEMBER+endpoint 路由

## 仓与分支
- **helix worktree**(改 helix-im)：${HELIX_WT}·branch fix/im-wire-body-build·off main(ee9fa8b)。**只在此 worktree 改 helix·绝不动 helix 主 checkout / 其他 worktree**。
- **loopforge**(改壳)：${LOOPFORGE}·branch feat/uc-rollout·**就地改**(复用暖栈 + target 验回归)。

## 铁律(机械搬运·零契约漂移)
- **wire body 字节一致**：helix-im build 出的 body 必须和壳现在拼的**完全一致**(对齐冻结真源 crates/helix-im/docs/csesapi-migration/真机curl真源.md + projection-schema.md)。这是**重构搬运·不改契约**——同样的 body·只是从壳挪进 helix-im handler。
- **不改冻结 oracle**：loopforge test/expect/*.expect.json / helix 真机curl真源 / projection-schema 一律不动。① 出站面期望不变(URL+body-shape 没变·只是构造方挪了)。
- **role 业务赋值(CREATOR/MEMBER/ADMIN)+ endpoint 路由**一并下沉 helix-im(这些是业务·属 helix)。壳只传结构化 args(userId 列表/displayName/set 标志等)。
- AppCommand 加结构化字段(承载壳传的 args)·壳填这些字段入泵·helix-im handler 读字段 build body。
- 暖栈复用：loopforge 验证用 \`bash scripts/harness.sh up\`(现成 444)·改 Rust 后 \`reload-app\`·\`spec <uc>\`。
- 绝不 merge main / 不 push。commit 前各仓 gate(helix: cargo check/test·loopforge: gate.sh)。
- 磁盘紧(~12-19G)·build 前 df -g·逼近 5G 告警停。
`

phase('Design-map')
const design = await agent(`${CONTEXT}

## 本任务：phase0 设计——映射 5 命令的 helix-im 落点
在 helix worktree(${HELIX_WT})里定位(main ee9fa8b 结构·注意 main 已做 to_effect/module 拆分·结构可能异于 round6)：
1. 5 个命令对应的 **AppCommand 变体**(enum 定义在哪 crate/文件)·现在是不是 args 直透。
2. 对应的 **command handler / outbound 工厂**(helix-im 里 build 出站 wire 的地方·to_effect/outbound/registry)。
3. 这 5 个出站 endpoint(channel/create·posts/makeTopic·channel/member/change·channel/add|remove/manger·CreateChannelSpecifyOwner)在 helix-im 现状：handler 是直接转发壳给的 body·还是有半成形?
4. loopforge AppCommand 入泵处(壳怎么把命令送进 helix)。
输出每个命令的「下沉方案」：AppCommand 加哪些字段·handler 在哪 build body·壳改哪几行。**只读调研·先不改代码**。返回 STEP_RESULT(note 写 5 命令落点 + 下沉方案)。`,
  { label: 'design', phase: 'Design-map', schema: STEP_RESULT, effort: 'high' })

phase('Helix-impl')
const helixImpl = await agent(`${CONTEXT}

## phase1：helix-im 实现 body 下沉(在 worktree ${HELIX_WT})
依据 phase0 方案(${design && design.note})：
1. cd ${HELIX_WT}。AppCommand 加结构化字段(承载壳 args)·5 个 handler 内部 build 出站 wire body(从 loopforge commands.rs 现有构造**逐字搬运**·含 role 赋值/endpoint 路由)。
2. 对齐冻结真源(真机curl真源.md)·body 字节一致。
3. \`cargo check -p helix-im\`(+ 相关 crate)绿·跑 helix 自带 e2e 若有(host-cli FULL uc e2e 不强求·至少 cargo test -p helix-im 编过)。
4. commit 到 fix/im-wire-body-build(conventional 中文·绝不 merge main / 不 push)。**只改本 worktree 的 helix·绝不碰 helix 主 checkout**。
返回 STEP_RESULT(commands_done + files_changed + cargo check 状态)。`,
  { label: 'helix-impl', phase: 'Helix-impl', schema: STEP_RESULT, effort: 'high' })

phase('Loopforge-thin')
const thin = await agent(`${CONTEXT}

## phase2：loopforge 壳变薄 + repoint helix dep(${LOOPFORGE})
1. src-tauri/Cargo.toml 把 helix 依赖 **临时指向 worktree path dep**(${HELIX_WT}/crates/*·dev 期)·或 git branch=fix/im-wire-body-build。
2. commands.rs 5 个命令**删 body 构造·改填 AppCommand 结构化字段入泵**(role/endpoint 决策已下沉 helix·壳只传 userId 列表/displayName/set 标志等结构化 args)。守 src-tauri 薄壳纪律(只翻译入参+入泵)。
3. \`cargo check -p loopforge-tauri-im\` 绿(默认 + --no-default-features)。
4. **先不 commit**(留给 phase3 验回归后一起)。返回 STEP_RESULT(files_changed + cargo check)。`,
  { label: 'loopforge-thin', phase: 'Loopforge-thin', schema: STEP_RESULT, effort: 'high' })

phase('Re-validate')
const validate = await agent(`${CONTEXT}

## phase3：暖栈重跑验回归(${LOOPFORGE})——尤其防 +31 commit helix bump 破已绿
1. \`bash scripts/harness.sh up\`(暖栈 444·已健康则复用)·改了 Rust → \`bash scripts/harness.sh reload-app\`(重编 loopforge against 新 helix·磁盘 df -g 预检)。
2. **先验 5 个改的 UC**：\`harness.sh spec 5.1\` / 5.2 / 6.1 / 6.2 / 11.1 —— 四面必须仍全绿(① 出站 body 没变·只是构造方挪了)。
3. **再验回归面**：抽跑代表性已绿 UC(send-1 / 1.9 / 3.3 / 2.1 等)确认 +31 commit helix bump 没破投影/落库面。红→四段日志定位(helix bump 引入的行为变化·在 helix worktree 修)→复跑。
4. 全绿 → loopforge Cargo.lock **re-pin 到 fix/im-wire-body-build 的 commit**(git branch ref + lock pin·别留 path dep)。返回 STEP_RESULT(regression 写 N/29 绿 + 红清单)。`,
  { label: 're-validate', phase: 'Re-validate', schema: STEP_RESULT, effort: 'high' })

phase('Finalize')
const fin = await agent(`${CONTEXT}

## phase4：收尾
1. 两仓各 commit(helix worktree fix/im-wire-body-build + loopforge feat/uc-rollout·conventional 中文结构化 body·绝不 merge / 不 push)。loopforge gate.sh 须绿。
2. 更新 docs/architecture-review/pure-ui-audit-2026-06-26.md：5 命令 wire body 已下沉 helix-im·壳薄壳合规(剩 frontend setManger 随 L2·badge/failed 低优)。
3. 写终态行 docs/harness/log.md。
返回 STEP_RESULT(status·note 写：5 命令下沉完成情况 + 回归 N/29 + 两仓 commit hash + 剩余项)。`,
  { label: 'finalize', phase: 'Finalize', schema: STEP_RESULT, effort: 'high' })

return {
  design: design && design.status,
  helix: helixImpl && helixImpl.status,
  thin: thin && thin.status,
  validate: validate && validate.regression,
  final: fin,
  steps: [design, helixImpl, thin, validate, fin].filter(Boolean).map(s => ({ phase: s.phase, status: s.status, note: s.note })),
}
