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
 * im:post:sending 瘦信号 —— projection-schema §1：
 * data 键集 = { channel_id, temporary_id }
 * （发送乐观上屏；本薄壳乐观插入由前端自做，故主要消费 message-row echo）
 */
export interface PostSendingData {
  channel_id: string;
  temporary_id: string;
}

/** message-row 类 channel（携 message_item_data fat 完整集） */
export const MESSAGE_ROW_CHANNELS: ReadonlySet<string> = new Set([
  "im:post:received",
  "im:post:read",
  "im:channel:read_echo",
  "im:post:updated",
  "im:post:deleted",
]);
