// 语义 DOM 消息行模型 —— 直映 spec §4 的 data-* 契约。
//
// <div class="msg"
//      data-msg-id="{server_id || temporaryId}"
//      data-temporary-id="{temporaryId}"
//      data-channel-id="{channelId}"
//      data-event-seq="{eventSeq}"
//      data-send-status="{sending|sent|failed}"
//      data-read-bits="{readBits}">{text}</div>

export type SendStatus = "sending" | "sent" | "failed";

export interface MessageRow {
  /** data-msg-id：乐观时 = temporaryId；echo 后 = server_id */
  msgId: string;
  /** data-temporary-id：贯穿乐观→覆写不变（WebdriverIO 选择器锚） */
  temporaryId: string;
  /** data-channel-id */
  channelId: string;
  /** data-event-seq：乐观时未知（null → 渲染空串），echo 后补 */
  eventSeq: number | null;
  /** data-send-status */
  sendStatus: SendStatus;
  /** data-read-bits */
  readBits: string;
  /** 行文本内容 */
  text: string;
  /** data-type：消息类型（TEXT/DOCUMENT…）。乐观期取本地 pendingType，echo 后取投影 data.type。
   *  未设时不渲染该属性。 */
  type?: string;
  /** data-revoke：撤回态（im:post:batch-updated / im:post:deleted 命中本行 server id → true）。
   *  渲染 [data-revoke="1"]；未撤回时不渲染该属性（spec uc-1.5 读 ds.revoke）。 */
  revoked?: boolean;
}
