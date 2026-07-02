#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { archive: "", out: "", writeApifoxStatus: "" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--archive") args.archive = argv[++i] ?? "";
    else if (argv[i] === "--out") args.out = argv[++i] ?? "";
    else if (argv[i] === "--write-apifox-status") args.writeApifoxStatus = argv[++i] ?? "";
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  if (!args.archive) throw new Error("--archive is required");
  if (!args.out && !args.writeApifoxStatus) {
    throw new Error("--out or --write-apifox-status is required");
  }
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

function collectFiles(dir, predicate) {
  if (!existsSync(dir)) {
    return [];
  }
  const out = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...collectFiles(path, predicate));
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (value && typeof value === "object") {
    visit(value);
    for (const child of Object.values(value)) walk(child, visit);
  }
}

function numberAt(object, names) {
  for (const [key, value] of Object.entries(object)) {
    const normalized = key.toLowerCase().replace(/[_\-\s]/g, "");
    if (names.includes(normalized) && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

function strictApifoxPassEvidence(archiveDir) {
  const reportDir = join(archiveDir, "apifox-reports");
  const jsonFiles = collectFiles(reportDir, (path) => path.endsWith(".json"));
  const candidates = jsonFiles
    .map((path) => ({ path, json: parseJsonFile(path) }))
    .filter((candidate) => candidate.json !== null);

  if (candidates.length === 0) {
    return { ok: false, reason: "missing-json-report" };
  }

  let explicitPass = false;
  const failures = [];
  const failNames = ["failed", "fail", "failure", "failures", "error", "errors"];
  const passNames = ["passed", "pass", "successes", "succeeded"];
  const totalNames = ["total", "tests", "testcount", "requests", "requestcount", "scenarios", "scenariocount"];

  for (const candidate of candidates) {
    walk(candidate.json, (object) => {
      if (object.success === false) failures.push(`${candidate.path}: success=false`);
      if (typeof object.status === "string" && /fail|error/i.test(object.status)) {
        failures.push(`${candidate.path}: status=${object.status}`);
      }
      if (object.error && Object.keys(object.error).length > 0) {
        failures.push(`${candidate.path}: error present`);
      }

      const failed = numberAt(object, failNames);
      if (failed !== null && failed > 0) {
        failures.push(`${candidate.path}: failed=${failed}`);
      }

      const passed = numberAt(object, passNames);
      const total = numberAt(object, totalNames);
      if (passed !== null && passed > 0 && (total === null || passed === total)) {
        explicitPass = true;
      }
      if (object.success === true && passed !== null && passed > 0) {
        explicitPass = true;
      }
    });
  }

  if (failures.length > 0) {
    return { ok: false, reason: failures[0] };
  }
  if (!explicitPass) {
    return { ok: false, reason: "no-explicit-pass-count" };
  }
  return { ok: true, reason: `verified-json-report:${jsonFiles.length}` };
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
  if (status?.status === "pass" && status?.scope === "http-only" && status?.verified === true) {
    return "pass";
  }
  const evidence = strictApifoxPassEvidence(archiveDir);
  if (evidence.ok) return "pass";
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

if (args.writeApifoxStatus) {
  const evidence = strictApifoxPassEvidence(args.archive);
  if (!evidence.ok) {
    console.error(`Apifox HTTP did not produce strict pass evidence: ${evidence.reason}`);
    process.exit(1);
  }
  writeFileSync(
    args.writeApifoxStatus,
    `${JSON.stringify({ status: "pass", scope: "http-only", verified: true, evidence: evidence.reason }, null, 2)}\n`,
  );
  process.exit(0);
}

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
