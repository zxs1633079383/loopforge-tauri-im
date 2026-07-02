import { Injectable } from "@angular/core";

/**
 * Tauri bridge —— 封装 invoke / listen，提供浏览器无 Tauri 时的降级 fallback。
 *
 * 为什么动态 import：`ng serve` 在纯浏览器（无 Tauri runtime）下也要能起，
 * `@tauri-apps/api` 在浏览器里 window.__TAURI_INTERNALS__ 缺失会抛。
 * 故运行时探测 isTauri()，非 Tauri 环境下 invoke/listen 走 no-op，方便前端单独调样式。
 *
 * 契约固定（spec §5）：
 *   invoke 名 = im_send；事件名 = im:__bus__。别自创。
 */
@Injectable({ providedIn: "root" })
export class TauriBridgeService {
  /** 运行时是否在 Tauri WebView 内 */
  isTauri(): boolean {
    return typeof window !== "undefined" &&
      // Tauri 2 注入的全局
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
  }

  /**
   * 调用 Tauri 命令。非 Tauri 环境下返回 reject，避免纯浏览器调试误以为命令已执行。
   */
  async invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
    if (!this.isTauri()) {
      return Promise.reject(new Error(`[bridge] 非 Tauri 环境，invoke(${cmd}) 跳过`));
    }
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  /**
   * 监听单总线事件。返回 unlisten 函数。
   * 非 Tauri 环境下返回 no-op unlisten，不订阅任何东西。
   */
  async listen<T>(
    event: string,
    handler: (payload: T) => void,
  ): Promise<() => void> {
    if (!this.isTauri()) {
      return () => {};
    }
    const { listen } = await import("@tauri-apps/api/event");
    const unlisten = await listen<T>(event, (e) => handler(e.payload));
    return unlisten;
  }
}
