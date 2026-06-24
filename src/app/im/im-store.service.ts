import { Injectable, computed, inject, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";
import { MessageRow } from "./message-row.model";
import {
  BusEnvelope,
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

  private unlisten: (() => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

  /** 本地暂存：temporaryId → 发送文本（瘦投影 im:post:sending 不带 text，渲染 sending 行需要）。 */
  private readonly pendingText = new Map<string, string>();

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

  // ——— 私有 ———

  private onBus(env: BusEnvelope): void {
    const channel = env?.channel;
    if (!channel) return;

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
        };
        return next;
      });
      // echo 已对账 → 清本地暂存（pendingText 仅用于 sending 行渲染）。
      if (temporaryId) this.pendingText.delete(temporaryId);
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
