// 投影 props 抽取纯函数 —— 从 fat message_item_data 的 props 字段抽 data-* 渲染源。
//
// 壳纯渲染铁律（CLAUDE §1）：data-* 直映投影字段，不在 JS 合成。这些是**纯函数**
// （props 形态容错：对象/字符串·解析失败静默回 null/false），从 im-store.service 提出独立
// 维护（高内聚·低耦合·store 体积控制 <800 行 gate）。

/**
 * 从 fat 投影 props 抽快捷回复 emoji 串（UC-1.8·data-reactions 渲染源）。
 *
 * server post_update echo 把 quickReply 携进 post props（`props.quickReply`）：形态
 * `[{emoji, userIds:[...]}]`（Go 组装）。把命中的 emoji 聚成串（如 "👍"·多 emoji 逗号连）。
 * 无 quickReply → 返 null（不覆写既有 reactions）。props 形态容错·解析失败静默回 null。
 */
export function extractReactions(props: unknown): string | null {
  const obj = parseProps(props);
  if (!obj) return null;
  const qr = (obj as Record<string, unknown>)["quickReply"];
  if (!Array.isArray(qr) || qr.length === 0) return null;
  const emojis = qr
    .map((e) =>
      e && typeof e === "object"
        ? (e as Record<string, unknown>)["emoji"]
        : undefined,
    )
    .filter((e): e is string => typeof e === "string" && !!e);
  return emojis.length > 0 ? emojis.join(",") : null;
}

/**
 * 从 fat 投影 props 抽模板已收到态（UC-3.3·data-template-received 渲染源）。
 *
 * server templateReceived 回执后 `post_update` echo 把已收到回执列表携进 post props
 * （`props.template.userIds:[...]`·真源 01-接口可达性清单.md:201 `posts(props.template.userIds)`）。
 * props.template.userIds 为非空数组（含 self 等已确认收到的用户）→ 返 true（data-template-received=1）。
 * 无 template / userIds 空 → 返 false（不置位·不抹既有态）。props 形态容错·解析失败静默回 false。
 */
export function extractTemplateReceived(props: unknown): boolean {
  const obj = parseProps(props);
  if (!obj) return false;
  const tpl = (obj as Record<string, unknown>)["template"];
  if (!tpl || typeof tpl !== "object") return false;
  const userIds = (tpl as Record<string, unknown>)["userIds"];
  return Array.isArray(userIds) && userIds.length > 0;
}

/**
 * 系统/通知消息类型集（UC-10.2·data-system-notice 渲染源·权威真源冻结）。
 *
 * 真源 = helix full-map partials/7--client-ui-rendering.md §3：现网前端 chat-content 模板按
 * `NOTICE_TYPES.includes(item.type)` 二分发——命中 → `<message-system>`（系统/分隔条·走
 * generateMessage 文案合成）·否则 → `<message-item>`（气泡）。本壳以 data-system-notice='1'
 * 等价标注「该行走系统消息渲染」。
 *
 * NOTICE_TYPES（enum.ts·verbatim）= [TIME, NOTICE, MEETING_NOTICE, SYSTEM_KR_EDIT,
 * SYSTEM_KR_STATE_EDIT, SYSTEM_KR_VOTE, SYSTEM_KR_PUBLISH, SYSTEM_MONTH_ORIENT_SHARE]。
 *
 * 注（C004 契约纠偏·issue #37）：issue/ledger 草拟锚写「type=SYSTEM/SYSTEN」是 Phase1 简化——
 * 实际现网系统通知（如改群名 channelUpdate post）wire `type=NOTICE`·`userId=SYS`（UC-5.4 真机
 * 实证 run.jsonl seq19/514）·走 NOTICE_TYPES 分发。`SYSTEM` 枚举值本身拼写 `SYSTEN`（partial7 §4.2·
 * 命名陷阱保真透传）·一并纳入兼容（现网 message-system 不直接分发它·但保真容错·两种拼写都判）。
 */
const NOTICE_TYPES = new Set([
  "TIME",
  "NOTICE",
  "MEETING_NOTICE",
  "SYSTEM_KR_EDIT",
  "SYSTEM_KR_STATE_EDIT",
  "SYSTEM_KR_VOTE",
  "SYSTEM_KR_PUBLISH",
  "SYSTEM_MONTH_ORIENT_SHARE",
  // SYSTEM 枚举值拼写陷阱保真（partial7 §4.2 `SYSTEM: 'SYSTEN'`）·两种拼写都判系统消息。
  "SYSTEM",
  "SYSTEN",
]);

/**
 * 判定消息类型是否系统通知行（UC-10.2·data-system-notice 渲染源）。
 *
 * 严格匹配 NOTICE_TYPES（大写归一）→ 走系统消息渲染（data-system-notice='1'）。
 * 普通消息类型（TEXT/DOCUMENT/IMAGE/TEMPLATE/VOTE…）→ 返 false（不渲染该属性·守可证伪）。
 */
export function isSystemNotice(type: unknown): boolean {
  if (typeof type !== "string") return false;
  return NOTICE_TYPES.has(type.toUpperCase());
}

/** props 形态容错归一：对象原样·字符串 JSON.parse·非对象/解析失败 → null。 */
function parseProps(props: unknown): Record<string, unknown> | null {
  if (props == null) return null;
  let obj: unknown = props;
  if (typeof props === "string") {
    if (!props.trim()) return null;
    try {
      obj = JSON.parse(props);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;
  return obj as Record<string, unknown>;
}
