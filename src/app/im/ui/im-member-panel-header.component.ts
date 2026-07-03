import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from "@angular/core";

@Component({
  selector: "app-im-member-panel-header",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mem-panel__head">
      <div class="mem-panel__title">
        <span>成员</span>
        <span class="mem-panel__count">{{ count }}</span>
      </div>
      <button
        class="im__mini mem-panel__load"
        type="button"
        data-testid="load-members-btn"
        (click)="loadMembersClick.emit()"
      >载</button>
    </div>
  `,
})
export class ImMemberPanelHeaderComponent {
  @Input() count = 0;

  @Output() loadMembersClick = new EventEmitter<void>();
}
