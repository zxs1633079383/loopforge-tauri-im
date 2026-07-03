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

function headerValue(headers, name) {
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    const match = headers.find(([key]) => String(key).toLowerCase() === wanted);
    return match?.[1] ?? null;
  }
  if (headers && typeof headers === "object") {
    const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === wanted);
    return key ? headers[key] : null;
  }
  return null;
}

function cookieValue(cookieHeader, name) {
  const wanted = name.toLowerCase();
  return String(cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([key]) => key?.toLowerCase() === wanted)?.[1] ?? null;
}

function isStructuredIdentity678(line) {
  const payload = line?.payload ?? {};
  const headers = payload.headers ?? {};
  const body = payload.body ?? {};
  const cookieHeader = headerValue(headers, "cookie");
  const explicitValues = [
    line?.cookieId,
    line?.userId,
    payload.cookieId,
    payload.userId,
    headerValue(headers, "cookieId"),
    cookieValue(cookieHeader, "cookieId"),
    cookieValue(cookieHeader, "userId"),
    cookieValue(cookieHeader, "session"),
    cookieValue(cookieHeader, "sessionId"),
    body.userId,
    body.user_id,
  ];
  return explicitValues.some((value) => String(value ?? "") === "678");
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

    const text = `lf-sender-alt-${Date.now()}`;
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
      const payload = line?.payload ?? {};
      const textHit = payload.body?.message === text || payload.body?.simpleMessage === text;
      const urlHit = String(payload.url ?? "").endsWith("posts/create");
      return textHit && urlHit && isStructuredIdentity678(line);
    });
    assert.ok(outbound.length > 0, "run.jsonl 未记录 678 posts/create 出站");
  });
});
