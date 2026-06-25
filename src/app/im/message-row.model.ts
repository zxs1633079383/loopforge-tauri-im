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

// ——— 骨架区域模型（spec §1.2/§1.4/§1.6 · CL/MB/AX 语义区 · 加法式占位）———
// 这些是「覆盖所有 UC 渲染容器」的模型骨架（issue #46）。当前为空列表占位，
// 各区 data-* 直映投影字段（壳纯渲染·不在 JS 合成）；store apply 分支由各 UC issue 逐个填。

/** 频道列表行（CL 区 · spec §1.2）。data-channel-id 直映 emit_channels_loaded/created/increment。 */
export interface ChannelRow {
  /** data-channel-id */
  channelId: string;
  /** data-channel-type：P(私)/T(话题)/team(大群) */
  channelType?: string;
  /** data-channel-display-name：emit_channel_update 回读 channel.displayName（UC-5.4） */
  displayName?: string;
  /** data-channel-notice：channel.notice 回读（UC-5.4） */
  notice?: string;
  /** data-channel-top：channelIsTop（UC-5.5 频道置顶） */
  top?: boolean;
  /** data-unread：cursor/unread_count badge（UC-4.2 增量后） */
  unread?: number;
  /** data-has-schedule：channel.has_schedule_post（UC-1.10） */
  hasSchedule?: boolean;
}

/** 成员行（MB 区 · spec §1.4）。data-member-id 直映 channel.members[]。 */
export interface MemberRow {
  /** data-member-id */
  memberId: string;
  /** data-admin：ADMIN 标（emit_channel_member_updated role · UC-6.2） */
  admin?: boolean;
  /** data-nickname：emit_member_nickname nickName（UC-6.3） */
  nickname?: string;
}

/** 书签行（AX bookmark-panel · UC-9.x）。data-bookmark-id 直映读族书签 load。 */
export interface BookmarkRow {
  /** data-bookmark-id */
  bookmarkId: string;
}

/** 待办行（AX todo-panel · UC-10.1）。data-todo-id 直映 todo::emit_todo_updated items。 */
export interface TodoRow {
  /** data-todo-id */
  todoId: string;
  /** data-todo-type */
  todoType?: string;
  /** data-todo-can-del */
  canDel?: boolean;
}

/** 回复链行（AX reply-drawer · UC-2.4）。data-reply-id 直映读族 getReplies。 */
export interface ReplyRow {
  /** data-reply-id：回复链每行根 postId */
  replyId: string;
}

export interface MessageRow {
  /** data-msg-id：乐观时 = temporaryId；echo 后 = server_id */
  msgId: string;
  /** data-temporary-id：贯穿乐观→覆写不变（WebdriverIO 选择器锚） */
  temporaryId: string;
  /** data-channel-id */
  channelId: string;
  /** data-event-seq：乐观时未知（null → 渲染空串），echo 后补 */
  eventSeq: number | null;
  /** createAt（int64 毫秒·非 DOM 属性）：query_result/older_loaded 带 create_at/createAt。
   *  UC-2.2 上拉历史以当前最旧行的 (msgId, createAt) 作锚（anchorPostId/anchorCreateAt）。
   *  乐观发送行未知 → undefined（不参与最旧锚选取）。 */
  createAt?: number;
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
  /** data-highlighted（UC-2.3 按 postId 定位）：client locate 态·命中 store._locateTarget 的行。
   *  rows computed 据定位锚打此标 → 渲染 [data-highlighted="true"]（壳纯渲染·非投影字段·客户端定位高亮）。
   *  未定位时不渲染该属性（e2e 读 [data-msg-id=target][data-highlighted="true"] 验定位命中）。 */
  highlighted?: boolean;

  // ——— 待加集（spec §2.2 · 逐 UC 加法式扩展 · 模板 [attr.data-*] 占位 · 空不渲染）———
  // 这些字段当前**只占位**：MessageRow 一次扩到位 + 模板 [attr.*] 挂载位就绪，
  // store apply 分支由各 UC issue（#7-#45）逐个填投影来源。空值时 Angular 不渲染该属性。

  /** data-urgent（UC-1.9）：加急态。投影来源 emit_post_updated props.expedite。命中→"1"。 */
  urgent?: boolean;
  /** data-reactions（UC-1.8）：快捷回复 emoji 串。投影来源 emit_post_updated props.quickReply
   *  序列化串（读族透传·非前端合成）。有→透传 props 串原样。 */
  reactions?: string;
  /** data-template-received（UC-3.3）：模板已收到。投影来源 props.template.userIds 含 self。
   *  含 self→"1"。 */
  templateReceived?: boolean;
  /** data-reply-id（UC-2.4）：回复链根 postId。投影来源读族 getReplies/getReplyBranch。 */
  replyId?: string;
  /** data-pinned（UC-5.5 · 🟡 data-dep）：消息置顶。投影来源 query::emit_read_result postPinned。
   *  命中→"1"（注：消息置顶子项物理够不到·留字段不强求绿）。 */
  pinned?: boolean;
  /** data-system-notice（UC-10.2）：系统通知行。投影来源 type=SYSTEM/SYSTEN 透传。命中→"1"。 */
  systemNotice?: boolean;
  /** data-vote（UC-8.x）：投票卡 props 串。投影来源 emit_post_updated props.vote 透传。
   *  有→透传 props 串原样（不解析重组）。 */
  vote?: string;
  /** data-average（UC-8.x）：平均分卡 props 串。投影来源 emit_post_updated props.average 透传。
   *  有→透传 props 串原样。 */
  average?: string;
}
