#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const DENY_MARKERS =
  /已废弃|已移除|已废除|废弃|废除|禁用|禁止|不允许|不得|不再|不在|must not|do not|forbidden|deprecated/i;

const rules = [
  {
    pattern: "debugMarkFailed|debugLocatePost|debugSetManger",
    paths: ["src/app", "test/specs"],
    reason: "debug hooks must not patch UI state",
    ignoreCommentOnly: true,
  },
  {
    pattern: "fake(Server|Vote|Average|Channel|Post)?Id|mock(Server|Vote|Average|Channel|Post)?Id",
    paths: ["src/app", "test/specs", "src-tauri"],
    reason: "fake/mock ids cannot drive UC closure",
    ignoreCommentOnly: true,
  },
  {
    pattern: "data-admin.*乐观|乐观.*data-admin",
    paths: ["src/app", "test/specs"],
    reason: "admin DOM must come from backend/helix projection",
    ignoreCommentOnly: true,
  },
  {
    pattern: "data-admin.*乐观|乐观.*data-admin",
    paths: [
      "docs/uc-rollout",
      "docs/uc-coverage-ledger.md",
      "docs/ui-指令映射全景.md",
      "docs/architecture-review",
    ],
    reason: "admin DOM must come from backend/helix projection",
    allowDeniedWording: true,
  },
];

function rg(pattern, paths) {
  try {
    return execFileSync("rg", ["-n", "--no-heading", pattern, ...paths], {
      encoding: "utf8",
    }).trim();
  } catch (error) {
    if (error.status === 1) return "";
    if (error.code === "ENOENT") {
      console.error("rg is required for scan-real-chain-violations.mjs");
      process.exit(2);
    }
    throw error;
  }
}

function parseLine(line) {
  const match = line.match(/^(.*?):(\d+):(.*)$/);
  if (!match) return { path: "", lineNumber: "", text: line };
  return { path: match[1], lineNumber: match[2], text: match[3] };
}

function shouldAllow(rule, text) {
  return Boolean(rule.allowDeniedWording && DENY_MARKERS.test(text));
}

function isCommentOnly(text) {
  return /^(\/\/|\/\*|\*|#)/.test(text.trim());
}

const failures = [];

for (const rule of rules) {
  const out = rg(rule.pattern, rule.paths);
  const hits = out
    .split("\n")
    .filter(Boolean)
    .filter((line) => !(rule.ignoreCommentOnly && isCommentOnly(parseLine(line).text)))
    .filter((line) => !shouldAllow(rule, parseLine(line).text));
  if (hits.length) failures.push({ reason: rule.reason, out: hits.join("\n") });
}

const randomOut = rg("Math\\.random", ["src/app", "test/specs"]);
const suspiciousRandom = randomOut
  .split("\n")
  .filter(Boolean)
  .filter((line) => /\b(?:server|channel|post|msg|vote|average)[A-Za-z_]*id\b/i.test(parseLine(line).text));

if (suspiciousRandom.length) {
  failures.push({
    reason:
      "Math.random may create only unique client text/temp ids; it must not create server/channel/post/msg/vote/average ids",
    out: suspiciousRandom.join("\n"),
  });
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`\n[real-chain violation] ${failure.reason}`);
    console.error(failure.out);
  }
  process.exit(1);
}

console.log("real-chain scan passed");
