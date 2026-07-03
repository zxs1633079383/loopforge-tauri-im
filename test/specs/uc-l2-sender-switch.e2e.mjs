import assert from "node:assert/strict";
import fs from "node:fs";

const jsonl = process.env.HELIX_RUN_JSONL || "/tmp/loopforge/run.jsonl";

function readLines() {
  if (!fs.existsSync(jsonl)) return [];
  return fs
    .readFileSync(jsonl, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const invokeBridge = (cmd, args) =>
  browser.executeAsync(
    (c, a, done) => {
      // @ts-ignore - test-only bridge injected by src/main.ts in Tauri.
      if (!window.__lf?.invoke) {
        done({ ok: false, error: "no __lf bridge" });
        return;
      }
      window.__lf
        .invoke(c, a)
        .then((result) => done({ ok: true, result: result ?? null }))
        .catch((error) => done({ ok: false, error: String(error?.message ?? error) }));
    },
    cmd,
    args,
  );

const snapshotChannelIds = () =>
  browser.execute(() =>
    Array.from(document.querySelectorAll('[data-testid="channel-list"] [data-channel-id]'))
      .map((el) => el.getAttribute("data-channel-id"))
      .filter((id) => !!id),
  );

function findReceivedFrom678(text) {
  return readLines().find((line) => {
    const payload = line?.payload ?? {};
    const data = payload.data ?? {};
    return (
      line?.facet === "projection" &&
      payload.event === "im:post:received" &&
      data.message === text &&
      String(data.userId ?? "") === "678"
    );
  });
}

describe("L2 sender switch · 444/678 真实发送者切换", () => {
  it("默认 444，切到 678 后 composer 以 678 发消息", async () => {
    const status = await $('[data-testid="status-bar"]');
    await status.waitForExist({ timeout: 30000 });

    await browser.waitUntil(
      async () => (await status.getAttribute("data-active-user-id")) === "444",
      { timeout: 10000, interval: 200, timeoutMsg: "status-bar 未暴露 active user 444" },
    );
    assert.equal(await status.getAttribute("data-sender-user-id"), "444");

    const beforeIds = new Set(await snapshotChannelIds());
    const created = await invokeBridge("im_create_channel", {
      displayName: `lf-l2-switch-${Date.now()}`,
      memberIds: ["678"],
    });
    assert.equal(created.ok, true, created.error);
    await browser.waitUntil(
      async () => (await snapshotChannelIds()).some((id) => !beforeIds.has(id)),
      { timeout: 20000, interval: 200, timeoutMsg: "未创建 444+678 共享调试频道" },
    );
    const sharedChannelId = (await snapshotChannelIds()).find((id) => !beforeIds.has(id));
    assert.ok(sharedChannelId, "未拿到共享调试频道 id");

    await $(`[data-testid="channel-list"] [data-channel-id="${sharedChannelId}"]`).click();
    await browser.waitUntil(
      async () =>
        (await browser.execute(
          () => document.querySelector("main.im")?.getAttribute("data-active-channel"),
        )) === sharedChannelId,
      { timeout: 10000, interval: 200, timeoutMsg: "共享调试频道未成为 activeChannel" },
    );

    await $('[data-testid="account-678-btn"]').click();
    await browser.waitUntil(
      async () => (await status.getAttribute("data-sender-user-id")) === "678",
      { timeout: 10000, interval: 200, timeoutMsg: "发送者未切到 678" },
    );

    const text = `lf-sender-alt-${Date.now()}`;
    await invokeBridge("set_uc", { uc: "L2-sender-switch" });
    await $('[data-testid="compose-input"]').setValue(text);
    await $('[data-testid="send-btn"]').click();

    await browser.waitUntil(
      async () => {
        const rows = await $$(`.msg*=${text}`);
        for (const row of rows) {
          const user = await row
            .$("[data-user-id]")
            .getAttribute("data-user-id")
            .catch(() => "");
          if (user === "678") return true;
        }
        return false;
      },
      { timeout: 30000, interval: 300, timeoutMsg: "678 发送消息未在 DOM 以 sender=678 出现" },
    );

    await browser.waitUntil(() => !!findReceivedFrom678(text), {
      timeout: 10000,
      interval: 200,
      timeoutMsg: "run.jsonl 未记录 A=444 收到 678 的 im:post:received",
    });
    const received = findReceivedFrom678(text);
    assert.equal(received.payload.data.channelId, sharedChannelId);
    await invokeBridge("set_uc", { uc: "__quiescence__" });
  });
});
