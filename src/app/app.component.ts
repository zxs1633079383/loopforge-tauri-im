import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  inject,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ImStoreService } from "./im/im-store.service";

/**
 * LoopForge IM 薄壳根组件 —— 语义 DOM 消息列表 + 发送框。
 *
 * UI 精简（不追组件/像素保真），data-* 直映投影（spec §4）。
 * 契约固定：invoke 名 im_send、事件名 im:__bus__、data-* 名字按 spec §4。
 */
@Component({
  selector: "app-root",
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="im" [attr.data-ready]="store.ready()">
      <header class="im__hd">
        <span>LoopForge IM</span>
        <span class="im__ready" [attr.data-ready]="store.ready()">
          {{ store.ready() ? "ready" : "loading…" }}
        </span>
      </header>

      <section class="im__list" data-testid="msg-list">
        @for (m of store.rows(); track m.temporaryId) {
          <div
            class="msg"
            [class.msg--sending]="m.sendStatus === 'sending'"
            [class.msg--failed]="m.sendStatus === 'failed'"
            [attr.data-msg-id]="m.msgId"
            [attr.data-temporary-id]="m.temporaryId"
            [attr.data-channel-id]="m.channelId"
            [attr.data-event-seq]="m.eventSeq === null ? '' : m.eventSeq"
            [attr.data-send-status]="m.sendStatus"
            [attr.data-read-bits]="m.readBits"
          >{{ m.text }}</div>
        }
      </section>

      <footer class="im__compose">
        <input
          class="im__input"
          type="text"
          data-testid="compose-input"
          placeholder="输入消息…"
          [(ngModel)]="draft"
          (keydown.enter)="onSend()"
        />
        <button
          class="im__send"
          type="button"
          data-testid="send-btn"
          (click)="onSend()"
        >发送</button>
      </footer>
    </main>
  `,
  styles: [
    `
      .im { display: flex; flex-direction: column; height: 100vh; }
      .im__hd {
        display: flex; justify-content: space-between; align-items: center;
        padding: 8px 12px; background: #1d1d22; border-bottom: 1px solid #2a2a30;
        font-weight: 600;
      }
      .im__ready { font-size: 12px; opacity: 0.6; font-weight: 400; }
      .im__ready[data-ready="true"] { color: #5ad27a; opacity: 1; }
      .im__list { flex: 1; overflow-y: auto; padding: 8px 12px; }
      .msg {
        margin: 4px 0; padding: 6px 10px; border-radius: 8px;
        background: #23232a; max-width: 70%; word-break: break-word;
        white-space: pre-wrap;
      }
      .msg--sending { opacity: 0.55; }
      .msg--failed { background: #3a1d1d; color: #ff9b9b; }
      .im__compose {
        display: flex; gap: 8px; padding: 8px 12px;
        border-top: 1px solid #2a2a30; background: #1d1d22;
      }
      .im__input {
        flex: 1; padding: 8px 10px; border-radius: 6px;
        border: 1px solid #2a2a30; background: #141417; color: #eee;
      }
      .im__send {
        padding: 8px 16px; border-radius: 6px; border: none;
        background: #3b6ef5; color: #fff; cursor: pointer; font-weight: 600;
      }
      .im__send:active { background: #2f59c9; }
    `,
  ],
})
export class AppComponent implements OnInit, OnDestroy {
  readonly store = inject(ImStoreService);

  /** 当前频道 —— 竖切 UC-send-1 固定单频道；W1/W3 可经 query 注入覆盖 */
  private readonly channelId = "demo-channel";

  draft = "";

  ngOnInit(): void {
    void this.store.start();
  }

  ngOnDestroy(): void {
    this.store.stop();
  }

  onSend(): void {
    const text = this.draft;
    this.draft = "";
    void this.store.send(this.channelId, text);
  }
}
