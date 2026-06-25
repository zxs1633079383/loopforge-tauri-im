// 投影 envelope 类型 —— 对齐 helix `projection-schema.md`（冻结契约，只读消费）。
//
// 单总线 im:__bus__ 信封：
//   { channel: "im:post:received", payload: { event: "im:post:received", data: {...} } }
//
// 本薄壳只消费 message-row 类 channel 的 message_item_data（fat 完整集）做渲染/echo 覆写。
// 字段名按 schema §1/§2 逐字对齐：**信号锚 snake_case** + **渲染核 camelCase** 混用，
// 不可假设全 camel 或全 snake（schema §0 命名陷阱）。

/** im:__bus__ 信封外层 */
export interface BusEnvelope {
  channel: string;
  payload: BusPayload;
}

export interface BusPayload {
  event: string;
  // data 形态随 channel 而异；message-row 类为 MessageItemData，其余按需断言。
  data: unknown;
}

/**
 * message_item_data fat 完整集 —— projection-schema §1/§2 冻结。
 * 出现在 channel: im:post:received / im:post:read / im:channel:read_echo /
 *                im:post:updated / im:post:deleted。
 *
 * 信号锚（snake_case）：channel_id / event_seq / msg_id
 * 渲染核（camelCase）：temporaryId / channelId / userId / type / message /
 *                      props / createAt / updateAt / readBits / viewers
 */
export interface MessageItemData {
  // —— 信号锚（snake_case，helix 自造）——
  channel_id: string;
  event_seq: number;
  msg_id: string;
  // —— 渲染核（camelCase，透传 wire 形态）——
  temporaryId: string;
  channelId: string;
  userId: string;
  type: string;
  message: string;
  props: unknown;
  // 注意：createAt 非 createdAt（schema §0 命名陷阱）
  createAt: number;
  updateAt: number;
  readBits: string | number;
  viewers: unknown;
}

/**
 * im:post:sending 瘦信号 —— projection-schema §1（helix module.rs:1059 emit_post_sending）：
 * data 键集 = { channel_id, temporary_id }（全 snake_case）。
 *
 * 发送乐观上屏由 **helix 投影驱动**（壳零业务逻辑）：壳收到此事件即插入 sending 行，
 * text 取本地 pendingText[temporary_id]（瘦投影不带 text）。不在 JS 合成乐观态。
 */
export interface PostSendingData {
  channel_id: string;
  temporary_id: string;
}

/** im:post:sending 单列 channel（瘦形态，单独分支，非 message-row fat 集） */
export const POST_SENDING_CHANNEL = "im:post:sending";

/**
 * 会话列表投影 channel —— helix `im_query_dialog_list` Scan 回报（query.rs emit_dialog_list_result）。
 * data 形态 = `{ dialogList: [{ id, display_name, unread_count, last_post_at, ... }] }`（channel 表行）。
 * 壳就绪后拉一次，取首行 `id` 设 activeChannel（send 族 UC 决定性发送目标）。
 */
export const CHANNELS_PROJECTION_CHANNEL = "im:channels:projection";

/**
 * UC-4.1 hello 全量增量投影 channel（B-rest · projection-schema §B-rest 行 59/60/61）。
 * 壳收到即往 CL 区频道列表填行（data-channel-id 直映·壳纯渲染不合成）：
 *  - im:channels:loaded   data {items:[]}            冷启动补齐信号（瘦·无 channel_id）。
 *  - im:channel:increment data {channel_id, increment} WS increment_channel 透传 → 注册/更新该 channel 行。
 *  - im:channel:update    data {channel_id}            批次结束瘦信号（channel-row badge 触发位）。
 */
export const CHANNELS_LOADED_CHANNEL = "im:channels:loaded";
export const CHANNEL_INCREMENT_CHANNEL = "im:channel:increment";
export const CHANNEL_UPDATE_CHANNEL = "im:channel:update";

/**
 * UC-5.1 创建群聊投影 channel（projection-schema 行 68 to_effect_s1::emit_channel_created）。
 * data 形态 = `{ channel_id, channel }`（channel = 透传帧 data 原始 channel 对象·schema 行 210）。
 * 壳收到即往 CL 区频道列表 upsert 该 channel 行（data-channel-id 直映·壳纯渲染不合成）。
 */
export const CHANNEL_CREATED_CHANNEL = "im:channel:created";

/** im:channel:increment data 形态（projection-schema 行 60·increment 透传帧 data·不解析重组）。 */
export interface ChannelIncrementData {
  channel_id: string;
  increment: unknown;
}

/** im:channel:created data 形态（projection-schema 行 68·{channel_id, channel}·channel 透传不解析）。 */
export interface ChannelCreatedData {
  channel_id: string;
  channel: unknown;
}

/** message-row 类 channel（携 message_item_data fat 完整集） */
export const MESSAGE_ROW_CHANNELS: ReadonlySet<string> = new Set([
  "im:post:received",
  "im:post:read",
  "im:channel:read_echo",
  "im:post:updated",
  "im:post:deleted",
]);
