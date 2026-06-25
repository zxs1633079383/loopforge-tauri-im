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

/**
 * UC-5.3 关闭/退出群投影 channel（to_effect_s1::emit_channel_closed·真源 channel.rs:593
 * `{channelId, deleteAt}`）。data 形态 = `{ channelId, deleteAt }`（全 camelCase·现网 wire 透传）。
 * 触发路径 WS channel_close action（broadcast 到 channelId·自己也收）。壳收到即把该频道行从 CL
 * 区移除（data-channel-id 消失·壳纯渲染只消费投影删行·不在 JS 臆造软删态）。
 */
export const CHANNEL_CLOSED_CHANNEL = "im:channel:closed";

/** im:channel:closed data 形态（{channelId, deleteAt}·全 camel·channel_close 透传）。 */
export interface ChannelClosedData {
  channelId: string;
  deleteAt: number;
}

/**
 * UC-1.10 定时消息投影 channel（projection-schema 行 72 to_effect_s1::emit_schedule_created）。
 * data 形态 = `{ channelId, hasSchedulePost }`（全 camelCase·现网 wire 透传）。触发路径 WS
 * post_schedule_created action。壳收到即把该频道行 hasSchedule 标 true（data-has-schedule-post=true·
 * 频道级属性·壳纯渲染只透传投影 hasSchedulePost·不在 JS 合成）。
 */
export const CHANNEL_SCHEDULE_CREATED_CHANNEL = "im:channel:schedule-created";

/** im:channel:schedule-created data 形态（projection-schema 行 72·{channelId, hasSchedulePost}·全 camel）。 */
export interface ChannelScheduleCreatedData {
  channelId: string;
  hasSchedulePost: boolean;
}

/**
 * UC-2.4 读族回灌 channel（projection-schema §1.2 read_relay::emit_read_result）。
 * data 形态 = `{ req_id, body }`（成功）或 `{ req_id, error }`（失败）——body = 后端
 * getReplies/getReplyBranch 响应体原样透传（`{rootPost, replies}` / 分支结果·inner 不冻结）。
 * 读族无 WS 回声·HTTP 200 即数据·壳收到即把回复 postId 抽进 AX reply-drawer（data-reply-id 直映）。
 */
export const READ_RESULT_CHANNEL = "im:read:result";

/** im:read:result data 形态（projection-schema §1.2·{req_id, body}|{req_id, error}·body 透传不冻结）。 */
export interface ReadResultData {
  req_id: string;
  body?: unknown;
  error?: string;
}

/**
 * UC-2.1 切群首屏投影 channel（projection-schema §1 行 74 query::emit_message_query_result）。
 * data 形态 = `{ channel_id, messages: [...] }`（外层 2 键·schema 行 281：直接渲染不走 {items:[]} 解包）。
 * messages 元素 = `SELECT * FROM message` 原始 DB 行（snake 列名·schema 行 269）——关键列：
 *  `temporary_id`（PK）· `id`（server msg id·空串表未对账）· `channel_id` · `type` · `message`
 *  · `read_bits` · `revoke`（0/1）。读族纯本地 Scan·无 HTTP 出站·壳收到即把 messages 渲染进 ML 区
 *  消息行（data-msg-id 直映·壳纯渲染不合成）。触发：invoke im_query_messages_by_channel（切群）。
 */
export const MESSAGES_QUERY_RESULT_CHANNEL = "im:messages:query_result";

/** im:messages:query_result data 形态（projection-schema 行 74·{channel_id, messages}·messages 透传 DB 行）。 */
export interface MessagesQueryResultData {
  channel_id: string;
  messages: unknown[];
}

/**
 * UC-2.2 上拉更早历史投影 channel（projection-schema §1.3 older_context::emit_older_loaded）。
 * data 形态 = `{ channelId, messages: [...], hasMore }`（外层 3 键·camelCase·冻结集）。
 * messages 元素 = 严格更早 wire Post **升序**数组（透传 camelCase：id/temporaryId/channelId/
 * createAt/message/type…·inner 字段后端定不冻结）。hasMore=true 表尚有更早；false 表到顶。
 * 触发：invoke im_load_older_context（滚到顶上拉）→ helix 多轮 postContext 编排回报后收尾 emit。
 * 壳收到即把 messages **prepend** 进 ML 区消息行头部（data-msg-id 直映·壳纯渲染不合成）。
 */
export const OLDER_LOADED_CHANNEL = "im:messages:older_loaded";

/** im:messages:older_loaded data 形态（projection-schema §1.3·{channelId, messages, hasMore}·messages 透传 wire Post）。 */
export interface OlderLoadedData {
  channelId: string;
  messages: unknown[];
  hasMore: boolean;
}

/**
 * UC-6.3 改群昵称投影 channel（projection-schema 行 71 to_effect_s1::emit_member_nickname）。
 * data 形态 = `{ channelId, userId, nickName }`（全 camelCase·nickName 驼峰·现网 wire 透传）。
 * 触发路径 WS update_channel_member_nickName action（broadcast 到 channelId·成员各收）。壳收到即
 * 把 MB 区该成员行 nickname 刷成 nickName（data-nickname 回读·壳纯渲染只透传投影 nickName·不在
 * JS 合成）；成员行缺则 upsert（投影驱动成员入列·data-member-id=userId）。
 */
export const MEMBER_NICKNAME_CHANNEL = "im:channel:memberNickname";

/** im:channel:memberNickname data 形态（projection-schema 行 71·{channelId, userId, nickName}·全 camel）。 */
export interface MemberNicknameData {
  channelId: string;
  userId: string;
  nickName: string;
}

/**
 * UC-6.1 拉/踢人投影 channel（projection-schema 行 70 to_effect_s1::emit_channel_member_updated）。
 * data 形态 = `{ channel_id, channel }`（channel = WS channel_member_update 透传帧 data 原始对象·不解析
 * 重组·内含 id/members[]/memberChange.{join,leave}[]）。触发路径 WS channel_member_update action
 * （broadcast 到 channelId·成员各收）。壳收到即从 channel 对象的成员源（memberChange.join[] + 四源
 * members[]/adminUsers[]/boss[]/owner）upsert MB 区成员行（data-member-id 直映·壳纯渲染只透传投影成员
 * id·不在 JS 合成）+ memberChange.leave[] 移除离场行 + 把在册成员 id 集刷进 data-members 回读串。
 * 与 helix WS handler channel_member_update 落库口径一致（join upsert / leave 物理删 channel_member）。
 */
export const MEMBER_UPDATED_CHANNEL = "im:channel:member-updated";

/** im:channel:member-updated data 形态（projection-schema 行 70·{channel_id, channel}·channel 透传不解析）。 */
export interface MemberUpdatedData {
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
