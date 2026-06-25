import { Injectable, computed, inject, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";
import { extractReactions, extractTemplateReceived, isSystemNotice } from "./props-extract";
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
  CHANNEL_CLOSED_CHANNEL,
  CHANNEL_UPDATE_BY_POST_CHANNEL,
  ChannelCreatedData,
  ChannelClosedData,
  ChannelIncrementData,
  ChannelScheduleCreatedData,
  ChannelUpdateByPostData,
  MESSAGE_ROW_CHANNELS,
  MEMBER_NICKNAME_CHANNEL,
  MemberNicknameData,
  MEMBER_UPDATED_CHANNEL,
  MemberUpdatedData,
  MESSAGES_QUERY_RESULT_CHANNEL,
  MessageItemData,
  MessagesQueryResultData,
  OLDER_LOADED_CHANNEL,
  OlderLoadedData,
  POST_SENDING_CHANNEL,
  PostSendingData,
  READ_RESULT_CHANNEL,
  ReadResultData,
  TODO_UPDATED_CHANNEL,
  TodoUpdatedData,
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

  /**
   * UC-4.2 按需 sync notify：触发引擎重连 → 重跑 hello 握手 → 重检 per-channel needSync gap →
   * 对落后频道自驱 `channel/sync/notify`（出站 body {cursors:[{channelId, fromSeq}]}）→ server
   * 回放离线区间事件 → im:post:received（增量行）+ im:channel:update-by-post（badge +1）+ message
   * 落库 + cursor 跳空洞。薄壳只 invoke im_sync_channels（引擎 emit im:net:reconnect_requested →
   * driver 重连·业务全在 helix-im·壳不臆造 sync 逻辑）。非 Tauri / 命令缺失 → 静默（dev 浏览器不卡）。
   */
  syncChannels(): void {
    this.bridge.invoke<void>("im_sync_channels").catch(() => {
      // 非 Tauri / 命令缺失 → 忽略（dev 单独调 UI 不卡）
    });
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
   * UC-11.1 维护公司大群：invoke('im_team_upsert', {displayName, memberIds})。
   *
   * **壳不臆造 body**：teamId / 自身 userId（owner + CREATOR）+ CreateChannelSpecifyOwner 整形态
   * 由 Rust 命令从 profile 单一真源拼装（src-tauri commands.rs im_team_upsert·出站 teams/upsert）。
   * 壳只供 displayName + 其他成员 memberIds。公司大群（建群路径·id 缺省）由 helix
   * `im:channel:created` 投影驱动 upsert CL 区新行（壳纯渲染·复用 applyChannelCreated 同 UC-5.1）。
   * 非 Tauri / 命令缺失 → 静默（dev 浏览器单独调 UI 不卡）。
   */
  async teamUpsert(displayName: string, memberIds: string[]): Promise<void> {
    const name = displayName.trim();
    if (!name) return;
    try {
      await this.bridge.invoke<void>("im_team_upsert", {
        displayName: name,
        memberIds,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（大群行靠投影驱动·无乐观合成）。
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
   * UC-5.4 群属性修改（改群名）：invoke('im_channel_change_display_name', {channelId, displayName}）。
   *
   * **壳不臆造 body**：endpoint + body 形态由 Rust/helix-im 兜底（commands.rs
   * im_channel_change_display_name → outbound/channel_change_dedicated.rs → POST
   * channel/change/displayName {id, displayName}）。壳只供 channelId（目标频道）+ displayName（新群名）。
   * 群行属性由 helix `im:channel:update`（thin·{channel_id}）信号触发回读 channel 行 → CL 区
   * data-channel-display-name 更新（壳纯渲染·无乐观合成）。非 Tauri / 命令缺失 → 静默。
   */
  async changeChannelDisplayName(channelId: string, displayName: string): Promise<void> {
    const ch = channelId.trim();
    const name = displayName.trim();
    if (!ch || !name) return;
    try {
      await this.bridge.invoke<void>("im_channel_change_display_name", {
        channelId: ch,
        displayName: name,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（群属性靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-5.4 群属性修改（改公告）：invoke('im_channel_change_notice', {channelId, noticeText}）。
   *
   * **壳不臆造 body**：notice map 包装 + endpoint 由 Rust/helix-im 兜底（commands.rs
   * im_channel_change_notice → outbound/channel_change.rs → POST channel/change/notice
   * {id, notice:{text}}）。壳只供 channelId（目标频道）+ noticeText（公告文本）。
   * 群行属性由 helix `im:channel:update`（thin）信号触发回读 → CL 区 data-channel-notice 更新。
   * 非 Tauri / 命令缺失 → 静默。
   */
  async changeChannelNotice(channelId: string, noticeText: string): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    try {
      await this.bridge.invoke<void>("im_channel_change_notice", {
        channelId: ch,
        noticeText,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（群属性靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-5.5 频道置顶（per-member 对话置顶）：invoke('im_channel_change_top', {channelId, top}）。
   *
   * **壳不臆造 body**：endpoint + camelCase body 由 Rust/helix-im 兜底（commands.rs
   * im_channel_change_top → outbound/channel_change.rs ChangeTopCommand → POST channel/change/top
   * {channelId, top}）。壳只供 channelId（目标频道）+ top（true=置顶 / false=取消）。
   * WS 回 update_channel（channelIsTop→is_top 列 PATCH）→ ④ channel 表 PATCH + ② im:channel:update
   * （thin）触发 dialogList 重查 → CL 区行 data-channel-top 回读（壳纯渲染只透传 channel.is_top 列·
   * 不在 JS 合成置顶态）。非 Tauri / 命令缺失 → 静默。
   */
  async changeChannelTop(channelId: string, top: boolean): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    try {
      await this.bridge.invoke<void>("im_channel_change_top", {
        channelId: ch,
        top,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（置顶态靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-6.3 改群昵称：invoke('im_update_member_nickname', {channelId, userId?, nickname}）。
   *
   * **壳不臆造 body**：endpoint + camelCase body（{channelId, nickname[, userId]}）由 Rust/helix-im
   * 兜底（commands.rs im_update_member_nickname → outbound/channel_existing.rs UpdateNicknameCommand →
   * POST channel/member/change/nickname）。壳只供 channelId（目标频道）+ userId（被改昵称的成员·
   * 缺省则 Go 侧用 session 自身）+ nickname（新昵称·空 → Go 侧清空）。WS 回
   * update_channel_member_nickName（broadcast 到 channelId·{channelId, userId, nickName}）→ ④
   * channel_member 表 BatchUpsert（复合 PK·仅改 nick_name 列）+ ② im:channel:memberNickname →
   * applyMemberNickname 把 MB 区成员行 data-nickname 刷新（壳纯渲染只透传投影 nickName·无乐观合成）。
   * 非 Tauri / 命令缺失 → 静默。
   */
  async changeMemberNickname(
    channelId: string,
    userId: string,
    nickname: string,
  ): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    const uid = userId.trim();
    try {
      await this.bridge.invoke<void>("im_update_member_nickname", {
        channelId: ch,
        userId: uid || undefined,
        nickname,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（昵称靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-6.1 拉/踢人：invoke('im_channel_member_change', {channelId, joinUserIds?, leaveUserIds?}）。
   *
   * **壳不臆造 body 形态**：endpoint + camelCase body（{channelId, joinUsers/leaveUsers:[{id,teamId,role}]}）
   * 由 Rust（commands.rs im_channel_member_change·teamId 取 identity·真源 §5）→ helix-im
   * outbound/channel_existing.rs MemberChangeCommand 透传到 POST channel/member/change。壳只供 channelId
   * （目标频道）+ joinUserIds（拉进群成员 userId）+ leaveUserIds（踢出群成员 userId）。WS 回
   * channel_member_update（broadcast 到 channelId·channel 全量帧含 memberChange.join/leave）→ ④
   * channel_member 表 BatchUpsert（join）/ BatchDelete（leave）+ ② im:channel:member-updated →
   * applyMemberUpdated 把 MB 区成员行刷新（壳纯渲染只透传投影成员集·无乐观合成）。无 channelId → 不发。
   * 非 Tauri / 命令缺失 → 静默。
   */
  async changeMember(
    channelId: string,
    joinUserIds: string[],
    leaveUserIds: string[],
  ): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    const joins = joinUserIds.filter((u) => !!u.trim());
    const leaves = leaveUserIds.filter((u) => !!u.trim());
    if (joins.length === 0 && leaves.length === 0) return;
    try {
      await this.bridge.invoke<void>("im_channel_member_change", {
        channelId: ch,
        joinUserIds: joins.length ? joins : undefined,
        leaveUserIds: leaves.length ? leaves : undefined,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（成员靠投影驱动·无乐观合成）。
    }
  }

  /**
   * UC-6.2 设/撤管理员：invoke('im_channel_set_manger', {channelId, userId, set}）。
   *
   * **壳不臆造 body 形态**：endpoint（channel/add/manger | channel/remove/manger）+ camelCase body
   * （{channelId, users:[{id,name,role,teamId}]}）由 Rust（commands.rs im_channel_set_manger·teamId
   * 取 identity·真源 §19/§20）→ helix-im outbound/channel_change_dedicated.rs AddMangerCommand /
   * RemoveMangerCommand 兑现。壳只供 channelId（目标频道）+ userId（被设/撤的成员）+ set（true=设·false=撤）。
   *
   * **DOM data-admin 乐观本地刷（结构性例外·非投影驱动）**：add/remove manger 后端 WS 已注释（仅
   * GrpcInvoke），操作者实际收 `channel_member_role_updated`（helix graceful no-op·角色态由后续全量
   * `channel_member_update` 广播帧覆盖·须第二账号触发·见 L2 #45）。故 L1 单账号 ② emit_channel_member_updated
   * 不到达·data-admin 无投影源 → 本壳在出站成功后乐观把该成员行 admin 标置为目标态（set ? true : false）·
   * 让 MB 区成员行 data-admin 即时反映用户操作（L1 仅 ① 出站契约可证·data-admin 权威态由 L2 #45 广播帧对账）。
   * 无 channelId / userId → 不发。非 Tauri / 命令缺失 → 出站静默但仍乐观刷（UI 反馈不依赖出站确认）。
   */
  async setManger(
    channelId: string,
    userId: string,
    set: boolean,
  ): Promise<void> {
    const ch = channelId.trim();
    const uid = userId.trim();
    if (!ch || !uid) return;
    try {
      await this.bridge.invoke<void>("im_channel_set_manger", {
        channelId: ch,
        userId: uid,
        set,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（仍乐观刷 data-admin 供 UI 反馈）。
    }
    // 乐观刷 MB 区该成员行 data-admin（结构性例外·见 doc·权威态 L2 #45 广播帧对账）。
    let found = false;
    this._members.update((rows) => {
      const next = rows.map((m) => {
        if (m.memberId !== uid) return m;
        found = true;
        return { ...m, admin: set };
      });
      if (found) return next;
      // 成员行缺 → upsert（让 data-admin 可读·data-member-id=userId）。
      return [...next, { memberId: uid, admin: set }];
    });
  }

  /**
   * UC-5.3 关闭/退出群：invoke('im_channel_close', {channelId}）。
   *
   * **壳不臆造 body**：endpoint + camelCase body 由 Rust/helix-im 兜底（commands.rs
   * im_channel_close → outbound/channel_existing.rs ChannelCloseCommand → POST channel/close
   * {channelId}）。壳只供 channelId（目标频道）。WS 回 channel_close（broadcast 到 channelId·
   * 自己也收）→ ④ channel 表 batch_update（delete_at + is_active=0）+ ② im:channel:closed
   * （{channelId, deleteAt}）→ applyChannelClosed 把 CL 区行移除（data-channel-id 消失·壳纯渲染
   * 只消费投影删行·无乐观合成）。非 Tauri / 命令缺失 → 静默。
   */
  async closeChannel(channelId: string): Promise<void> {
    const ch = channelId.trim();
    if (!ch) return;
    try {
      await this.bridge.invoke<void>("im_channel_close", { channelId: ch });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（软删态靠投影驱动·无乐观合成）。
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

  /**
   * UC-6.4 成员快照/全量·分支 A（按 channelIds 拉成员·自愈）：invoke('im_members_by_ids',
   * {channelIds, reqId}）。
   *
   * **读族 request-response**：HTTP 200 响应体（map[channelId][]IdWithCompanyExt）即数据 → helix
   * `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。endpoint
   * channels/member/byIds + wire body camelCase 化（channelIds）全在 helix-im（MembersByIdsCommand）。
   * 壳只供 channelIds（≥1·≤200）+ reqId（前端 bridge 生成·回灌关联）。返 reqId 供 e2e 等回灌关联。
   */
  async loadMembersByIds(
    channelIds: string[],
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const ids = channelIds.filter((c) => !!c && c.trim());
    if (ids.length === 0) return rid;
    try {
      await this.bridge.invoke<void>("im_members_by_ids", {
        channelIds: ids,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（成员靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-4.5 陌生 channel 兜底（进入未加载过的频道触发单频道增量同步）：invoke('im_ensure_channel_loaded',
   * {channelId, reqId}）。
   *
   * **读族 request-response**：load/incrementByChannelId 是读命令（is_read=true·HTTP 直返单条
   * *IncrementChannel·不推送）→ helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id,
   * body}`（body=该 channel 增量帧·含 lastEventSeq/mentionList/urgentPostList·透传不冻结）。endpoint
   * channel/load/incrementByChannelId + wire body `{channelId}` camelCase 化全在 helix-im
   * （LoadIncrementByChannelIdCommand）。壳只供 channelId（陌生频道 id）+ reqId（前端 bridge 生成·回灌
   * 关联）。返 reqId 供 caller/e2e 等回灌关联。无 channelId → 不发·仍返 rid（一致返回类型）。
   */
  async ensureChannelLoaded(
    channelId: string,
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const ch = channelId.trim();
    if (!ch) return rid;
    try {
      await this.bridge.invoke<void>("im_ensure_channel_loaded", {
        channelId: ch,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（增量靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-6.4 成员快照/全量·分支 B（时间范围成员快照）：invoke('im_member_snapshot',
   * {channelId, startTime, endTime, reqId}）。
   *
   * 同 loadMembersByIds 走 `im:read:result{req_id, body}` 透传回灌（body=[]GetMembersSnapshotDto）。
   * endpoint channel/member/snapshot + wire body camelCase 化（channelId/startTime/endTime·int64
   * 毫秒）全在 helix-im（MemberSnapshotCommand）。壳只供 channelId + 时间窗 + reqId。
   */
  async loadMemberSnapshot(
    channelId: string,
    startTime: number,
    endTime: number,
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const ch = channelId.trim();
    if (!ch) return rid;
    try {
      await this.bridge.invoke<void>("im_member_snapshot", {
        channelId: ch,
        startTime,
        endTime,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（快照靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-5.8 条件查频道（条件分页查询·读族）：invoke('im_channel_query',
   * {condition, pageNumber, pageSize, offset, reqId}）。
   *
   * **读族 request-response**（helix 注册 is_read=true·无 WS 回声）：HTTP 200 响应体（频道查询结果·
   * 透传 []*Channel）经 helix `read_relay::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。
   * endpoint channel/query + wire body（condition map 平铺顶层 + pageNumber/pageSize/offset 同层 merge·
   * 匿名 struct embed Channel + PageOpts）全 camelCase 化在 helix-im（ChannelQueryCommand）。壳只供
   * condition（前端构造的查询条件 map·已 camelCase）+ 分页（缺省 0）+ reqId（前端 bridge 生成·回灌关联）。
   * 返 reqId 供 caller/e2e 等回灌关联。
   */
  async queryChannels(
    condition: Record<string, unknown> = {},
    pageNumber = 0,
    pageSize = 0,
    offset = 0,
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    try {
      await this.bridge.invoke<void>("im_channel_query", {
        condition,
        pageNumber,
        pageSize,
        offset,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（结果靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-9.x 书签·收藏消息：invoke('im_bookmark_create', {channelId, postIds, reqId}）。
   *
   * **读族 request-response**（helix 注册 is_read=true·无 WS 回声）：HTTP 200 响应体（CommonRes 无
   * data）经 helix `query::emit_read_result` 透传回灌 `im:read:result{req_id, body}`。endpoint
   * post/bookmark/create + wire body camelCase 化（channelId/userId/postIds）+ userId（身份单一真源·
   * AppState.identity）全在 helix-im / 壳后端（commands.rs im_bookmark_create → outbound
   * posts_read_ext.rs BookmarkCreateCommand）。壳前端只供 channelId + postIds（被收藏消息 server id 列表）
   * + reqId。返 reqId 供 e2e 等回灌关联。
   */
  async createBookmark(
    channelId: string,
    postIds: string[],
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const ch = channelId.trim();
    const ids = postIds.filter((p) => !!p && p.trim());
    if (!ch || ids.length === 0) return rid;
    try {
      await this.bridge.invoke<void>("im_bookmark_create", {
        channelId: ch,
        postIds: ids,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（书签靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-9.x 书签·取消收藏：invoke('im_bookmark_delete', {postId, reqId}）。
   *
   * 同 createBookmark 走 `im:read:result{req_id, body}` 透传回灌。endpoint post/bookmark/delete +
   * wire body camelCase 化（userId/postId）+ userId（AppState.identity）全在 helix-im / 壳后端
   * （BookmarkDeleteCommand）。壳前端只供 postId（被取消收藏的消息 server id）+ reqId。
   */
  async deleteBookmark(postId: string, reqId?: string): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const post = postId.trim();
    if (!post) return rid;
    try {
      await this.bridge.invoke<void>("im_bookmark_delete", {
        postId: post,
        reqId: rid,
      });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（书签靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-9.x 书签·加载收藏列表（读族·分页）：invoke('im_bookmark_load', {channelId, pageSize?,
   * pageNumber?, offset?, reqId}）。
   *
   * 同上走 `im:read:result{req_id, body}` 透传回灌（body=posts 收藏消息列表）。endpoint
   * post/bookmark/load + wire body camelCase 化（channelId/userId + 扁平 PageOpts）+ userId
   * （AppState.identity）全在 helix-im / 壳后端（BookmarkLoadCommand）。壳前端只供 channelId + 可选
   * 分页 + reqId。返 reqId 供 e2e 等回灌关联。
   */
  async loadBookmarks(
    channelId: string,
    pageSize?: number,
    pageNumber?: number,
    offset?: number,
    reqId?: string,
  ): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const ch = channelId.trim();
    if (!ch) return rid;
    const args: Record<string, unknown> = { channelId: ch, reqId: rid };
    if (pageSize != null) args["pageSize"] = pageSize;
    if (pageNumber != null) args["pageNumber"] = pageNumber;
    if (offset != null) args["offset"] = offset;
    try {
      await this.bridge.invoke<void>("im_bookmark_load", args);
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（书签列表靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  // ── UC-8.x 投票 CRUD（vote/score 第二网关 :3399·partials/6 集合八）──────────────
  // 写族（create/do/close/delete·is_read=false·fire-and-forget·数据走 server WS post_updated 回声）+
  // 读族（read·is_read=true·im:read:result{req_id, body} 透传回灌）。壳前端只组 wire 字段 + 入 invoke；
  // 出站 body / 落库 message.props / WS 回声全在 helix-im（VoteXxxCommand）。

  /**
   * UC-8.x 投票·发起（写族）：invoke('im_vote_create', {fields})。
   * fields = camelCase wire 字段集（fromUserId/fromUserName/title/content/votes/isReal/finishTime/
   * options[]/orgIds[]/source? 等·真源 partials/6 集合八 §createVote·helix VoteCreateCommand 整 args 透传）。
   * fire-and-forget（无读族回灌）→ 不带 reqId（防泄漏进透传 wire body）。
   */
  async createVote(fields: Record<string, unknown>): Promise<void> {
    if (!fields || Object.keys(fields).length === 0) return;
    try {
      await this.bridge.invoke<void>("im_vote_create", { fields });
    } catch {
      // 出站失败（非 Tauri dev 环境也会走这里）→ 静默（投票卡靠 server WS post_updated 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 投票·提交（写族）：invoke('im_vote_do', {id, indexes, postId?}）。
   * id=投票卡 id·indexes=选项序号字符串数组·postId 可选（真源 partials/6 §vote）。
   */
  async submitVote(id: string, indexes: string[], postId?: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    const args: Record<string, unknown> = { id: vid, indexes };
    const p = (postId ?? "").trim();
    if (p) args["postId"] = p;
    try {
      await this.bridge.invoke<void>("im_vote_do", args);
    } catch {
      // 出站失败 → 静默（投票态靠 server WS 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 投票·读详情（读族）：invoke('im_vote_read', {id, reqId}）。
   * HTTP 响应体经 helix query::emit_read_result 透传回灌 im:read:result{req_id, body}。返 reqId 供 e2e 关联。
   */
  async readVote(id: string, reqId?: string): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const vid = id.trim();
    if (!vid) return rid;
    try {
      await this.bridge.invoke<void>("im_vote_read", { id: vid, reqId: rid });
    } catch {
      // 出站失败 → 静默（投票详情靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-8.x 投票·截止（写族）：invoke('im_vote_close', {id}）。真源 partials/6 §closeVote。
   */
  async closeVote(id: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    try {
      await this.bridge.invoke<void>("im_vote_close", { id: vid });
    } catch {
      // 出站失败 → 静默（投票截止态靠 server WS 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 投票·删除（写族）：invoke('im_vote_delete', {id}）。真源 partials/6 §deleteVote。
   */
  async deleteVote(id: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    try {
      await this.bridge.invoke<void>("im_vote_delete", { id: vid });
    } catch {
      // 出站失败 → 静默（投票删除态靠 server WS 回声驱动·无乐观合成）。
    }
  }

  // ── UC-8.x 平均分 CRUD（vote/score 第二网关·partials/6 集合八）──────────────
  // 出站 body / 落库 message.props / WS 回声全在 helix-im（AverageXxxCommand）。同投票族纪律。

  /**
   * UC-8.x 平均分·发布（写族）：invoke('im_average_publish', {fields})。
   * fields = camelCase wire 字段集（title/content/maxScore/minScore/isDelMaxMin/isAnonymous/cutoff/
   * members[]/hasDecimal?/decimalPlaces?/source? 等·真源 partials/6 集合八 §average/publish·
   * helix AveragePublishCommand 整 args 透传）。fire-and-forget → 不带 reqId（防泄漏进透传 wire body）。
   */
  async publishAverage(fields: Record<string, unknown>): Promise<void> {
    if (!fields || Object.keys(fields).length === 0) return;
    try {
      await this.bridge.invoke<void>("im_average_publish", { fields });
    } catch {
      // 出站失败 → 静默（平均分卡靠 server WS post_updated 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 平均分·提交评分（写族）：invoke('im_average_attend', {id, score, postId?}）。
   * id=平均分卡 id·score=数值评分·postId 可选（真源 partials/6 §average/attend）。
   */
  async attendAverage(id: string, score: number, postId?: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    const args: Record<string, unknown> = { id: vid, score };
    const p = (postId ?? "").trim();
    if (p) args["postId"] = p;
    try {
      await this.bridge.invoke<void>("im_average_attend", args);
    } catch {
      // 出站失败 → 静默（评分态靠 server WS 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 平均分·读详情（读族）：invoke('im_average_read', {id, reqId}）。
   * HTTP 响应体经 helix query::emit_read_result 透传回灌 im:read:result{req_id, body}。返 reqId 供 e2e 关联。
   */
  async readAverage(id: string, reqId?: string): Promise<string> {
    const rid = (reqId ?? this.genReqId()).trim();
    const vid = id.trim();
    if (!vid) return rid;
    try {
      await this.bridge.invoke<void>("im_average_read", { id: vid, reqId: rid });
    } catch {
      // 出站失败 → 静默（平均分详情靠 im:read:result 投影驱动·无乐观合成）。
    }
    return rid;
  }

  /**
   * UC-8.x 平均分·截止（写族）：invoke('im_average_close', {id, postId?}）。真源 partials/6 §average/close。
   */
  async closeAverage(id: string, postId?: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    const args: Record<string, unknown> = { id: vid };
    const p = (postId ?? "").trim();
    if (p) args["postId"] = p;
    try {
      await this.bridge.invoke<void>("im_average_close", args);
    } catch {
      // 出站失败 → 静默（平均分截止态靠 server WS 回声驱动·无乐观合成）。
    }
  }

  /**
   * UC-8.x 平均分·删除（写族）：invoke('im_average_delete', {id}）。真源 partials/6 §average/delete。
   */
  async deleteAverage(id: string): Promise<void> {
    const vid = id.trim();
    if (!vid) return;
    try {
      await this.bridge.invoke<void>("im_average_delete", { id: vid });
    } catch {
      // 出站失败 → 静默（平均分删除态靠 server WS 回声驱动·无乐观合成）。
    }
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
    // UC-5.3 关闭/退出群：im:channel:closed（{channelId, deleteAt}·WS channel_close 透传·独立
    // broadcast 推送·非批次结束 thin）→ 把该频道行从 CL 区移除（data-channel-id 消失·壳纯渲染只
    // 消费投影删行·不在 JS 臆造软删态）。先于 message-row 分支（channel-row 信号·非 fat 集）。
    if (channel === CHANNEL_CLOSED_CHANNEL) {
      this.applyChannelClosed(env.payload?.data as ChannelClosedData | undefined);
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
    // UC-4.2 按需 sync notify：im:channel:update-by-post（{channel_id, event_seq, msg_id}·瘦·sync
    // 回放每条可见 type1 新消息触发·badge 触发位）→ 把该频道行 unread badge +1（data-unread 累加·
    // channel-row 级未读计数·壳纯渲染只透传投影信号累加·不在 JS 解析 increment 帧重组业务）。增量
    // 消息行追加由配对的 fat im:post:received（MESSAGE_ROW_CHANNELS 分支·applyMessageItem）驱动。
    // 先于 message-row 分支（channel-row 信号·非 message_item_data fat 集）。
    if (channel === CHANNEL_UPDATE_BY_POST_CHANNEL) {
      this.applyChannelUpdateByPost(
        env.payload?.data as ChannelUpdateByPostData | undefined,
      );
      return;
    }
    // UC-6.3 改群昵称：im:channel:memberNickname（{channelId, userId, nickName}·WS
    // update_channel_member_nickName 透传·broadcast 到 channelId）→ 把 MB 区该成员行 nickname 刷成
    // nickName（data-nickname 回读·壳纯渲染透传投影 nickName·不在 JS 合成）；成员行缺则 upsert
    // （投影驱动成员入列·data-member-id=userId）。先于 message-row 分支（member-row 信号·非 fat 集）。
    if (channel === MEMBER_NICKNAME_CHANNEL) {
      this.applyMemberNickname(env.payload?.data as MemberNicknameData | undefined);
      return;
    }
    // UC-6.1 拉/踢人：im:channel:member-updated（{channel_id, channel}·WS channel_member_update 透传帧）→
    // 从 channel 对象成员源（memberChange.join[] + 四源 members[]）upsert MB 区成员行 + memberChange.leave[]
    // 移除离场行 + 刷 data-members 在册串（壳纯渲染只透传投影成员 id·不在 JS 合成）。先于 message-row 分支
    // （member-row 信号·非 message_item_data fat 集）。
    if (channel === MEMBER_UPDATED_CHANNEL) {
      this.applyMemberUpdated(env.payload?.data as MemberUpdatedData | undefined);
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

    // UC-10.1 待办列表：im:todo:updated（{items:[{id, channel, post, type, canDel}]}·内核自驱·
    // hello 收尾 global increment-end → queryTodoList HTTP 回报装配）→ 把 items 渲染进 AX todo-panel
    // （data-todo-id 直映 item.id·壳纯渲染透传投影 item·不解析重组业务·不在 JS 合成）。外层 {items}
    // 包裹·无顶层 channel_id（projection-only·无落库）→ 须先于 captureActiveChannel/message-row 分支。
    if (channel === TODO_UPDATED_CHANNEL) {
      this.applyTodoUpdated(env.payload?.data as TodoUpdatedData | undefined);
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
    // UC-5.4 群属性回读：channelUpdate 系统 post（props.type=channelUpdate）→ 刷 channel 行属性
    // （data-channel-display-name/-notice）。注：channelUpdate post 本身 type=NOTICE/userId=SYS =
    // **系统通知消息**（NOTICE_TYPES·full-map partials/7 §3）→ 现网前端既刷群头属性又在消息列表
    // 渲染系统提示行（"X 改了群名"）。故**不早退**：先刷频道属性·再落 applyMessageItem 渲染系统
    // 消息行（UC-10.2 data-system-notice·isSystemNotice 判 NOTICE）。两行为共存·不互斥（UC-5.4
    // 仍读频道行属性·UC-10.2 读消息行系统标·加法式不回退）。
    this.applyChannelUpdatePost(data);
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
    const ids: string[] = [];
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const row = r as Record<string, unknown>;
      const id = row["id"];
      if (typeof id !== "string" || !id) continue;
      ids.push(id);
      // UC-5.4 群属性回读：dialogList 行 = channel 表行（display_name / notice 列·patch.rs
      // collect_present 白名单）。改群名后 im:channel:update（thin）触发本 dialog 重查 → fat
      // dialogList 携新 display_name → 把 CL 区行 displayName/notice 刷新（data-channel-display-name/
      // -notice 回读·壳纯渲染只透传 channel 列·不在 JS 合成）。notice 列形态透传（JSON/字符串兼容）。
      // UC-5.5 置顶回读：channel 表 is_top 列（INTEGER·SELECT * 原样透传·1=置顶/0=否）→ data-channel-top。
      // 改置顶后 im:channel:update（thin·increment_channel_end 触发）→ 本 dialog 重查 → fat dialogList
      // 携新 is_top → 把 CL 区行 top 刷新（壳纯渲染只透传 channel 列·不在 JS 合成置顶态）。
      this.upsertChannelRowFields(id, {
        displayName:
          typeof row["display_name"] === "string"
            ? (row["display_name"] as string)
            : undefined,
        notice: this.normalizeNotice(row["notice"]),
        top: this.normalizeIsTop(row["is_top"]),
      });
    }
    if (!this._activeChannel() && ids.length > 0) this._activeChannel.set(ids[0]);
  }

  /** notice 列透传归一：channel 表 notice 列可能是 JSON 字符串 `{"text":".."}` 或纯文本。
   *  壳纯渲染只把它落成 data-channel-notice 可比对的字符串（出站 body 真源是 `{text}` map·
   *  ④ 落库列存序列化字符串）。非字符串/空 → undefined（行不带该属性）。 */
  private normalizeNotice(v: unknown): string | undefined {
    if (typeof v !== "string" || v.length === 0) return undefined;
    return v;
  }

  /** is_top 列透传归一：channel 表 is_top 列是 INTEGER（SELECT * 原样透传·1=置顶/0=否·SQLite
   *  也可能回 number/string/bool）。壳纯渲染只把它落成布尔 → data-channel-top（true→'1'·false→无属性）。
   *  非真值/缺 → undefined（行不带置顶态·加法式不覆盖既有值时由 upsert 跳过 undefined）。 */
  private normalizeIsTop(v: unknown): boolean | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") return v === "1" || v.toLowerCase() === "true";
    return undefined;
  }

  /** 按 channelId 补/更新行字段（加法式·仅覆盖传入的非 undefined 字段·行不存在则先建）。 */
  private upsertChannelRowFields(
    channelId: string,
    fields: Partial<ChannelRow>,
  ): void {
    this.upsertChannelRow(channelId);
    this._channels.update((rows) =>
      rows.map((c) => {
        if (c.channelId !== channelId) return c;
        const next = { ...c };
        for (const [k, val] of Object.entries(fields)) {
          if (val !== undefined) (next as Record<string, unknown>)[k] = val;
        }
        return next;
      }),
    );
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
   * UC-10.1：im:todo:updated（{items:[{id, channel, post, type, canDel}]}·内核自驱·queryTodoList
   * HTTP 回报装配）→ 把 items 渲染进 AX todo-panel（data-todo-id/-type/-can-del 直映）。壳纯渲染：
   * 只从每个 item 抽 id（必填·渲染锚）+ type/canDel（可选·展示属性）·channel/post 透传对象不解析重组。
   * items=[]（status≠SUCCESS/结构缺失）→ 清空待办列表（前端无害刷新·不残留旧待办·不挂起）。
   */
  private applyTodoUpdated(data: TodoUpdatedData | undefined): void {
    if (!data || typeof data !== "object") return;
    const items = Array.isArray(data.items) ? data.items : [];
    this._todos.set(
      items
        .filter((it) => it && typeof it === "object" && typeof it.id === "string" && it.id !== "")
        .map((it) => ({
          todoId: it.id,
          todoType: typeof it.type === "string" ? it.type : undefined,
          canDel: it.canDel === true,
        })),
    );
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
   * UC-5.3：im:channel:closed（{channelId, deleteAt}·WS channel_close 透传·独立 broadcast）→
   * 把该频道行从 CL 区移除（data-channel-id 消失·壳纯渲染只消费投影删行·不在 JS 臆造软删态）。
   * 软删权威在 DB channel 表（delete_at + is_active=0 列）·壳层 CL 区只删行渲染·若该行是当前
   * activeChannel 则清空 activeChannel（无活动会话·避免悬挂指向已关闭群）。
   */
  private applyChannelClosed(data: ChannelClosedData | undefined): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channelId === "string" && data.channelId) || "";
    if (!channelId) return;
    this._channels.update((rows) => rows.filter((c) => c.channelId !== channelId));
    if (this._activeChannel() === channelId) this._activeChannel.set("");
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
   * UC-4.2：im:channel:update-by-post（{channel_id, event_seq, msg_id}·瘦·sync 回放每条可见 type1
   * 新消息触发·badge 触发位）→ 把该频道行 unread badge +1（data-unread 累加·channel-row 级未读
   * 计数）。壳纯渲染：每条 update-by-post 信号即未读 +1（投影驱动累加·不在 JS 解析 increment 帧/
   * unreadCount 重组业务·与 fat im:post:received 配对：后者驱动 ML 增量行追加·本者驱动 CL badge）。
   * channel_id 缺 → noop（无定点目标·守边界零信任·snake 信号锚）。行不存在则先 upsert 锚 data-channel-id。
   */
  private applyChannelUpdateByPost(
    data: ChannelUpdateByPostData | undefined,
  ): void {
    if (!data || typeof data !== "object") return;
    const channelId =
      (typeof data.channel_id === "string" && data.channel_id) || "";
    if (!channelId) return;
    this.upsertChannelRow(channelId);
    this._channels.update((rows) =>
      rows.map((c) =>
        c.channelId === channelId
          ? { ...c, unread: (c.unread ?? 0) + 1 }
          : c,
      ),
    );
  }

  /**
   * UC-6.3：im:channel:memberNickname（{channelId, userId, nickName}·WS update_channel_member_nickName
   * 透传·broadcast 到 channelId）→ 把 MB 区该成员行 nickname 刷成 nickName（data-nickname 回读·
   * 壳纯渲染只透传投影 nickName·不在 JS 合成）。成员行缺则 upsert（投影驱动成员入列·data-member-id=
   * userId）——投影是该成员昵称的权威产出者（WS handler 复合 PK upsert channel_member·缺行插占位）。
   * userId 缺 → noop（无定点目标·守边界零信任）。
   */
  private applyMemberNickname(data: MemberNicknameData | undefined): void {
    if (!data || typeof data !== "object") return;
    const userId =
      (typeof data.userId === "string" && data.userId) || "";
    if (!userId) return; // 无定点成员 → noop（与 helix WS handler 三键缺一 noop 一致）
    const nickName = typeof data.nickName === "string" ? data.nickName : "";
    let found = false;
    this._members.update((rows) => {
      const next = rows.map((m) => {
        if (m.memberId !== userId) return m;
        found = true;
        return { ...m, nickname: nickName };
      });
      if (found) return next;
      // 成员行缺 → upsert（投影驱动成员入列·data-member-id=userId·data-nickname=nickName）。
      return [...next, { memberId: userId, nickname: nickName }];
    });
  }

  /**
   * UC-6.1：im:channel:member-updated（{channel_id, channel}·WS channel_member_update 透传帧·broadcast
   * 到 channelId）→ 从 channel 对象成员源 upsert/移除 MB 区成员行 + 刷 data-members 在册串。
   *
   * channel 是后端全量帧（透传不解析重组）·成员源与 helix channel_write::collect_members 同口径：
   *   - 在册成员 = memberChange.join[] + 四源 members[]/adminUsers[]/boss[]/owner（各取 id/userId）。
   *   - 离场成员 = memberChange.leave[]（移除对应行）。
   * 壳纯渲染只透传投影成员 id（不在 JS 臆造成员关系·权威在 DB channel_member 复合 PK upsert/delete）。
   * data-members = MB 区当前在册成员 id 升序逗号串（回读锚·拉进的 userId 必现·踢出的必消失·守可证伪）。
   */
  private applyMemberUpdated(data: MemberUpdatedData | undefined): void {
    if (!data || typeof data !== "object") return;
    const channel = data.channel;
    if (!channel || typeof channel !== "object") return;
    const ch = channel as Record<string, unknown>;

    // 收集应在册成员 id（memberChange.join + 四源·与 helix collect_members 同口径·只取 id 不重组）。
    const joinIds = this.extractMemberIds(this.memberChangeField(ch, "join"));
    const sourceIds = [
      ...joinIds,
      ...this.extractMemberIds(ch["members"]),
      ...this.extractMemberIds(ch["adminUsers"]),
      ...this.extractMemberIds(ch["boss"]),
      ...this.extractMemberIds(ch["owner"] ? [ch["owner"]] : undefined),
    ];
    const leaveIds = new Set(
      this.extractMemberIds(this.memberChangeField(ch, "leave")),
    );

    this._members.update((rows) => {
      const byId = new Map(rows.map((m) => [m.memberId, m] as const));
      for (const id of sourceIds) {
        if (!id || leaveIds.has(id)) continue;
        if (!byId.has(id)) byId.set(id, { memberId: id });
      }
      for (const id of leaveIds) byId.delete(id);
      return [...byId.values()];
    });

    // data-members 在册串（升序逗号·壳纯渲染只透传当前成员行 id 集·不在 JS 合成额外态）。
    const ids = this._members()
      .map((m) => m.memberId)
      .sort();
    this._membersAttr.set(ids.join(","));
  }

  /** 取 channel.memberChange.{join|leave}（透传帧字段·缺则 undefined·零信任不 panic）。 */
  private memberChangeField(
    ch: Record<string, unknown>,
    field: "join" | "leave",
  ): unknown {
    const mc = ch["memberChange"];
    if (!mc || typeof mc !== "object") return undefined;
    return (mc as Record<string, unknown>)[field];
  }

  /** 从成员对象数组抽 id 集（每元素取 id ?? userId·缺/空跳过·与 helix member_row_from_value 同口径）。 */
  private extractMemberIds(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const id =
        (typeof rec["id"] === "string" && rec["id"]) ||
        (typeof rec["userId"] === "string" && rec["userId"]) ||
        "";
      if (id) out.push(id);
    }
    return out;
  }

  /**
   * im:channel:update（{channel_id}·瘦·独立 update_channel 推送 / 批次结束触发）→ 确保该 channel 行
   * 存在（badge 回读触发位）+ **触发 dialogList 重查**把 channel 表最新列（is_top / display_name /
   * notice / unread 等）回读刷到 CL 区行。
   *
   * thin 信号只带 channel_id（无属性载荷·projection-schema 行61 留瘦）——要拿到新 is_top 等必须重查
   * dialogList（im_query_dialog_list → im:channels:projection → applyDialogList 透传 channel 列）。
   *   - UC-5.5 频道置顶：change/top → update_channel PATCH(is_top) → im:channel:update → 本重查 →
   *     dialogList 携新 is_top → applyDialogList normalizeIsTop → data-channel-top 回读刷新。
   *   - UC-4.1 hello 批次结束同走此信号（确保行存在·dialogList 重查幂等无害）。
   * 注：UC-5.4 改群名/公告的 displayName/notice 回读走 channelUpdate 系统 post（applyChannelUpdatePost·
   *   message-row fat 分支·server 改名推系统 post 非 update_channel）——两路径互补不冲突。
   */
  private applyChannelUpdate(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const channelId = (data as Record<string, unknown>)["channel_id"];
    if (typeof channelId === "string" && channelId) {
      this.upsertChannelRow(channelId);
      // thin 信号触发 dialogList 重查：回报 im:channels:projection → applyDialogList 透传 channel
      // 表最新列（is_top→data-channel-top·display_name·notice）刷 CL 行（壳纯渲染·不在 JS 臆造）。
      this.bridge.invoke<void>("im_query_dialog_list").catch(() => {
        // 非 Tauri / 命令缺失 → 静默
      });
    }
  }

  /**
   * UC-5.4 群属性修改回读：改群名/公告的 server echo = channelUpdate 系统 NOTICE post
   * （im:post:received·props.type=channelUpdate·props.field=displayName|notice·props.content=新值·
   * userId=SYS·真机 wire 实证）。把该系统帧的 field/content 透传刷 CL 区频道行——displayName →
   * data-channel-display-name、notice → data-channel-notice（壳纯渲染只透传系统帧 field/content·
   * 不臆造·权威在系统 post）。命中 channelUpdate 返回 true（fat 分支据此跳过普通消息行覆写·
   * 系统 channelUpdate 不进 ML 消息列表，只刷 channel 行属性）。
   */
  private applyChannelUpdatePost(data: MessageItemData): boolean {
    const d = data as unknown as Record<string, unknown>;
    const props = d["props"];
    if (!props || typeof props !== "object") return false;
    const pr = props as Record<string, unknown>;
    if (pr["type"] !== "channelUpdate") return false;
    const channelId =
      (typeof d["channel_id"] === "string" && (d["channel_id"] as string)) ||
      (typeof d["channelId"] === "string" && (d["channelId"] as string)) ||
      "";
    if (!channelId) return true; // 是 channelUpdate 帧（已认领·不进消息列表）·但无频道锚 → 不刷
    const field = typeof pr["field"] === "string" ? (pr["field"] as string) : "";
    const content =
      typeof pr["content"] === "string" ? (pr["content"] as string) : undefined;
    if (field === "displayName") {
      this.upsertChannelRowFields(channelId, { displayName: content });
    } else if (field === "notice") {
      this.upsertChannelRowFields(channelId, { notice: content });
    }
    return true;
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
    // UC-10.2：从 fat 投影 type 判系统通知（SYSTEM/SYSTEN 拼写陷阱保真透传·data-system-notice）。
    //   壳纯渲染·无乐观合成（系统通知由 WS 帧驱动的 im:post:received 透传 type 投影）。
    const systemNotice = isSystemNotice(d.type);

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
          // systemNotice 命中则置位（type=SYSTEM/SYSTEN 透传·非系统 echo 不抹既有态·UC-10.2）。
          systemNotice: systemNotice ? true : prev.systemNotice,
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
        systemNotice: systemNotice || undefined,
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
