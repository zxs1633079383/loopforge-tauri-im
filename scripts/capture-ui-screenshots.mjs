#!/usr/bin/env node
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_OUT = "/tmp/loopforge";
const DEFAULT_URL = "http://localhost:1420";
const REQUIRED_SERVER_COMMAND = "pnpm start";
const DEFAULT_TIMEOUT_MS = 5000;

function parseArgs(argv) {
  const args = { out: DEFAULT_OUT, url: DEFAULT_URL };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[++i] ?? args.out;
      continue;
    }
    if (arg === "--url") {
      args.url = argv[++i] ?? args.url;
      continue;
    }
    throw new Error(`unknown arg: ${arg}`);
  }
  return args;
}

function summaryText(args, status) {
  const desktopPath = join(args.out, "desktop.png");
  const mobilePath = join(args.out, "mobile.png");
  const lines = [
    "# UI Screenshot Gate",
    "",
    `- target url: \`${args.url}\``,
    `- desktop target: \`${desktopPath}\` at 1440x1000`,
    `- mobile target: \`${mobilePath}\` at 390x844`,
    `- capture status: ${status.label}`,
    "",
    "Required visual checks:",
    "",
    "- dark top/rail and light message canvas match target message page direction",
    "- channel list, message list, member/aux area, and composer are visible",
    "- no text overlap",
    "- no test control is hidden at mobile width",
    "- DOM `data-testid` elements used by representative specs remain interactable",
    "",
  ];

  if (status.message) {
    lines.push(`- detail: ${status.message}`, "");
  }

  if (!status.ok) {
    lines.push(
      "Capture failed, so this gate is not satisfied.",
      `Start the local UI server with: \`${REQUIRED_SERVER_COMMAND}\``,
      "If Playwright is not installed in this repo environment, install or restore the existing project browser dependencies before retrying.",
      ""
    );
  }

  if (status.ok) {
    lines.push("Both required PNG files were captured in this archive directory.", "");
  } else {
    lines.push("No checklist-only fallback is accepted for a passing screenshot gate.", "");
  }

  return `${lines.join("\n")}\n`;
}

function writeSummary(args, status) {
  writeFileSync(join(args.out, "screenshot-summary.md"), summaryText(args, status));
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Playwright package is unavailable in this repo environment (${message}).`);
  }
}

async function assertServerReachable(url) {
  let response;
  try {
    response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`UI server is unreachable at ${url} (${message}).`);
  }

  if (!response.ok) {
    throw new Error(`UI server responded with HTTP ${response.status} at ${url}.`);
  }
}

function assertNonEmptyPng(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`expected non-empty PNG at ${path}`);
  }
}

async function captureScreenshots(args) {
  const { chromium } = await loadPlaywright();
  await assertServerReachable(args.url);

  const browser = await chromium.launch({ headless: true });
  try {
    const desktopPath = join(args.out, "desktop.png");
    const mobilePath = join(args.out, "mobile.png");

    const desktopPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await desktopPage.goto(args.url, { waitUntil: "networkidle", timeout: DEFAULT_TIMEOUT_MS });
    await desktopPage.screenshot({ path: desktopPath, fullPage: false });
    await desktopPage.close();

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(args.url, { waitUntil: "networkidle", timeout: DEFAULT_TIMEOUT_MS });
    await mobilePage.screenshot({ path: mobilePath, fullPage: false });
    await mobileContext.close();

    assertNonEmptyPng(desktopPath);
    assertNonEmptyPng(mobilePath);
  } finally {
    await browser.close();
  }
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });
rmSync(join(args.out, "desktop.png"), { force: true });
rmSync(join(args.out, "mobile.png"), { force: true });

try {
  await captureScreenshots(args);
  const status = { ok: true, label: "captured", message: "desktop.png and mobile.png were created successfully." };
  writeSummary(args, status);
  console.log(`captured screenshots to ${args.out}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const status = { ok: false, label: "capture-failed", message };
  writeSummary(args, status);
  console.error(message);
  process.exitCode = 1;
}
