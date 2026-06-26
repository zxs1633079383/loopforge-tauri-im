// 读族回灌 body 抽取纯函数（UC-2.4·im:read:result 透传 body → data-reply-id 渲染源）。
//
// 壳纯渲染铁律（CLAUDE §1）：data-* 直映投影字段·不在 JS 合成业务。读族 body 由后端权威透传
// （projection-schema §1.2·inner 不冻结），壳只从中防御性抽 Post.id 作 reply chip。从
// im-store.service 提出独立维护（高内聚·低耦合·store 体积控制 <800 行 gate·参照 props-extract.ts）。

/**
 * 从读族透传 body 防御性抽 Post id 列表（壳纯渲染·不解析重组业务字段）。
 *
 * 探针顺序兼容两 endpoint 不同壳形态：
 *  - getReplies：`{rootPost, replies:[Post]}`（partial 1 §15 GetRepliesResp）
 *  - getReplyBranch：HasMorePage[Post]（`{data:[Post]}` / `{list:[Post]}` / 顶层 `[Post]`）
 * 取 rootPost.id + replies[].id + data[].id + list[].id + 顶层数组[].id。去重保序·仅非空 string。
 * 失败回灌（{req_id, error}）的 body 缺/非对象 → 返空数组（前端 reject 语义·清抽屉）。
 */
export function extractReplyIds(body: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const id =
      v && typeof v === "object"
        ? (v as Record<string, unknown>)["id"]
        : undefined;
    if (typeof id === "string" && id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  };
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    push(b["rootPost"]);
    for (const k of ["replies", "data", "list"]) {
      const arr = b[k];
      if (Array.isArray(arr)) for (const el of arr) push(el);
    }
  } else if (Array.isArray(body)) {
    for (const el of body) push(el);
  }
  return out;
}
