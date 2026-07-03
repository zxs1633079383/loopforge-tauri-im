import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
  selector: "app-im-status-bar",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="im__hd" data-testid="status-bar">
      <span>LoopForge IM</span>
      <span class="im__ready" [attr.data-ready]="ready">
        {{ ready ? "ready" : "loading…" }}
      </span>
      <button
        class="im__mini"
        type="button"
        data-testid="health-btn"
        (click)="healthClick.emit()"
      >health</button>
      <button
        class="im__mini"
        type="button"
        data-testid="read-channel-btn"
        [disabled]="!activeChannel"
        (click)="readChannelClick.emit()"
      >已读</button>
      <span class="im__hd-spacer"></span>
      <span class="im__acct" data-testid="debug-account-panel">
        <span class="im__acct-label">账号</span>
        <button
          class="im__mini im__acct-active"
          type="button"
          data-testid="account-444-btn"
          [attr.data-current-user-id]="currentUserId"
        >{{ currentUserId || "444" }}</button>
        <button
          class="im__mini"
          type="button"
          data-testid="l2-send-btn"
          [disabled]="!activeChannel"
          (click)="l2SendClick.emit()"
        >678 发</button>
        <button
          class="im__mini"
          type="button"
          data-testid="l2-mention-btn"
          [disabled]="!activeChannel"
          (click)="l2MentionClick.emit()"
        >@444</button>
        <button
          class="im__mini"
          type="button"
          data-testid="l2-read-btn"
          [disabled]="!activeChannel"
          (click)="l2ReadClick.emit()"
        >678 已读</button>
        <button
          class="im__mini"
          type="button"
          data-testid="l2-urgent-btn"
          [disabled]="!activeChannel"
          (click)="l2UrgentClick.emit()"
        >678 急</button>
      </span>
    </header>
  `,
  styles: [`
    .im__hd-spacer { flex: 1; }
    .im__acct { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .im__acct-label { color: #a9b0c6; font-size: 12px; }
    .im__acct-active { color: #3340d8; border-color: #7f8cff; background: #eef1ff; }
  `],
})
export class ImStatusBarComponent {
  @Input() ready = false;
  @Input() activeChannel: string | null = null;
  @Input() currentUserId = "444";

  @Output() healthClick = new EventEmitter<void>();
  @Output() readChannelClick = new EventEmitter<void>();
  @Output() l2SendClick = new EventEmitter<void>();
  @Output() l2MentionClick = new EventEmitter<void>();
  @Output() l2ReadClick = new EventEmitter<void>();
  @Output() l2UrgentClick = new EventEmitter<void>();
}
