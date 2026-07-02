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
    </header>
  `,
})
export class ImStatusBarComponent {
  @Input() ready = false;
  @Input() activeChannel: string | null = null;

  @Output() healthClick = new EventEmitter<void>();
  @Output() readChannelClick = new EventEmitter<void>();
}
