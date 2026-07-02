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

function safeText(value) {
  return typeof value === "string" ? value : "";
}

function parseInsideFailures(logText) {
  const matches = [];
  const regex = /inside "([^"]+)"/g;
  let match;
  while ((match = regex.exec(logText))) {
    const text = match[1] ?? "";
    const splitIndex = text.lastIndexOf(" / ");
    matches.push({
      scenario: splitIndex >= 0 ? text.slice(0, splitIndex) : text,
      step: splitIndex >= 0 ? text.slice(splitIndex + 3) : "",
    });
  }
  return matches;
}

function classifyApifoxScenario(name = "", url = "") {
  const text = `${name} ${url}`;
  if (text.includes("UC-8.x 投票") || text.includes("/vote/")) return "excluded-java-vote";
  if (text.includes("UC-8.x 平均") || text.includes("/average/")) return "excluded-java-average";
  if (text.includes("localhost:3399") || text.includes("127.0.0.1:3399")) return "java";
  return "go";
}

function buildApifoxEvidenceWarning(message, details = {}) {
  const suffix = Object.entries(details)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  return suffix ? `${message} (${suffix})` : message;
}

function readApifoxReport(archiveDir) {
  const reportPath = join(archiveDir, "apifox-reports", "apifox-report.json");
  const logPath = join(archiveDir, "apifox-run.log");
  const report = parseJsonFile(reportPath);
  const logText = readText(logPath);
  return { reportPath, logPath, report, logText };
}

function buildApifoxFailureEvidence(archiveDir) {
  const { report, logText } = readApifoxReport(archiveDir);
  const rawFailures = Array.isArray(report?.result?.failures) ? report.result.failures : [];
  const insideFailures = parseInsideFailures(logText);
  const total = Math.max(rawFailures.length, insideFailures.length);
  const unique = [];
  const seen = new Set();
  const warnings = [];
  let missingRawCount = 0;
  let missingInsideCount = 0;
  let incompleteRowCount = 0;

  for (let i = 0; i < total; i++) {
    const raw = rawFailures[i] ?? {};
    const inside = insideFailures[i] ?? {};
    const hasRaw = i < rawFailures.length;
    const hasInside = i < insideFailures.length;
    if (!hasRaw) {
      missingRawCount += 1;
      warnings.push(buildApifoxEvidenceWarning("missing raw failure evidence", { index: i }));
    }
    if (!hasInside) {
      missingInsideCount += 1;
      warnings.push(buildApifoxEvidenceWarning("missing inside log evidence", { index: i }));
    }

    const scenario = safeText(inside.scenario);
    const step = safeText(inside.step);
    const rawTest = safeText(raw?.error?.test);

    const key = scenario && step ? `${scenario}\u0000${step}` : `__incomplete__\u0000${i}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const message = safeText(raw?.error?.message) || safeText(raw?.error?.stack) || safeText(raw?.message);
    const className = classifyApifoxScenario(`${scenario} ${step} ${rawTest}`, step);
    if (!hasRaw || !hasInside) {
      incompleteRowCount += 1;
    }

    unique.push({
      class: className,
      scenario,
      step,
      message,
      evidence: hasRaw && hasInside ? "matched" : hasRaw ? "missing-inside" : "missing-raw",
    });
  }

  const stats = report?.result?.stats?.steps ?? {};
  const stepsTotal = Number.isFinite(Number(stats.total)) ? Number(stats.total) : 0;
  const stepsFailed = Number.isFinite(Number(stats.failed)) ? Number(stats.failed) : 0;
  const goFailures = unique.filter((failure) => failure.class === "go").length;
  const excludedJavaFailures = unique.filter((failure) => failure.class.startsWith("excluded-java-")).length;
  if (unique.length !== stepsFailed) {
    warnings.push(
      buildApifoxEvidenceWarning("unique failure rows do not match report failed-step count", {
        unique: unique.length,
        stepsFailed,
      }),
    );
  }
  const evidenceComplete =
    Boolean(report) &&
    warnings.length === 0 &&
    missingRawCount === 0 &&
    missingInsideCount === 0 &&
    unique.length === stepsFailed;
  const passed = Boolean(report) && evidenceComplete && goFailures === 0;

  return {
    profile: "go-only",
    passed,
    stats: {
      stepsTotal,
      stepsFailed,
      goFailures,
      excludedJavaFailures,
    },
    failures: unique,
    excluded: ["UC-8.x 投票 CRUD", "UC-8.x 平均分 CRUD"],
    mismatch: {
      rawFailureCount: rawFailures.length,
      insideFailureCount: insideFailures.length,
      pairedFailureCount: total,
      uniqueFailureCount: unique.length,
      missingRawCount,
      missingInsideCount,
      incompleteRowCount,
      evidenceComplete,
    },
    warnings,
  };
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

function formatApifoxSummary(archiveDir) {
  const status = buildApifoxFailureEvidence(archiveDir);
  const failureLines = status.failures.map((failure) => `| ${failure.class} | ${failure.scenario} | ${failure.step} | ${failure.message} |`);
  const mismatchLines = [];
  if (status.mismatch) {
    mismatchLines.push(
      `Evidence: raw=${status.mismatch.rawFailureCount}, inside=${status.mismatch.insideFailureCount}, paired=${status.mismatch.pairedFailureCount}, unique=${status.mismatch.uniqueFailureCount}`,
    );
    mismatchLines.push(
      `Gaps: missingRaw=${status.mismatch.missingRawCount}, missingInside=${status.mismatch.missingInsideCount}, incompleteRows=${status.mismatch.incompleteRowCount}, evidenceComplete=${status.mismatch.evidenceComplete}`,
    );
  }
  const warningLines = Array.isArray(status.warnings) && status.warnings.length > 0
    ? status.warnings.map((warning) => `- ${warning}`)
    : [];

  return [
    "## Apifox Failures",
    "",
    `Profile: \`${status.profile}\``,
    "",
    ...mismatchLines,
    ...warningLines.length > 0 ? ["", "Warnings:", ...warningLines] : [],
    ...(mismatchLines.length > 0 || warningLines.length > 0 ? [""] : []),
    "| Class | Scenario | Step | Message |",
    "|---|---|---|---|",
    ...failureLines,
    "",
    `Stats: stepsTotal=${status.stats.stepsTotal}, stepsFailed=${status.stats.stepsFailed}, goFailures=${status.stats.goFailures}, excludedJavaFailures=${status.stats.excludedJavaFailures}`,
    "",
  ].join("\n");
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
  const status = buildApifoxFailureEvidence(args.archive);
  writeFileSync(args.writeApifoxStatus, `${JSON.stringify(status, null, 2)}\n`);
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
  formatApifoxSummary(args.archive),
];

writeFileSync(args.out, lines.join("\n"));
