import { Injectable, computed, inject, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";
import { extractReactions, extractTemplateReceived } from "./props-extract";
import { extractReplyIds } from "./read-result-extract";
import {
  BookmarkRow,
  ChannelRow,
  MemberRow,
  MessageRow,
  ReplyRow,
  TodoRow,
} from "./message-row.model";
import {
  BusEnvelope,
  CHANNEL_CREATED_CHANNEL,
  CHANNEL_INCREMENT_CHANNEL,
  CHANNEL_UPDATE_CHANNEL,
  CHANNELS_LOADED_CHANNEL,
  CHANNELS_PROJECTION_CHANNEL,
  CHANNEL_SCHEDULE_CREATED_CHANNEL,
  ChannelCreatedData,
  ChannelIncrementData,
  ChannelScheduleCreatedData,
  MESSAGE_ROW_CHANNELS,
  MESSAGES_QUERY_RESULT_CHANNEL,
  MessageItemData,
  MessagesQueryResultData,
  OLDER_LOADED_CHANNEL,
  OlderLoadedData,
  POST_SENDING_CHANNEL,
  PostSendingData,
  READ_RESULT_CHANNEL,
  ReadResultData,
} from "./projection.types";

/**
 * IM 薄壳状态机 —— **纯渲染**：listen im:__bus__ → 按投影渲染，零业务逻辑（铁律）。
 *
 * 发送链路全程 helix 驱动（壳不合成乐观行）：
 *  - send()：生成 temporaryId → 暂存 pendingText[tmp]=text（瘦投影不带 text）→ invoke im_send。
 *  - im:post:sending（瘦 snake：channel_id/temporary_id）→ 插入 sending 行（text 取 pendingText）。
 *  - im:post:received（fat camel：temporaryId/message/...）→ 按 temporaryId 覆写成 sent + 清 pendingText。
 *
 * 不变量：
 *  - data-temporary-id 贯穿 sending→覆写不变（选择器锚）。
 *  - 乐观 sending 行由 helix `im:post:sending` 投影驱动，不在 JS 合成。
 *  - echo 覆写按 temporaryId 找行：data-msg-id 改 server id、status=sent、补 event-seq。
 */
@Injectable({ providedIn: "root" })
export class ImStoreService {
  private readonly bridge = inject(TauriBridgeService);

  /** 消息行（按插入序） */
  private readonly _rows = signal<MessageRow[]>([]);

  /** UC-2.3 按 postId 定位目标（client locate 态·纯渲染高亮锚）。空串=无定位。
   *  locatePost(postId) 设此值 → rows computed 给命中行打 highlighted=true → 模板渲染
   *  [data-highlighted="true"]。读族纯本地：定位目标已在 query_result 加载的本地行集内
   *  （单账号 L1 seeded DB），无需额外 HTTP；故定位 = 标记已加载行（spec §UC-2.3）。 */
  private readonly _locateTarget = signal<string>("");
  readonly locateTarget = computed(() => this._locateTarget());

  /** 消息行（叠加 UC-2.3 定位高亮：命中 _locateTarget 的行 highlighted=true·壳纯渲染）。 */
  readonly rows = computed(() => {
    const target = this._locateTarget();
    const rows = this._rows();
    if (!target) return rows;
    return rows.map((r) => (r.msgId === target ? { ...r, highlighted: true } : r));
  });

  /** 就绪标志（W1 probe im:ready 后置 true → 渲染 data-ready，供 e2e before 轮询） */
  private readonly _ready = signal(false);
  readonly ready = computed(() => this._ready());

  /** 活动频道：stream 里第一个真实频道胜出（含 increment）→ 锚定，供发送/data-active-channel。 */
  private readonly _activeChannel = signal<string>("");
  readonly activeChannel = computed(() => this._activeChannel());

  // ——— 骨架区域信号（issue #46 · CL/MB/AX 语义区容器占位 · 各 UC issue 逐个填 apply 分支）———
  // 当前全空列表，模板渲染空容器（覆盖所有 UC 渲染容器）。壳纯渲染：data-* 直映投影，不在 JS 合成。

  /** 频道列表（CL 区 · spec §1.2）。空占位 → 各 UC（4.1/5.x/11.x）填 applyChannels*。 */
  private readonly _channels = signal<ChannelRow[]>([]);
  readonly channels = computed(() => this._channels());

  /** 成员列表（MB 区 · spec §1.4）。空占位 → UC-6.x 填 applyChannelMember*。 */
  private readonly _members = signal<MemberRow[]>([]);
  readonly members = computed(() => this._members());

  /** 成员区回读串（data-members · UC-6.1）。空占位 → 投影透传 channel 对象成员集。 */
  private readonly _membersAttr = signal<string>("");
  readonly membersAttr = computed(() => this._membersAttr());

  /** 健康探针（H 区 · data-health · UC-12.1）。空占位 → onHealth() 填。 */
  private readonly _health = signal<string>("");
  readonly health = computed(() => this._health());

  /** 书签列表（AX bookmark-panel · UC-9.x）。空占位。 */
  private readonly _bookmarks = signal<BookmarkRow[]>([]);
  readonly bookmarks = computed(() => this._bookmarks());

  /** 待办列表（AX todo-panel · UC-10.1）。空占位。 */
  private readonly _todos = signal<TodoRow[]>([]);
  readonly todos = computed(() => this._todos());

  /** 回复链（AX reply-drawer · UC-2.4）。空占位。 */
  private readonly _replies = signal<ReplyRow[]>([]);
  readonly replies = computed(() => this._replies());

  private unlisten: (() => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  /** 本地暂存：temporaryId → 发送文本（瘦投影 im:post:sending 不带 text，渲染 sending 行需要）。 */
  private readonly pendingText = new Map<string, string>();

  /** 本地暂存：temporaryId → 消息类型（瘦投影 im:post:sending 不带 type，乐观 sending 行 data-type 需要）。 */
  private readonly pendingType = new Map<string, string>();

  /** 订阅单总线 + 启动就绪 probe 轮询。组件 ngOnInit 调一次。 */
  async start(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await this.bridge.listen<BusEnvelope>(
      "im:__bus__",
      (env) => this.onBus(env),
    );
    // 就绪 probe：W1 契约 = 轮询 invoke('im_ready') -> bool（非 bus 事件）。
    // increment_end 收齐 + inflight0 + cursor 稳 后返 true → 置 data-ready，供 e2e before 轮询。
    this.pollReady();
    // 会话列表 bootstrap：主动拉一次本地 dialogList → 设 activeChannel（send 族 UC 决定性发送目标）。
    // 早于就绪 probe 触发（probe 等增量静默 ~1.5s+），回报到时 activeChannel 已就位。
    this.bootstrapDialogList();
  }

  /** 拉一次本地会话列表（im_query_dialog_list → im:channels:projection 回报设 activeChannel）。
   *  非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。 */
  private bootstrapDialogList(): void {
    this.bridge.invoke<void>("im_query_dialog_list").catch(() => {
      // 非 Tauri / 命令缺失 → 忽略
    });
  }

  stop(): void {
    this.unlisten?.();
    this.unlisten = null;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
  }

  /** 轮询 im_ready 直到 true；非 Tauri 环境 invoke reject → 停轮询（dev 单独调样式不卡死）。 */
  private pollReady(): void {
    if (this._ready()) return;
    this.bridge
      .invoke<boolean>("im_ready")
      .then((ready) => {
        if (ready) {
          this._ready.set(true);
          return;
        }
        this.readyTimer = setTimeout(() => this.pollReady(), 250);
      })
      .catch(() => {
        // 非 Tauri / 命令缺失 → 不再轮询（dev 浏览器单独调 UI 时不阻塞）
      });
  }

  /**
   * 发送：生成 temporaryId → 暂存 pendingText → invoke('im_send')。
   *
   * **不在 JS 合成乐观行**——sending 行由 helix `im:post:sending` 投影驱动（壳纯渲染）。
   * invoke 失败（含非 Tauri 环境）→ 若 sending 行已由投影插入则标 failed，并清 pendingText。
   */
  async send(channelId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const temporaryId = this.genTempId();

    // 瘦投影 im:post:sending 不带 text → 暂存供 sending 行渲染。
    this.pendingText.set(temporaryId, trimmed);

    try {
      await this.bridge.invoke<void>("im_send", {
        channelId,
        text: trimmed,
        temporaryId,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 标 failed（若投影已插行）+ 清暂存。
      this.markSendFailed(temporaryId);
    }
  }

  /**
   * 把乐观行标 failed（生产路径：send/sendDocument invoke 抛错时调用）。
   *
   * 单一真源——出站失败的 DOM 终态由本方法兑现（patchByTemp 标 failed + 清 pendingText）。
   * UC-1.4 测试机件经 debug 桥（main.ts `__lf.debugMarkFailed`，仅 Tauri dev/test 注入）
   * 复用本方法**复现真实失败态**（与真 invoke 抛错产生的 DOM 完全一致·非合成任意态）。
   * 行内已存 text（applyPostSending 取 pendingText 落进行）→ resend 复用 row.text 重走 posts/create，
   * 故此处清 pendingText（与原 send catch 行为一致），不影响重发。
   */
  markSendFailed(temporaryId: string): void {
    this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "failed" }));
    this.pendingText.delete(temporaryId);
  }

  /**
   * 发 DOCUMENT 消息（UC-1.2）：同 send 流，但 type=DOCUMENT（helix send_build 透传真值非降级 TEXT）。
   * 瘦投影 im:post:sending 不带 type → pendingType 暂存供乐观 sending 行 data-type 渲染；
   * echo（im:post:received data.type=DOCUMENT）覆写后 row.type 仍 DOCUMENT。
   */
  async sendDocument(channelId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const temporaryId = this.genTempId();
    this.pendingText.set(temporaryId, trimmed);
    this.pendingType.set(temporaryId, "DOCUMENT");

    try {
      await this.bridge.invoke<void>("im_send", {
        channelId,
        text: trimmed,
        temporaryId,
        msgType: "DOCUMENT",
      });
    } catch {
      this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "failed" }));
      this.pendingText.delete(temporaryId);
      this.pendingType.delete(temporaryId);
    }
  }

  /**
   * UC-1.4 重发失败消息：复用原 temporaryId 重走 posts/create（upsert 语义）。
   *
   * 与 send() 的唯一区别——**不生成新 temporaryId**，复用失败行原 tmp：
   *  - 出站 body temporaryId 重复 → server upsert（同 temporary_id 覆盖原失败行，不产生重复消息）。
   *  - 乐观把失败行从 failed 拨回 sending（DOM 状态流 failed→sending→sent）。
   *  - pendingText 复填（瘦投影 im:post:sending 不带 text，sending 行渲染需要）。
   *  - echo im:post:received 按同 temporaryId 找行覆写 → status=sent + data-msg-id=server_id。
   *
   * invoke 失败（含非 Tauri 环境）→ 行重新标 failed（可再次重发）+ 清暂存。
   */
  async resend(temporaryId: string, channelId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || !temporaryId || !channelId) return;

    // 乐观：失败行拨回 sending（DOM failed→sending）。瘦投影不带 text → pendingText 复填。
    this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "sending" }));
    this.pendingText.set(temporaryId, trimmed);

    try {
      await this.bridge.invoke<void>("im_send", {
        channelId,
        text: trimmed,
        temporaryId, // 复用原 tmp → upsert，不生成新 id
      });
    } catch {
      // 出站失败 → 重新标 failed（可再次重发）+ 清暂存。
      this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "failed" }));
      this.pendingText.delete(temporaryId);
    }
  }

  /**
   * UC-5.1 创建群聊：invoke('im_create_channel', {displayName, memberIds})。
   *
   * **壳不臆造 body**：teamId / 自身 userId（CREATOR）由 Rust 命令从 profile 单一真源拼装
   * （src-tauri commands.rs im_create_channel）。壳只供 displayName + 其他成员 memberIds。
   * 新建群行由 helix `im:channel:created` 投影驱动 upsert（壳纯渲染，不在 JS 合成 channel 行）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async createChannel(displayName: string, memberIds: string[]): Promise<void> {
    const name = displayName.trim();
    if (!name) return;
    try {
      await this.bridge.invoke<void>("im_create_channel", {
        displayName: name,
        memberIds,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（建群行靠投影驱动，无乐观合成）。
    }
  }

  /**
   * UC-5.2 创建话题（消息转话题）：invoke('im_make_topic', {rootId, postId, displayName, memberIds})。
   *
   * **壳不臆造 body**：teamId / 自身 userId（CREATOR）由 Rust 命令从 profile 单一真源拼装
   * （src-tauri commands.rs im_make_topic）。壳只供 rootId（根群 channelId）+ postId（被转消息
   * server id）+ displayName + 其他成员 memberIds。话题=新 channel，由 helix `im:channel:created`
   * 投影驱动 upsert CL 区新行（壳纯渲染，复用 applyChannelCreated 同 UC-5.1）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async makeTopic(
    rootId: string,
    postId: string,
    displayName: string,
    memberIds: string[],
  ): Promise<void> {
    const root = rootId.trim();
    const post = postId.trim();
    const name = displayName.trim();
    if (!root || !post || !name) return;
    try {
      await this.bridge.invoke<void>("im_make_topic", {
        rootId: root,
        postId: post,
        displayName: name,
        memberIds,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（话题行靠投影驱动，无乐观合成）。
    }
  }

  /**
   * UC-1.9 加急消息（阶段①）：invoke('im_urgent_post', {channelId, postId, targetIds, message?}）。
   *
   * **壳不臆造 body**：camelCase 化 + targetIds 非空校验由 Rust/helix-im 兜底（commands.rs
   * im_urgent_post → outbound/urgent.rs UrgentPostCommand → POST posts/urgentPost）。壳只供
   * channelId（当前活动频道）+ postId（已发送消息 server id）+ targetIds（目标成员 server id）。
   * 加急标记由 helix `im:post:updated` 投影驱动 data-urgent=1（壳纯渲染·无乐观合成）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async urgentPost(
    channelId: string,
    postId: string,
    targetIds: string[],
    message?: string,
  ): Promise<void> {
    const ch = channelId.trim();
    const post = postId.trim();
    if (!ch || !post || targetIds.length === 0) return;
    try {
      await this.bridge.invoke<void>("im_urgent_post", {
        channelId: ch,
        postId: post,
        targetIds,
        message,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（加急标记靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-1.9 确认收到加急（阶段②）：invoke('im_urgent_confirm', {postId, channelId}）。
   *
   * **壳不臆造 body**：camelCase 化由 Rust/helix-im 兜底（commands.rs im_urgent_confirm →
   * outbound/urgent.rs UrgentConfirmCommand → POST posts/urgentConfirm）。壳只供 postId + channelId。
   * 确认后状态由 helix `im:post:updated` 投影驱动（壳纯渲染）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async urgentConfirm(postId: string, channelId: string): Promise<void> {
    const post = postId.trim();
    const ch = channelId.trim();
    if (!post || !ch) return;
    try {
      await this.bridge.invoke<void>("im_urgent_confirm", {
        postId: post,
        channelId: ch,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默。
    }
  }

  /**
   * UC-1.8 快捷回复 emoji：invoke('im_send_quick_reply', {postId, emoji}）。
   *
   * **壳不臆造 body**：自身 userId 由 Rust 从 identity 补 + camelCase 化 + endpoint 全在
   * helix-im（commands.rs im_send_quick_reply → outbound/quick_reply.rs QuickReplyCommand →
   * POST posts/quickReply {postId, userId, emoji}）。壳只供 postId（被回复消息 server id）+
   * emoji（用户选的表情）。data-reactions 由 helix `im:post:updated`（fat·props.quickReply）
   * 投影驱动·壳纯渲染·无乐观合成。非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async quickReply(postId: string, emoji: string): Promise<void> {
    const post = postId.trim();
    const em = emoji.trim();
    if (!post || !em) return;
    try {
      await this.bridge.invoke<void>("im_send_quick_reply", {
        postId: post,
        emoji: em,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（reactions 靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-1.10 定时消息 create：invoke('im_create_schedule', {channelId, message, schedulePostAt, temporaryId?}）。
   *
   * **壳不臆造 body**：body 嵌套 post 对象 + endpoint 全在 helix-im（commands.rs im_create_schedule →
   * outbound/posts_existing.rs CreateScheduleCommand → POST posts/createSchedule
   * {post:{channelId,message,temporaryId?}, schedulePostAt}）。壳只供 channelId（当前活动频道）+
   * message（定时正文）+ schedulePostAt（未来发送毫秒戳）+ 可选 temporaryId。频道行 hasSchedule
   * 由 helix `im:channel:schedule-created`（{channelId, hasSchedulePost}）投影驱动 data-has-schedule-post
   * （频道级属性·壳纯渲染·无乐观合成）。非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async createSchedule(
    channelId: string,
    message: string,
    schedulePostAt: number,
    temporaryId?: string,
  ): Promise<void> {
    const ch = channelId.trim();
    const msg = message.trim();
    if (!ch || !msg || !(schedulePostAt > 0)) return;
    try {
      await this.bridge.invoke<void>("im_create_schedule", {
        channelId: ch,
        message: msg,
        schedulePostAt,
        temporaryId,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（hasSchedule 靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-3.2 单条已读：invoke('im_mark_read', {postId, channelId}）。
   *
   * **壳不臆造 body**：posts 列表模式（`{channelId, posts:[postId]}`）化 + endpoint 全在
   * helix-im（commands.rs im_mark_read → outbound/posts_existing.rs PostReadCommand →
   * POST post/read）。壳只供 postId（被标记已读的消息 server id）+ channelId。readBits 由
   * helix `im:post:read`（fat·WS post_read echo）投影驱动 data-read-bits·壳纯渲染·无乐观合成
   * （readBits 单调覆盖由 applyMessageItem 既有路径处理·复用 im:post:received 同 fat 集）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async markRead(postId: string, channelId: string): Promise<void> {
    const post = postId.trim();
    const ch = channelId.trim();
    if (!post || !ch) return;
    try {
      await this.bridge.invoke<void>("im_mark_read", {
        postId: post,
        channelId: ch,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（readBits 靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-3.1 会话已读：invoke('im_read_channel', {channelId}）。
   *
   * 进/看会话触发——**会话级**标整会话已读（vs UC-3.2 markRead 的 posts 单条模式）。
   * **壳不臆造 body**：endpoint（channels/view）+ channels 数组包装全在 helix-im（commands.rs
   * im_read_channel → 包 channels:[{id:channelId}] → 入泵 im_channels_view →
   * outbound/channel_change_dedicated.rs ViewChannelsCommand → POST channels/view）。壳只供
   * channelId。fire-and-forget 无 HTTP 返回；readBits 由 helix `im:post:read`（fat·WS read echo
   * event_type=6）投影驱动 data-read-bits·壳纯渲染·无乐观合成（read_bits 单调覆盖由 applyMessageItem
   * 既有路径处理·复用 im:post:received 同 fat 集）。非 Tauri / 命令缺失 → 静默（dev 浏览器不卡）。
   */
  async readChannel(channelId: string): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    try {
      await this.bridge.invoke<void>("im_read_channel", { channelId: ch });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（readBits 靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-2.1 切群首屏（读族·纯本地 Scan·无 HTTP 出站）：invoke('im_query_messages_by_channel', {channelId}）。
   *
   * 切换频道时调一次——helix `query_dispatch` 吐 `Scan(message WHERE channel_id ORDER BY create_at DESC)`，
   * PortReply 回报后 `port_reply` emit `im:messages:query_result{channel_id, messages:[DB行]}`（无 WS/HTTP
   * 回声·读路径）。壳收到投影即 applyMessagesQueryResult 渲染 ML 区消息行（data-msg-id 直映·壳纯渲染）。
   * **壳不臆造 body**：engine build_message_query 认 snake channel_id/limit·本壳只翻译入泵（commands.rs
   * im_query_messages_by_channel）。同时把 activeChannel 切到目标频道（切群语义·决定性发送/已读目标）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async queryMessages(channelId: string, limit?: number): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    // 切群语义：把活动频道切到目标（覆盖 captureActiveChannel 的"首个胜出"锚·用户显式选群优先）。
    this._activeChannel.set(ch);
    try {
      await this.bridge.invoke<void>("im_query_messages_by_channel", {
        channelId: ch,
        limit,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（首屏靠 im:messages:query_result 投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-2.2 上拉加载更早历史：以当前已加载行集**最旧**一条（带 server id + createAt）作 pivot
   * 锚 → invoke im_load_older_context（channelId + anchorPostId + anchorCreateAt）→ helix 多轮
   * postContext 编排回报后 emit im:messages:older_loaded → applyOlderLoaded prepend 更早行。
   *
   * 锚选取：最旧行 = createAt 最小且有 server msgId 的行（乐观未对账行无 server id·不作 pivot·
   * 后端 postContext 认 server postId）。无可用锚（行集空/全无 createAt）→ 不发（无 anchor 无法翻页）。
   * 薄壳纪律：只选锚 + 入泵·翻页编排（轮数/before/凑够判定）全在 helix·不在 JS 合成 before。
   */
  async loadOlder(): Promise<void> {
    const ch = this._activeChannel().trim();
    if (!ch) return;
    // 选当前频道行集里 createAt 最小且带 server msgId 的一条作 pivot 锚。
    let oldest: MessageRow | null = null;
    for (const r of this._rows()) {
      if (r.channelId !== ch) continue;
      if (typeof r.createAt !== "number") continue;
      if (!r.msgId) continue;
      if (oldest === null || r.createAt < (oldest.createAt as number)) oldest = r;
    }
    if (!oldest) return; // 无可翻页锚（无已加载历史 / 无 createAt）→ 不发
    try {
      await this.bridge.invoke<void>("im_load_older_context", {
        channelId: ch,
        anchorPostId: oldest.msgId,
        anchorCreateAt: oldest.createAt,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（历史靠 im:messages:older_loaded 投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-2.3 按 postId 定位：在当前已加载（query_result）的本地消息行里定位目标 server postId，
   * 给命中行打高亮（rows computed 据 _locateTarget 渲染 [data-highlighted="true"]）。
   *
   * **读族纯本地·无 HTTP 出站**（spec §UC-2.3 / projection-schema §1 query 投影路径）：单账号
   * L1 + seeded DB 下，定位目标必在 query_result 已 Scan 的本地行集内（首屏 ≤500 条）。故定位 =
   * 标记已加载行，复用 UC-2.1 query_result（②）+ Scan message（④）两面，新增 ③ DOM 高亮锚。
   * （锚不在本地首屏的越界翻页是 posts/getPostsAfterIndex HTTP 兜底·L2/真翻页另路·非本 L1 闭环。）
   *
   * 若目标频道未加载 → 先 queryMessages 拉首屏再定位（保证 query_result ② 投影发生·串四面）。
   */
  async locatePost(postId: string, channelId?: string): Promise<void> {
    const target = postId.trim();
    if (!target) return;
    // 若目标频道与当前活动频道不同（或行集未含目标）→ 先拉该频道首屏（产 query_result 投影）。
    const ch = (channelId ?? this._activeChannel()).trim();
    const loaded = this._rows().some((r) => r.msgId === target);
    if (ch && (!loaded || ch !== this._activeChannel())) {
      await this.queryMessages(ch);
    }
    // 设定位锚 → rows computed 给命中行 highlighted=true（壳纯渲染·无业务合成）。
    this._locateTarget.set(target);
  }

  /**
   * UC-2.4 一级回复列表（读族）：invoke('im_get_replies', {replyId, reqId}）。
   *
   * **读族 request-response**：HTTP 200 响应体即数据→helix `read_relay::emit_read_result` 透传回灌
   * `im:read:result{req_id, body}`→onBus applyReadResult 抽 postId 进 AX reply-drawer（data-reply-id）。
   * **壳不臆造 body**：endpoint（posts/getReplies）+ wire body camelCase 化（replyId/pageNumber/pageSize）
   * 全在 helix-im（commands.rs im_get_replies → outbound/posts_read.rs GetRepliesCommand）。壳只供
   * replyId（回复链根 server postId）+ reqId（前端 bridge 生成·回灌关联·非 wire 字段·helix
   * module::read_req_id 抠出注册 OutboundReadReply 上下文）。返 reqId 供 caller/e2e 等回灌关联。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡），仍返 reqId（一致返回类型）。
   */
  async loadReplies(replyId: string, reqId?: string): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const post = replyId.trim();
    if (!post) return rid;
    try {
      await this.bridge.invoke<void>("im_get_replies", {
        replyId: post,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（回复链靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-2.4 二级回复分支（读族）：invoke('im_get_reply_branch', {replyFirstLevelId, reqId}）。
   *
   * 同 loadReplies 走 `im:read:result{req_id, body}` 透传回灌。endpoint posts/getReplyBranch + wire body
   * camelCase 化（replyFirstLevelId/pageNumber/pageSize）全在 helix-im（GetReplyBranchCommand）。壳只供
   * replyFirstLevelId（一级回复 server postId）+ reqId。返 reqId 供 caller/e2e 等回灌关联。
   */
  async loadReplyBranch(
    replyFirstLevelId: string,
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const post = replyFirstLevelId.trim();
    if (!post) return rid;
    try {
      await this.bridge.invoke<void>("im_get_reply_branch", {
        replyFirstLevelId: post,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（分支靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /** 读族关联 id（req_id）生成器（非 wire 字段·仅前端 bridge↔回灌关联用·z-base-32 短 id）。 */
  private genReqId(): string {
    return `req-${Math.random().toString(36).slice(2, 12)}`;
  }

  /**
   * UC-3.3 模板已收到回执：invoke('im_template_received', {postId}）。
   *
   * **壳不臆造 body**：endpoint（`POST post/templateReceived`·`/post` 单数前缀）+ body 形态
   * `{postId}`（camelCase）全在 helix-im（commands.rs im_template_received → 入泵
   * outbound/template_received.rs TemplateReceivedCommand）。壳只供 postId（模板消息 server id）。
   * fire-and-forget（响应 CommonRes 无 data）；data-template-received 由 helix `im:post:updated`
   * （fat·WS post_update EventKind::PostEdit·props.template.userIds 含 self）投影驱动·壳纯渲染·
   * 无乐观合成（applyMessageItem 既有路径按 server id 锚命中既有行·extractTemplateReceived 抽
   * props.template patch）。非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async templateReceived(postId: string): Promise<void> {
    const post = postId.trim();
    if (!post) return;
    try {
      await this.bridge.invoke<void>("im_template_received", { postId: post });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（templateReceived 靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-1.7 转发/合并转发：invoke('im_relay_messages', {posts, channelIds}）。
   *
   * **壳不臆造 body**：endpoint（`POST posts/createPosts`·双段复数）+ camelCase 化（posts/channelIds）
   * + 两数组非空校验全在 helix-im（commands.rs im_relay_messages → outbound/posts_relay.rs
   * CreatePostsCommand）。壳只供 posts（从本地消息行构造的 Post 对象数组）+ channelIds（目标频道）。
   *
   * 转发是「批量建新消息到 N 目标频道」：后端遍历 channelIds × posts 在每个目标 channel 建消息 →
   * 逐 channel WS `post` echo → helix `im:post:received`（fat·各 channel 独立·channel_id/msg_id/
   * event_seq 各异）投影驱动 applyMessageItem 追加各目标频道消息行（无乐观合成·壳纯渲染·新消息
   * 无本地 tmp 锚→走 server-id 追加分支）。非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async relayMessages(
    posts: Array<Record<string, unknown>>,
    channelIds: string[],
  ): Promise<void> {
    const targets = channelIds.map((c) => c.trim()).filter(Boolean);
    if (posts.length === 0 || targets.length === 0) return;
    try {
      await this.bridge.invoke<void>("im_relay_messages", {
        posts,
        channelIds: targets,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（转发行靠投影驱动·无乐观合成）。
    }
  }

  // ——— 私有 ———

  private onBus(env: BusEnvelope): void {
    const channel = env?.channel;
    if (!channel) return;

    // 会话列表 bootstrap 投影：从 dialogList 首行设 activeChannel（决定性发送目标，
    // 不依赖增量流是否恰有新活动）。单独分支，非 message-row fat 集。
    if (channel === CHANNELS_PROJECTION_CHANNEL) {
      this.applyDialogList(env.payload?.data);
      return;
    }

    // UC-4.1 hello 全量增量：channels:loaded（冷启动信号·瘦）/ channel:increment（注册/更新 channel 行）/
    // channel:update（批次结束瘦信号）→ 往 CL 区频道列表填行（data-channel-id 直映·壳纯渲染）。
    // 先于 message-row 分支：这些是 channel-row 信号，非 message_item_data fat 集。
    if (channel === CHANNELS_LOADED_CHANNEL) {
      // 冷启动补齐信号（data {items:[]}）：当前壳无 items 载荷消费（增量逐 channel 由 increment 填），
      // 仅作活动频道锚定的早退前透传机会——下行 captureActiveChannel 兜底（items 空则无操作）。
      return;
    }
    if (channel === CHANNEL_INCREMENT_CHANNEL) {
      this.applyChannelIncrement(env.payload?.data as ChannelIncrementData | undefined);
      return;
    }
    if (channel === CHANNEL_UPDATE_CHANNEL) {
      this.applyChannelUpdate(env.payload?.data);
      return;
    }
    // UC-5.1 建群：im:channel:created（{channel_id, channel}）→ upsert CL 区新频道行
    // （data-channel-id 直映·壳纯渲染只持 channelId）。先于 message-row 分支（channel-row 信号）。
    if (channel === CHANNEL_CREATED_CHANNEL) {
      this.applyChannelCreated(env.payload?.data as ChannelCreatedData | undefined);
      return;
    }
    // UC-1.10 定时消息：im:channel:schedule-created（{channelId, hasSchedulePost}·WS post_schedule_created
    // 透传）→ 把该频道行 hasSchedule 标 true（data-has-schedule-post 频道级属性·壳纯渲染透传投影
    // hasSchedulePost·不在 JS 合成）。先于 message-row 分支（channel-row 信号·非 message_item_data fat 集）。
    if (channel === CHANNEL_SCHEDULE_CREATED_CHANNEL) {
      this.applyScheduleCreated(
        env.payload?.data as ChannelScheduleCreatedData | undefined,
      );
      return;
    }

    // UC-1.5 撤回：在线 im:post:batch-updated（{channel_id, posts}）/ 离线 im:post:deleted（fat）
    // → 按 server id 标行 data-revoke=1。先于 MESSAGE_ROW_CHANNELS fat 覆写分支处理。
    if (channel === "im:post:batch-updated") {
      this.applyBatchUpdated(env.payload?.data);
      return;
    }
    if (channel === "im:post:deleted") {
      this.applyPostDeleted(env.payload?.data);
      return;
    }

    // UC-2.4 读族回灌：im:read:result（{req_id, body}）→ 把回复链 postId 抽进 AX reply-drawer
    // （data-reply-id 直映·壳纯渲染透传 body·不解析重组业务）。读族无 WS 回声·HTTP 200 即数据。
    // 先于 captureActiveChannel/message-row 分支（读结果非 channel-row 信号·body 无顶层 channel_id）。
    if (channel === READ_RESULT_CHANNEL) {
      this.applyReadResult(env.payload?.data as ReadResultData | undefined);
      return;
    }

    // UC-2.1 切群首屏：im:messages:query_result（{channel_id, messages:[DB行]}）→ 把 messages 渲染进
    // ML 区消息行（data-msg-id 直映·壳纯渲染透传 DB 行·不解析重组业务）。读族纯本地 Scan·无 WS/HTTP
    // 回声·invoke im_query_messages_by_channel 后 Scan 回报即 emit 本投影。先于 message-row fat 分支
    // （query_result 外层 2 键·非 message_item_data fat 集·messages 元素是 snake DB 行）。
    if (channel === MESSAGES_QUERY_RESULT_CHANNEL) {
      this.applyMessagesQueryResult(env.payload?.data as MessagesQueryResultData | undefined);
      return;
    }

    // UC-2.2 上拉更早历史：im:messages:older_loaded（{channelId, messages, hasMore}·camelCase wire
    // Post 升序数组）→ 把 messages **prepend** 进 ML 区头部（更早历史在上方·data-msg-id 直映
    // server id·壳纯渲染透传 wire Post·不解析重组）。读族编排无 WS 回声·多轮 postContext 收尾即 emit。
    // 先于 captureActiveChannel/message-row fat 分支（older_loaded 外层 3 键·非 message_item_data fat 集）。
    if (channel === OLDER_LOADED_CHANNEL) {
      this.applyOlderLoaded(env.payload?.data as OlderLoadedData | undefined);
      return;
    }

    // 活动频道锚定（在任何早退过滤之前）：stream 第一个真实频道胜出，含 im:channel:increment。
    // 兼容 snake(channel_id) 与 camel(channelId)；只在尚未锚定时 set（第一个胜出，不被后续覆盖）。
    this.captureActiveChannel(env.payload?.data);

    // 瘦信号 im:post:sending（snake）→ 乐观 sending 行（单独分支，非 fat 集）。
    if (channel === POST_SENDING_CHANNEL) {
      const data = env.payload?.data as PostSendingData | undefined;
      if (data && typeof data === "object") this.applyPostSending(data);
      return;
    }

    // message-row 类 channel 的 message_item_data fat 集 → echo 覆写。
    if (!MESSAGE_ROW_CHANNELS.has(channel)) return;

    const data = env.payload?.data as MessageItemData | undefined;
    if (!data || typeof data !== "object") return;
    this.applyMessageItem(data);
  }

  /**
   * 从任意投影 data 抽频道 id 锚定活动频道（第一个真实频道胜出）。
   * 兼容 snake(channel_id) 与 camel(channelId)；已锚定则不覆盖。纯渲染层（选哪个会话显示/发送）。
   */
  private captureActiveChannel(data: unknown): void {
    if (this._activeChannel()) return;
    if (!data || typeof data !== "object") return;
    const d = data as Record<string, unknown>;
    const id =
      (typeof d["channel_id"] === "string" && d["channel_id"]) ||
      (typeof d["channelId"] === "string" && d["channelId"]) ||
      "";
    if (id) this._activeChannel.set(id);
  }

  /**
   * 会话列表回报（im:channels:projection·fat 完整 dialogList）→ 渲染 CL 区频道行 + 设 activeChannel。
   * dialogList 行 = channel 表行，主键列名 `id`（helix query_tests 实证）；按 last_post_at 降序，
   * 首行即最近活跃会话——作 send 族 UC 的决定性发送目标。纯渲染层（选哪个会话），不碰业务。
   *
   * UC-4.1 就绪根：current-cursor 冷启动时增量为空（`im:channel:increment` 不 emit·`im:channels:loaded`
   * items 为 []），channel 行的**真实产出者**是本 `im:channels:projection`（projection-schema 行 75/282：
   * 会话列表 handler 直接渲染 dialogList）。故除设 activeChannel 外，须 upsert 每行 → `data-channel-id`
   * 才有渲染（此前只设 activeChannel·CL 区永空·DOM ③ 断在此跳）。加法式·壳纯渲染只持 channelId。
   */
  private applyDialogList(data: unknown): void {
    const list = (data as { dialogList?: unknown } | undefined)?.dialogList;
    if (!Array.isArray(list)) return;
    const ids = list
      .map((r) =>
        r && typeof r === "object"
          ? (r as Record<string, unknown>)["id"]
          : undefined,
      )
      .filter((id): id is string => typeof id === "string" && !!id);
    for (const id of ids) this.upsertChannelRow(id);
    if (!this._activeChannel() && ids.length > 0) this._activeChannel.set(ids[0]);
  }

  /**
   * UC-2.4 读族回灌：im:read:result（{req_id, body}）→ 把回复链 postId 抽进 AX reply-drawer。
   *
   * body = 后端 getReplies（`{rootPost, replies:[Post]}`）/ getReplyBranch（HasMorePage·`{data:[Post]}`
   * 或 `[Post]`）响应体原样透传（projection-schema §1.2·inner 不冻结）。壳纯渲染：仅从 body 抽 Post.id
   * 作 data-reply-id（不解析重组业务字段）。失败回灌（{req_id, error}）→ 清空抽屉（不卡）。
   * 透传形态防御：rootPost.id / replies[].id / data[].id / 顶层数组[].id 全探（兼容两 endpoint 不同壳）。
   */
  private applyReadResult(data: ReadResultData | undefined): void {
    if (!data || typeof data !== "object") return;
    if (data.error !== undefined) {
      this._replies.set([]); // 失败回灌 → 清抽屉（前端 reject 语义·不残留旧链）
      return;
    }
    // 读族 body 抽 reply postId 经纯函数 extractReplyIds（read-result-extract.ts·壳体积控制 <800 行）。
    const ids = extractReplyIds(data.body);
    this._replies.set(ids.map((replyId) => ({ replyId })));
  }

  /**
   * UC-4.1：im:channel:increment（{channel_id, increment}）→ 注册/更新 CL 区频道行。
   * 壳纯渲染：只取 channel_id 作 data-channel-id（increment 帧 data 不解析重组·留给后续 UC 按需读）。
   * 同时锚定活动频道（增量流首个真实频道胜出·send 族决定性目标）。
   */
  private applyChannelIncrement(data: ChannelIncrementData | undefined): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channel_id === "string" && data.channel_id) || "";
    if (!channelId) return;
    this.upsertChannelRow(channelId);
    if (!this._activeChannel()) this._activeChannel.set(channelId);
  }

  /**
   * UC-5.1：im:channel:created（{channel_id, channel}·建群 WS channel_created 透传）→ upsert
   * CL 区新频道行（data-channel-id 直映·壳纯渲染只持 channel_id·channel 对象不解析重组）。
   * 同时锚定活动频道（若尚未锚定·新建群即作当前会话目标）。
   */
  private applyChannelCreated(data: ChannelCreatedData | undefined): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channel_id === "string" && data.channel_id) || "";
    if (!channelId) return;
    this.upsertChannelRow(channelId);
    if (!this._activeChannel()) this._activeChannel.set(channelId);
  }

  /**
   * UC-1.10：im:channel:schedule-created（{channelId, hasSchedulePost}·WS post_schedule_created
   * 透传）→ 把该频道行 hasSchedule 标透传值（data-has-schedule-post 频道级属性·壳纯渲染）。
   * 行不存在则先 upsert（确保 data-channel-id 锚存在）。壳只透传投影 hasSchedulePost·不在 JS 合成。
   */
  private applyScheduleCreated(
    data: ChannelScheduleCreatedData | undefined,
  ): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channelId === "string" && data.channelId) || "";
    if (!channelId) return;
    this.upsertChannelRow(channelId);
    const has = data.hasSchedulePost === true;
    this._channels.update((rows) =>
      rows.map((c) =>
        c.channelId === channelId ? { ...c, hasSchedule: has } : c,
      ),
    );
  }

  /**
   * UC-4.1：im:channel:update（{channel_id}·瘦·批次结束）→ 确保该 channel 行存在（badge 回读触发位）。
   * 当前壳仅保证行存在；displayName/unread 等回读由 UC-5.4/4.2 接 channel 表回读填。
   */
  private applyChannelUpdate(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const channelId = (data as Record<string, unknown>)["channel_id"];
    if (typeof channelId === "string" && channelId) {
      this.upsertChannelRow(channelId);
    }
  }

  /** 按 channelId upsert CL 区频道行（已存在则跳过·加法式·壳纯渲染只持 channelId 直映 data-channel-id）。 */
  private upsertChannelRow(channelId: string): void {
    if (this._channels().some((c) => c.channelId === channelId)) return;
    this._channels.update((rows) => [...rows, { channelId }]);
  }

  /** 按 server id 命中行 → 标 revoked（data-revoke=1）。找不到则忽略（非本壳发的消息）。 */
  private markRevokedById(serverId: string): void {
    if (!serverId) return;
    this._rows.update((rows) =>
      rows.map((r) => (r.msgId === serverId ? { ...r, revoked: true } : r)),
    );
  }

  /** im:post:batch-updated（在线 posts_update 撤回/批量）：遍历 posts 取每行 server id `id` 标撤回。
   *  注：本壳当前 batch-updated 仅撤回路径触发（编辑 UC-1.6 不可达）；后续若引入编辑需按 post 内
   *  撤回标识细分，不可一律标撤回。 */
  private applyBatchUpdated(data: unknown): void {
    const posts = (data as { posts?: unknown } | undefined)?.posts;
    if (!Array.isArray(posts)) return;
    for (const p of posts) {
      if (!p || typeof p !== "object") continue;
      const id = (p as Record<string, unknown>)["id"];
      if (typeof id === "string") this.markRevokedById(id);
    }
  }

  /** im:post:deleted（离线 sync 撤回，fat MessageItemData）：按 msg_id 标行撤回。 */
  private applyPostDeleted(data: unknown): void {
    const d = data as Record<string, unknown> | undefined;
    const id =
      (typeof d?.["msg_id"] === "string" && (d["msg_id"] as string)) ||
      (typeof d?.["msgId"] === "string" && (d["msgId"] as string)) ||
      "";
    this.markRevokedById(id);
  }

  /**
   * 乐观上屏（helix im:post:sending 投影驱动）：插入 sending 行。
   * 字段全 snake：channel_id / temporary_id；text 取本地 pendingText（瘦投影无 text）。
   * 重复 temporary_id（重发去抖）→ 已有行则跳过，不重复插。
   */
  private applyPostSending(d: PostSendingData): void {
    const temporaryId = d.temporary_id ?? "";
    if (!temporaryId) return;
    if (this._rows().some((r) => r.temporaryId === temporaryId)) return;

    this._rows.update((rows) => [
      ...rows,
      {
        msgId: temporaryId,
        temporaryId,
        channelId: d.channel_id ?? "",
        eventSeq: null,
        sendStatus: "sending",
        readBits: "",
        text: this.pendingText.get(temporaryId) ?? "",
        type: this.pendingType.get(temporaryId) ?? "TEXT",
      },
    ]);
  }

  /**
   * echo 覆写：按 temporaryId 找乐观行 → data-msg-id 改 server id、status=sent、补 event-seq。
   * 找不到（别的设备消息 / 非本壳发的）→ 作为新行追加（server 已知形态）。
   */
  private applyMessageItem(d: MessageItemData): void {
    const temporaryId = d.temporaryId ?? "";
    const serverId = d.msg_id ?? "";
    const eventSeq = typeof d.event_seq === "number" ? d.event_seq : null;
    const readBits = this.toReadBits(d.readBits);
    // UC-1.8：从 fat 投影 props 抽快捷回复 emoji 串（命中 → data-reactions·壳纯渲染·无乐观合成）。
    const reactions = extractReactions(d.props);
    // UC-3.3：从 fat 投影 props 抽模板已收到态（props.template.userIds 非空 → data-template-received=1·
    //   壳纯渲染·无乐观合成）。post_update echo（EventKind::PostEdit）携 template patch 进 props。
    const templateReceived = extractTemplateReceived(d.props);

    // UC-1.8 post_update echo 复用既有消息（无 temporaryId 乐观行）→ 按 server id 命中行覆写
    //   reactions（emoji patch）。先试 temporaryId 锚（发送对账），再退 server id 锚（quickReply
    //   等纯 props patch 路径·复用消息无 tmp）。
    //
    // UC-1.7 转发：单出站 createPosts 的 posts[0] 携同一 temporaryId 应用到 N 目标频道 →
    //   N 条 echo 共享同 temporaryId 但 channelId 各异。若仅按 temporaryId 锚，第 2 条 echo 会
    //   覆写第 1 条（频道 A）的行 → 只剩 1 行（丢频道）。故 temporaryId 锚**须叠加 channelId 同频道**
    //   约束（消息归属特定频道·跨频道同 tmp 不应互相覆写）。echo 带 channelId 时按 (tmp, ch) 锚；
    //   不带 channelId（罕见）退回纯 tmp 锚（保持 send 既有行为·乐观行 channelId 已由 sending 投影置）。
    const echoCh = d.channelId ?? d.channel_id ?? "";
    const idx = temporaryId
      ? this._rows().findIndex(
          (r) => r.temporaryId === temporaryId && (!echoCh || !r.channelId || r.channelId === echoCh),
        )
      : serverId
        ? this._rows().findIndex((r) => r.msgId === serverId)
        : -1;

    if (idx >= 0) {
      // 覆写既有行（temporaryId 不变；quickReply patch 走 server id 锚命中既有行）
      this._rows.update((rows) => {
        const next = rows.slice();
        const prev = next[idx];
        next[idx] = {
          ...prev,
          msgId: serverId || prev.msgId,
          eventSeq,
          sendStatus: "sent",
          readBits,
          text: d.message ?? prev.text,
          type: d.type || prev.type,
          // reactions 命中则覆写（patch 只增不清·无 quickReply 的 echo 不抹既有 reactions）。
          reactions: reactions ?? prev.reactions,
          // templateReceived 命中则置位（patch 只增不清·非模板 echo 不抹既有态·UC-3.3）。
          templateReceived: templateReceived ? true : prev.templateReceived,
        };
        return next;
      });
      // echo 已对账 → 清本地暂存（pendingText/pendingType 仅用于 sending 行渲染）。
      if (temporaryId) {
        this.pendingText.delete(temporaryId);
        this.pendingType.delete(temporaryId);
      }
      return;
    }

    // 非本壳乐观行 → 追加新行（用 server 视角）
    this._rows.update((rows) => [
      ...rows,
      {
        msgId: serverId || temporaryId,
        temporaryId,
        channelId: d.channelId ?? d.channel_id ?? "",
        eventSeq,
        sendStatus: "sent",
        readBits,
        text: d.message ?? "",
        type: d.type || "TEXT",
        reactions: reactions ?? undefined,
        templateReceived: templateReceived || undefined,
      },
    ]);
  }

  /**
   * UC-2.1 切群首屏：im:messages:query_result（{channel_id, messages:[DB行]}）→ 把 Scan 出的本地
   * message 表行渲染进 ML 区消息行（data-msg-id 直映·壳纯渲染透传 DB 行·不解析重组业务）。
   *
   * messages 元素 = `SELECT * FROM message` 原始 snake 列（schema.rs IM_SCHEMA·projection-schema 行 269）：
   *  `temporary_id`（PK·乐观锚）· `id`（server msg id·空串=未对账）· `channel_id` · `type` · `message`
   *  · `read_bits` · `revoke`（0/1）。msgId 优先取 server `id`，缺则退 `temporary_id`（与 send 链 data-msg-id
   *  锚一致）。upsert：按 (temporary_id||id) 命中既有行则覆写关键 data-*（不抹乐观链已对账态·加法式），
   *  否则追加（server 视角·sendStatus=sent·已落库行非乐观）。读族无 event_seq 列 → eventSeq=null（渲染空串）。
   */
  private applyMessagesQueryResult(
    data: MessagesQueryResultData | undefined,
  ): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channel_id === "string" && data.channel_id) || "";
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (!channelId) return;
    // 切群锚定：query_result 频道作活动频道（若尚未锚定·与 queryMessages 显式 set 一致）。
    if (!this._activeChannel()) this._activeChannel.set(channelId);

    for (const raw of messages) {
      if (!raw || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      const temporaryId = (typeof m["temporary_id"] === "string" && m["temporary_id"]) || "";
      const serverId = (typeof m["id"] === "string" && m["id"]) || "";
      // server id 优先作 data-msg-id（已落库行多有 server id）；缺则退 temporary_id（与 send 链锚一致）。
      const msgId = serverId || temporaryId;
      if (!msgId) continue;
      const text = (typeof m["message"] === "string" && m["message"]) || "";
      const type = (typeof m["type"] === "string" && m["type"]) || "TEXT";
      const readBits = this.toReadBits(m["read_bits"] as string | number | undefined);
      const ch = (typeof m["channel_id"] === "string" && m["channel_id"]) || channelId;
      const revoked = m["revoke"] === 1 || m["revoke"] === true;
      // create_at（int64 毫秒·UC-2.2 上拉锚选取用·DB snake 列）；缺/坏 → undefined（不参与最旧锚）。
      const createAt =
        typeof m["create_at"] === "number" && Number.isFinite(m["create_at"])
          ? (m["create_at"] as number)
          : undefined;

      // upsert：按 temporary_id（乐观锚）或 server id 命中既有行 → 覆写关键 data-*（不抹已对账链态）。
      const idx = this._rows().findIndex(
        (r) =>
          (temporaryId && r.temporaryId === temporaryId) ||
          (serverId && r.msgId === serverId),
      );
      if (idx >= 0) {
        this._rows.update((rows) => {
          const next = rows.slice();
          const prev = next[idx];
          next[idx] = {
            ...prev,
            msgId: msgId || prev.msgId,
            channelId: ch || prev.channelId,
            text: text || prev.text,
            type: type || prev.type,
            readBits: readBits || prev.readBits,
            revoked: revoked || prev.revoked,
            createAt: createAt ?? prev.createAt,
          };
          return next;
        });
        continue;
      }

      // 新行（Scan 出的已落库历史·非乐观）→ 追加（server 视角·sendStatus=sent）。
      this._rows.update((rows) => [
        ...rows,
        {
          msgId,
          temporaryId,
          channelId: ch,
          eventSeq: null, // message 表无 event_seq 列（读族·渲染空串）
          sendStatus: "sent",
          readBits,
          text,
          type,
          revoked: revoked || undefined,
          createAt,
        },
      ]);
    }
  }

  /**
   * UC-2.2 上拉更早历史：im:messages:older_loaded（{channelId, messages, hasMore}·camelCase wire
   * Post **升序**数组）→ 把更早消息 **prepend** 进 ML 区头部（更早历史在上方·data-msg-id 直映
   * server id·壳纯渲染透传 wire Post·不解析重组）。
   *
   * messages 元素 = wire Post（camelCase·projection-schema §1.3）：`id`（server msg id）·
   * `temporaryId`·`channelId`·`createAt`（int 毫秒）·`message`·`type`。msgId 优先取 server `id`
   * （历史消息已对账·必有 server id），缺则退 temporaryId。upsert：按 (temporaryId||id) 命中既有行
   * 则覆写（去重·防多轮/与首屏重叠重复行），否则 **prepend** 到头部（升序数组逆序插入头部 → 保持
   * DOM 内升序·更早在上）。读族无 event_seq → eventSeq=null。
   */
  private applyOlderLoaded(data: OlderLoadedData | undefined): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channelId === "string" && data.channelId) || "";
    const messages = Array.isArray(data.messages) ? data.messages : [];
    if (!channelId) return;
    if (!this._activeChannel()) this._activeChannel.set(channelId);

    // 升序数组逆序遍历 + 每条 prepend 到头部 → DOM 头部保持升序（最早在最上·history 方向）。
    for (let i = messages.length - 1; i >= 0; i--) {
      const raw = messages[i];
      if (!raw || typeof raw !== "object") continue;
      const m = raw as Record<string, unknown>;
      const temporaryId =
        (typeof m["temporaryId"] === "string" && m["temporaryId"]) || "";
      const serverId = (typeof m["id"] === "string" && m["id"]) || "";
      const msgId = serverId || temporaryId;
      if (!msgId) continue;
      const text = (typeof m["message"] === "string" && m["message"]) || "";
      const type = (typeof m["type"] === "string" && m["type"]) || "TEXT";
      const ch = (typeof m["channelId"] === "string" && m["channelId"]) || channelId;
      const createAt =
        typeof m["createAt"] === "number" && Number.isFinite(m["createAt"])
          ? (m["createAt"] as number)
          : undefined;
      const readBits = this.toReadBits(m["readBits"] as string | number | undefined);

      // 去重 upsert：命中既有行（首屏已加载 / 多轮重叠）→ 覆写关键 data-*（不抹已对账链态）。
      const idx = this._rows().findIndex(
        (r) =>
          (temporaryId && r.temporaryId === temporaryId) ||
          (serverId && r.msgId === serverId),
      );
      if (idx >= 0) {
        this._rows.update((rows) => {
          const next = rows.slice();
          const prev = next[idx];
          next[idx] = {
            ...prev,
            msgId: msgId || prev.msgId,
            channelId: ch || prev.channelId,
            text: text || prev.text,
            type: type || prev.type,
            createAt: createAt ?? prev.createAt,
          };
          return next;
        });
        continue;
      }

      // 新的更早行 → prepend 到头部（history 方向·更早在上方）。
      this._rows.update((rows) => [
        {
          msgId,
          temporaryId,
          channelId: ch,
          eventSeq: null, // wire Post 无 event_seq（读族·渲染空串）
          sendStatus: "sent" as const,
          readBits,
          text,
          type,
          createAt,
        },
        ...rows,
      ]);
    }
  }

  private patchByTemp(
    temporaryId: string,
    fn: (r: MessageRow) => MessageRow,
  ): void {
    this._rows.update((rows) =>
      rows.map((r) => (r.temporaryId === temporaryId ? fn(r) : r)),
    );
  }

  private toReadBits(v: string | number | undefined): string {
    if (v === undefined || v === null) return "";
    return String(v);
  }

  /** cses-client 风格 26 位 id（@ccc ObjectId.create 同款 mattermost z-base-32 字符集）。 */
  private genTempId(): string {
    // z-base-32 charset（现网 server id 同字符集）；26×5≈130 bit 随机，会话内唯一作锚。
    const charset = "ybndrfg8ejkmcpqxot1uwisza345h769";
    let s = "";
    for (let i = 0; i < 26; i++) {
      s += charset[Math.floor(Math.random() * 32)];
    }
    return s;
  }
}
