import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";
import { FormsModule } from "@angular/forms";

@Component({
  selector: "app-im-composer",
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <footer class="im__compose">
      <span class="im__compose-to">To <strong>所有人</strong></span>
      <input
        class="im__input"
        type="text"
        data-testid="compose-input"
        data-role="composer-input"
        placeholder="Enter发送，Ctrl/Cmd+Enter换行"
        [ngModel]="draft"
        (ngModelChange)="draftChange.emit($event)"
        (focus)="readChannelClick.emit()"
        (click)="readChannelClick.emit()"
        (keydown.enter)="sendClick.emit()"
      />
      <button
        class="im__send"
        type="button"
        data-testid="send-btn"
        [disabled]="!activeChannel"
        (click)="sendClick.emit()"
      >发送</button>
      <button
        class="im__send"
        type="button"
        data-testid="send-document-btn"
        [disabled]="!activeChannel"
        (click)="sendDocumentClick.emit()"
      >文档</button>
      <button
        class="im__send"
        type="button"
        data-testid="send-urgent-btn"
        [disabled]="!activeChannel"
        (click)="sendUrgentClick.emit()"
      >加急</button>
      <button
        class="im__mini"
        type="button"
        data-testid="schedule-btn"
        [disabled]="!activeChannel"
        (click)="scheduleClick.emit()"
      >定时</button>
      <button
        class="im__mini"
        type="button"
        data-testid="cancel-schedule-btn"
        [disabled]="!activeChannel"
        (click)="cancelScheduleClick.emit()"
      >取消定时</button>
      <button
        class="im__mini"
        type="button"
        data-testid="read-channel-btn"
        [disabled]="!activeChannel"
        (click)="readChannelClick.emit()"
      >会话已读</button>
    </footer>
  `,
})
export class ImComposerComponent {
  @Input() activeChannel: string | null = null;
  @Input() draft = "";

  @Output() draftChange = new EventEmitter<string>();
  @Output() sendClick = new EventEmitter<void>();
  @Output() sendDocumentClick = new EventEmitter<void>();
  @Output() sendUrgentClick = new EventEmitter<void>();
  @Output() scheduleClick = new EventEmitter<void>();
  @Output() cancelScheduleClick = new EventEmitter<void>();
  @Output() readChannelClick = new EventEmitter<void>();
}
