import { Injectable, computed, inject, signal } from "@angular/core";
import { TauriBridgeService } from "./tauri-bridge.service";
import { MessageRow } from "./message-row.model";
import {
  BusEnvelope,
  MESSAGE_ROW_CHANNELS,
  MessageItemData,
} from "./projection.types";

/**
 * IM 薄壳状态机 —— 纯渲染：listen im:__bus__ → 按 message_item_data 渲染/echo 覆写。
 *
 * 不维护第二套 sync 状态机（schema §0 纯渲染证伪标准）：
 * 乐观插入由本壳做（temporaryId 锚），其余字段权威来自 helix 投影。
 *
 * 不变量：
 *  - data-temporary-id 贯穿乐观→覆写不变（选择器锚）。
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

  private unlisten: (() => void) | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;

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
   * 发送：生成 temporaryId → 乐观插入 sending 行 → invoke('im_send')。
   * invoke 失败（含非 Tauri 环境）→ 行标 failed。
   */
  async send(channelId: string, text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const temporaryId = this.genTempId();

    // 乐观插入：data-msg-id=temporaryId、data-send-status=sending
    this._rows.update((rows) => [
      ...rows,
      {
        msgId: temporaryId,
        temporaryId,
        channelId,
        eventSeq: null,
        sendStatus: "sending",
        readBits: "",
        text: trimmed,
      },
    ]);

    try {
      await this.bridge.invoke<void>("im_send", {
        channelId,
        text: trimmed,
        temporaryId,
      });
    } catch {
      // 出站失败 → 标 failed（非 Tauri dev 环境也会走这里）
      this.patchByTemp(temporaryId, (r) => ({ ...r, sendStatus: "failed" }));
    }
  }

  // ——— 私有 ———

  private onBus(env: BusEnvelope): void {
    const channel = env?.channel;
    if (!channel) return;

    // 只认 message-row 类 channel 的 message_item_data fat 集
    if (!MESSAGE_ROW_CHANNELS.has(channel)) return;

    const data = env.payload?.data as MessageItemData | undefined;
    if (!data || typeof data !== "object") return;
    this.applyMessageItem(data);
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

  private genTempId(): string {
    // 临时 id：时间戳 + 随机；只需本会话内唯一作锚。
    return `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
