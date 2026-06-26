export const meta = {
  name: 'ui-a1-design',
  description: 'A1 资产流水线：pencil 设计本仓 7 屏（所有非⛔ UC·含左侧最后一条消息/加急/艾特锚点）→ export_html 100% 复现 → 静态 HTML 校对。纯资产·不碰 src/app·与 B helix 迁移真并行无冲突。',
  phases: [
    { title: 'Design' },   // pencil 7 屏（含缺失锚点）
    { title: 'Export' },   // export_html --includeLayerNames 落 data-*
    { title: 'Verify' },   // 静态 HTML 逐节点核对 data-* 锚点齐全
  ],
}

// design/README.md 已定义 7 屏 → frame 映射 + data-* 锚点表。本 workflow 仅产静态资产。
const SCREENS = [
  { id: 'vqg8x', slug: '01-main-shell',  note: '3 栏主壳·CL 行补 lastMessage/urgent/mention 锚点' },
  { id: 'vqg8x', slug: '02-chat',        note: '聊天主区·msg 行 data-urgent/reactions/read-bits' },
  { id: 'vqg8x', slug: '03-composer',    note: '输入发送态·send-status uploading→sent' },
  { id: 'ARBMK', slug: '04-threads',     note: '话题/回复链·data-reply-id/highlighted' },
  { id: 'glSMj', slug: '05-members',     note: '成员管理·data-admin/nickname/member-count' },
  { id: 'bmtut', slug: '06-cards',       note: '杂项卡片·vote/average/bookmark/todo' },
  { id: 'dDwpV', slug: '07-teams-ops',   note: 'Teams/运维·data-channel-id/health' },
]

const DISCIPLINE = `
铁约束（design/README.md）：
- 每个承载锚点的节点把 data-* 编进 pencil 图层名 [data-...]；export_html --includeLayerNames 落成属性。
- 单次只导一屏、一屏一屏验，别整文档一次导出。
- 7 屏覆盖所有非⛔ UC（含翻案 5.6 公告 / 5.7 在线状态）；⛔ 不画：1.6 编辑 / 4.3 too_long / bot-agent。
- 用户点名补：左侧群聊列表「最后一条消息 + 加急 badge + 艾特标记」锚点（CL 行新增 data-last-message/data-urgent/data-mention）。
- Discord 深色质感·只追 data-* 语义锚点不追像素保真。
`

const SCREEN_RESULT = {
  type: 'object', additionalProperties: false,
  required: ['slug', 'exported', 'anchors_ok', 'note'],
  properties: {
    slug: { type: 'string' },
    exported: { type: 'boolean', description: 'export_html 是否产出 HTML' },
    anchors_ok: { type: 'boolean', description: '该屏所有应埋 data-* 锚点是否齐全' },
    missing_anchors: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

// 7 屏并行（纯资产·无栈·无依赖）：每屏 design→export→verify 一条 pipeline。
const results = await pipeline(
  SCREENS,
  (s) => agent(`${DISCIPLINE}\nPencil 设计/补全屏 ${s.slug}（frame ${s.id}）：${s.note}。\n用 pencil MCP 编辑 design/loopforge-im.pen 对应 frame，把所有 data-* 锚点编进图层名。返回设计是否完成。`,
    { label: `design:${s.slug}`, phase: 'Design' }),
  (_d, s) => agent(`${DISCIPLINE}\nexport_html({filePath:"design/loopforge-im.pen", nodeIds:["${s.id}"], format:"html-tailwind", includeLayerNames:true, includeLayerIds:true, outputPath:"design/export/${s.slug}.html"}) 导出屏 ${s.slug}。返回是否产出。`,
    { label: `export:${s.slug}`, phase: 'Export' }),
  (_e, s) => agent(`${DISCIPLINE}\n逐节点核对 design/export/${s.slug}.html：design/README.md「视图→UC→data-*」表里该屏应埋的每个 data-* 锚点是否都在导出 HTML 里。列出缺失锚点。`,
    { label: `verify:${s.slug}`, phase: 'Verify', schema: SCREEN_RESULT }),
)

return { screens: results.filter(Boolean) }
