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

describe("L2 sender switch · 444/678 真实发送者切换", () => {
  it("默认 444，切到 678 后 composer 以 678 发消息", async () => {
    const status = await $('[data-testid="status-bar"]');
    await status.waitForExist({ timeout: 30000 });

    await browser.waitUntil(
      async () => (await status.getAttribute("data-active-user-id")) === "444",
      { timeout: 10000, interval: 200, timeoutMsg: "status-bar 未暴露 active user 444" },
    );
    assert.equal(await status.getAttribute("data-sender-user-id"), "444");

    await $('[data-testid="account-678-btn"]').click();
    await browser.waitUntil(
      async () => (await status.getAttribute("data-sender-user-id")) === "678",
      { timeout: 10000, interval: 200, timeoutMsg: "发送者未切到 678" },
    );

    const text = `lf-sender-678-${Date.now()}`;
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

    const outbound = readLines().filter((line) => {
      const textHit = JSON.stringify(line).includes(text);
      const userHit = JSON.stringify(line).includes("678");
      return textHit && userHit && JSON.stringify(line).includes("posts/create");
    });
    assert.ok(outbound.length > 0, "run.jsonl 未记录 678 posts/create 出站");
  });
});
