import { bootstrapApplication } from "@angular/platform-browser";
import { AppComponent } from "./app/app.component";
import { appConfig } from "./app/app.config";

// e2e 桥（INTEGRATION-STATUS B0-A）：WebdriverIO 经 window.__lf.invoke(cmd,args)
// 透传到 Tauri 命令（im_send / set_uc / im_ready）。仅 Tauri 环境注入，纯浏览器构建不挂。
declare global {
  interface Window {
    __lf?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
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
