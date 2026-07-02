import { ChangeDetectionStrategy, Component, Input } from "@angular/core";

@Component({
  selector: "app-im-server-rail",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="im__rail" aria-hidden="true">
      <div class="im__rail-home">L</div>
      <div class="im__rail-div"></div>
      @for (s of serverIcons; track s) {
        <div class="im__rail-srv">{{ s }}</div>
      }
      <div class="im__rail-add">+</div>
    </nav>
  `,
})
export class ImServerRailComponent {
  @Input() serverIcons: readonly string[] = [];
}
