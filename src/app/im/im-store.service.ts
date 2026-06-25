import { Injectable, computed, inject, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";
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
  ChannelCreatedData,
  ChannelIncrementData,
  MESSAGE_ROW_CHANNELS,
  MessageItemData,
  POST_SENDING_CHANNEL,
  PostSendingData,
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
  readonly rows = computed(() => this._rows());

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
      this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "failed" }));
      this.pendingText.delete(temporaryId);
    }
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

    const idx = temporaryId
      ? this._rows().findIndex((r) => r.temporaryId === temporaryId)
      : -1;

    if (idx >= 0) {
      // 覆写既有乐观行（temporaryId 不变）
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
      },
    ]);
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
