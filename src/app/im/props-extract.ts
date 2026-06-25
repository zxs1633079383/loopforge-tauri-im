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
