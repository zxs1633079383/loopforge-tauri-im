#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { archive: "", out: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") args.archive = argv[++i] ?? "";
    else if (argv[i] === "--out") args.out = argv[++i] ?? "";
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  if (!args.archive || !args.out) throw new Error("--archive and --out are required");
  return args;
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function parseCount(line, label) {
  const match = line.match(new RegExp(`(\\d+)\\s+${label}\\b`, "i"));
  return match ? Number(match[1]) : null;
}

function parseWdioResult(text) {
  if (!text) {
    return "not-run";
  }

  const summaryLine = text
    .split(/\r?\n/)
    .filter((line) => line.includes("Spec Files:"))
    .pop();

  if (!summaryLine) {
    return "not-pass-or-unknown";
  }

  const passed = parseCount(summaryLine, "passed");
  const failed = parseCount(summaryLine, "failed");
  const total = parseCount(summaryLine, "total");
  const skipped = parseCount(summaryLine, "skipped");

  if (failed !== null && failed > 0) {
    return "not-pass-or-unknown";
  }
  if (skipped !== null && skipped > 0) {
    return "not-pass-or-unknown";
  }
  if (passed !== null && total !== null && total > 0 && passed === total) {
    return "pass";
  }
  return "not-pass-or-unknown";
}

function parseJsonFile(path) {
  const raw = readText(path);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function classifyApifoxResult(archiveDir) {
  const logPath = join(archiveDir, "apifox-run.log");
  const statusPath = join(archiveDir, "apifox-status.json");
  const hasLog = existsSync(logPath);
  const hasStatusFile = existsSync(statusPath);
  const status = parseJsonFile(statusPath);

  if (!hasLog && !hasStatusFile) {
    return "not-run";
  }
  if (status?.status === "pass" && status?.scope === "http-only") {
    return "pass";
  }
  return "not-pass-or-unknown";
}

function readRunStatus(archiveDir) {
  const path = join(archiveDir, "run-status.txt");
  const raw = readText(path);
  if (!raw) {
    return null;
  }

  const status = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    status[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return status;
}

function formatHarnessStatus(status) {
  if (!status) {
    return "unknown";
  }
  if (status.exit_code === "0") {
    return "pass";
  }

  const stage = status.stage || "unknown-stage";
  const detail = status.detail ? `: ${status.detail}` : "";
  return `fail (exit ${status.exit_code || "?"} at ${stage}${detail})`;
}

const args = parseArgs(process.argv.slice(2));
const wdioResult = parseWdioResult(readText(join(args.archive, "wdio-out.log")));
const apifoxResult = classifyApifoxResult(args.archive);
const runStatus = readRunStatus(args.archive);

const lines = [
  "# LoopForge Run Summary",
  "",
  `Archive: \`${args.archive}\``,
  "",
  "| Gate | Result |",
  "|---|---|",
  `| Harness | ${formatHarnessStatus(runStatus)} |`,
  `| WDIO | ${wdioResult} |`,
  `| Apifox HTTP | ${apifoxResult} |`,
  `| Angular log | ${existsSync(join(args.archive, "run-ng.log")) ? "archived" : "missing"} |`,
  `| Tauri/helix log | ${existsSync(join(args.archive, "run-app.log")) ? "archived" : "missing"} |`,
  `| run.jsonl | ${existsSync(join(args.archive, "run.jsonl")) ? "archived" : "missing"} |`,
  `| Go log | ${existsSync(join(args.archive, "cses-im-server.log")) ? "archived" : "missing"} |`,
  "",
];

writeFileSync(args.out, lines.join("\n"));
