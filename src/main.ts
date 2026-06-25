import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";

// e2e 桥（INTEGRATION-STATUS B0-A）：WebdriverIO 经 window.__lf.invoke(cmd,args)
// 透传到 Tauri 命令（im_send / set_uc / im_ready）。仅 Tauri 环境注入，纯浏览器构建不挂。
declare global {
  interface Window {
    __lf?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      /** debug/test-only：把乐观行标 failed（复现真实出站失败态·UC-1.4 重发前置）。
       *  由 AppComponent ngOnInit 在 Tauri 环境注入（复用 store.markSendFailed 生产路径）。 */
      debugMarkFailed?: (temporaryId: string) => void;
      /** debug/test-only：UC-2.3 按 postId 定位（读族纯本地·无 Rust 命令·复用 store.locatePost
       *  生产路径：拉首屏 query_result + 给命中行打高亮）。由 AppComponent ngOnInit 在 Tauri 环境注入。 */
      debugLocatePost?: (postId: string, channelId?: string) => Promise<void>;
      /** debug/test-only：UC-2.4 设/撤管理员（复用 store.setManger 生产路径：① 出站
       *  channel/add|remove/manger + ③ DOM data-admin 乐观刷）。e2e 经此桥注入真实 channelId/userId/set，
       *  走与 UI『管』按钮完全相同的 store 路径（① 出站 + ③ 乐观 DOM 一次到位·非绕过生产链）。
       *  由 AppComponent ngOnInit 在 Tauri 环境注入。 */
      debugSetManger?: (channelId: string, userId: string, set: boolean) => Promise<void>;
    };
  }
}

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  window.__lf = {
    invoke: (cmd, args) =>
      import("@tauri-apps/api/core").then((m) => m.invoke(cmd, args as never)),
  };
}

bootstrapApplication(AppComponent, appConfig).catch((err) =>
  console.error(err),
);
