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

/** message-row 类 channel（携 message_item_data fat 完整集） */
export const MESSAGE_ROW_CHANNELS: ReadonlySet<string> = new Set([
  "im:post:received",
  "im:post:read",
  "im:channel:read_echo",
  "im:post:updated",
  "im:post:deleted",
]);
