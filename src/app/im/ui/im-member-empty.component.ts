import { ChangeDetectionStrategy, Component } from "@angular/core";

@Component({
  selector: "app-im-member-empty",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mem-empty">
      <span class="mem-empty__title">暂无成员</span>
      <span class="mem-empty__hint">点击加载同步当前会话成员</span>
    </div>
  `,
})
export class ImMemberEmptyComponent {}
