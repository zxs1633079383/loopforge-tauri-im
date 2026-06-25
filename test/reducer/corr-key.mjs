// corr_key 领域规则 —— 把一条 hop payload 抽成领域键，reducer 用它把四面聚成一束。
//
// 与 Rust 侧 `crates/helix-driver-instrument/src/event.rs::extract_corr_key` 对齐（同一抽键语义），
// 但 reducer 侧规则更强：① 显式四维 `ch/tmp/sid/seq`（spec §2 corr_key 形态）；
// ② 跨四面键名差异归一（outbound body camelCase / projection data snake+camel 混 / storage 无键）；
// ③ DOM 面键来自 e2e 注入（data-* 直读），见 reducer 的 domFacet。
//
// 领域映射（spec §2 / four-facet-oracle）：
//   ch  = channelId   (channel_id / channelID)
//   tmp = temporaryId (temporary_id)
//   sid = serverId    (id / postId / post_id / serverId / server_id / msg_id)
//         msg_id 是投影 envelope（im:post:received/updated）携 server post id 的键——加入 sid 别名
//         使「投影(msg_id) ↔ 出站(postId) ↔ 落库(id)」三面经 sid 聚同束（UC-1.9 加急 post_update
//         投影用 msg_id 非 id；不加则投影只抽 tmp/ch/seq·与 sid 锚的出站/落库不并束 → ④ 永红）。
//         tmp 仍是 send 主事件首选锚（sameEvent tmp 优先），msg_id 入 sid 为附加锚·不破坏 tmp 聚束。
//   seq = eventSeq    (event_seq / seq)
//
// ⚠️ 只读语义：本文件是 oracle 的领域规则，属契约族；改抽键规则 = 改对账口径，
//    须与 spec §2 + 装饰器 extract_corr_key 同步（contract-readonly-autofix.md）。

/** 四个领域维度（固定顺序，决定 corr_key 串形态）。 */
export const DIMS = /** @type {const} */ (['ch', 'tmp', 'sid', 'seq']);

/** 每个维度可能出现的别名键（跨四面归一）。 */
const ALIASES = {
  ch: ['channelId', 'channel_id', 'channelID'],
  tmp: ['temporaryId', 'temporary_id'],
  sid: ['id', 'postId', 'post_id', 'serverId', 'server_id', 'msg_id'],
  seq: ['eventSeq', 'event_seq', 'seq'],
};

/** 从一个普通对象按别名表取第一个命中（string/number → string）。 */
function pickFrom(obj, keys) {
  if (obj == null || typeof obj !== 'object') return undefined;
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/**
 * 从任意 payload 抽四维（顶层 + `.data` + `.body` 三处探），返回 `{ch?,tmp?,sid?,seq?}`。
 * `sid` 的空串特殊处理：outbound send body 的 `id:""` 不算 server_id（发送时 server 未分配）。
 */
export function extractDims(payload) {
  // 表感知归一（UC-4.1 ④ storage channel 落库）：channel 表主键 `id` == channelId（非 server
  // post id）→ 必抽成 ch 而非 sid，使 ④ 与 ② im:channel:increment（ch 锚）同束。
  // 判据：payload.table === 'channel' 且无独立 channel_id（落库 payload {id,op,table,rows} 形态）。
  // 不影响 post echo（{channel_id,id} → id 仍 sid）与 message 落库（table=message → id 仍 sid）。
  if (
    payload &&
    typeof payload === 'object' &&
    payload.table === 'channel' &&
    typeof payload.id === 'string' &&
    payload.id.length > 0 &&
    payload.channel_id === undefined &&
    payload.channelId === undefined
  ) {
    return { ch: payload.id };
  }
  const probes = [
    payload,
    payload?.data,
    payload?.body,
    payload?.body?.data,
    // 批量信封（im:post:batch-updated `data.posts:[{id,...}]`）：post id 嵌在数组元素内，
    // 顶层只有 channel_id。探入 posts[0] 取 sid，使撤回/批量事件的投影能与出站(postId)、
    // 落库(sid) 聚同一束。多 post 信封(转发 UC-1.7)首元素代表，后续按需扩展。
    payload?.data?.posts?.[0],
    payload?.posts?.[0],
    // batch sync 出站（channels/load/increment）：channelId 嵌在 body.cursors[0]，
    // 顶层/.data/.body 都无单频道锚。探 body.cursors[0] 取锚频道，使 ① 出站与
    // per-channel ② projection / ④ storage 聚同一束（UC-4.1 ① 面·与装饰器 event.rs 对齐）。
    payload?.body?.cursors?.[0],
  ].filter((p) => p && typeof p === 'object');
  /** @type {{ch?:string,tmp?:string,sid?:string,seq?:string}} */
  const dims = {};
  for (const dim of DIMS) {
    for (const p of probes) {
      const hit = pickFrom(p, ALIASES[dim]);
      if (hit !== undefined) {
        // outbound send body 携 `id:""`（占位），不当 server_id。
        if (dim === 'sid' && hit === '') continue;
        dims[dim] = hit;
        break;
      }
    }
  }
  return dims;
}

/** 把维度对象串成 corr_key（`ch=..;tmp=..;sid=..;seq=..`，缺维省略）。全空 → null。 */
export function dimsToKey(dims) {
  const parts = [];
  for (const dim of DIMS) {
    if (dims[dim] !== undefined) parts.push(`${dim}=${dims[dim]}`);
  }
  return parts.length ? parts.join(';') : null;
}

/** 便捷：payload → corr_key 串（或 null）。 */
export function keyOf(payload) {
  return dimsToKey(extractDims(payload));
}

/** 解析 corr_key 串回维度对象（reducer 合并束时用）。 */
export function parseKey(key) {
  /** @type {{ch?:string,tmp?:string,sid?:string,seq?:string}} */
  const dims = {};
  if (typeof key !== 'string') return dims;
  for (const seg of key.split(';')) {
    const [k, v] = seg.split('=');
    if (DIMS.includes(/** @type {any} */ (k)) && v !== undefined) dims[k] = v;
  }
  return dims;
}

/**
 * 两个维度对象是否指向「同一逻辑事件」。
 * 规则：任一共有维度相等即同事件（tmp 贯穿乐观→echo；sid 在 echo 后出现；ch+seq 兜底）。
 * 这让「发送 body(tmp,无 sid)」与「echo 帧(tmp+sid)」「投影(tmp+sid)」「DOM(tmp→sid)」聚同一束。
 */
export function sameEvent(a, b) {
  if (!a || !b) return false;
  if (a.tmp && b.tmp) return a.tmp === b.tmp;
  if (a.sid && b.sid) return a.sid === b.sid;
  if (a.ch && b.ch && a.seq && b.seq) return a.ch === b.ch && a.seq === b.seq;
  // UC-4.1 纯频道事件（hello 增量）：②投影 + ④落库都只有 ch（无 tmp/sid/seq）→ 按 ch 聚。
  // 仅当**两侧都无 tmp/sid/seq**（纯频道范围）才走 ch-only，避免把同频道多条 post（带 tmp/sid）误并。
  const aScoped = !a.tmp && !a.sid && !a.seq;
  const bScoped = !b.tmp && !b.sid && !b.seq;
  if (a.ch && b.ch && aScoped && bScoped) return a.ch === b.ch;
  return false;
}

/** 合并两个维度对象（b 覆盖/补全 a，用于束内逐跳累积 tmp→sid 等）。 */
export function mergeDims(a, b) {
  const out = { ...a };
  for (const dim of DIMS) {
    if (b[dim] !== undefined) out[dim] = b[dim];
  }
  return out;
}
