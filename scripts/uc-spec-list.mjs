#!/usr/bin/env node
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SPEC_DIR = "test/specs";

const AREA_SPECS = {
  CL: [
    "test/specs/uc-5.1.e2e.mjs",
    "test/specs/uc-5.4.e2e.mjs",
    "test/specs/uc-5.5.e2e.mjs",
  ],
  ML: [
    "test/specs/uc-send-1.e2e.mjs",
    "test/specs/uc-1.5.e2e.mjs",
    "test/specs/uc-2.3.e2e.mjs",
  ],
  MB: [
    "test/specs/uc-6.1.e2e.mjs",
    "test/specs/uc-6.2.e2e.mjs",
    "test/specs/uc-6.3.e2e.mjs",
    "test/specs/uc-6.4.e2e.mjs",
  ],
  CP: [
    "test/specs/uc-send-1.e2e.mjs",
    "test/specs/uc-1.2.e2e.mjs",
    "test/specs/uc-1.10.e2e.mjs",
    "test/specs/uc-1.10-cancel.e2e.mjs",
  ],
  AX: [
    "test/specs/uc-9.x.e2e.mjs",
    "test/specs/uc-2.4.e2e.mjs",
    "test/specs/uc-10.1.e2e.mjs",
  ],
};

const EXCLUDED_FROM_L1 = new Set([
  // UC-1.4 validates resend from a real failed row. Healthy live runs do not
  // naturally produce failed rows, and fake/debug state injection is forbidden
  // by the real-chain gate; keep it out of default L1 until a real
  // fault-injection precondition exists.
  "uc-1.4.e2e.mjs",
  // Java-backed interaction cards are explicitly outside the current Go-only
  // closure scope. Todo remains in L1.
  "uc-8.x-average.e2e.mjs",
  "uc-8.x-vote.e2e.mjs",
  "uc-1.5-offline-setup.e2e.mjs",
  "uc-1.5-offline.e2e.mjs",
  "uc-3.1-l2.e2e.mjs",
  "uc-3.2-l2.e2e.mjs",
  "uc-5.3b-l2.e2e.mjs",
  "uc-6.1-l2.e2e.mjs",
  "uc-6.2-l2.e2e.mjs",
  "uc-11.2-l2.e2e.mjs",
  "uc-us17-l2.e2e.mjs",
]);

function allSpecs() {
  return readdirSync(SPEC_DIR)
    .filter((name) => name.endsWith(".e2e.mjs"))
    .sort()
    .map((name) => join(SPEC_DIR, name));
}

function l1Specs() {
  return allSpecs().filter((path) => !EXCLUDED_FROM_L1.has(path.split("/").pop()));
}

function l2Specs() {
  return allSpecs().filter((path) => {
    const name = path.split("/").pop();
    return name.includes("-l2") || name === "uc-us17-l2.e2e.mjs";
  });
}

function validateSpecs(label, specs) {
  if (!Array.isArray(specs) || specs.length === 0) {
    throw new Error(`${label} resolved to zero specs`);
  }
  const seen = new Set();
  for (const spec of specs) {
    if (seen.has(spec)) {
      throw new Error(`${label} has duplicate spec: ${spec}`);
    }
    seen.add(spec);
    if (!existsSync(spec)) {
      throw new Error(`${label} references missing spec: ${spec}`);
    }
  }
}

function runCheck() {
  validateSpecs("all", allSpecs());
  validateSpecs("l1", l1Specs());
  validateSpecs("l2", l2Specs());
  for (const [area, specs] of Object.entries(AREA_SPECS)) {
    validateSpecs(`area ${area}`, specs);
  }
}

function parseArgs(argv) {
  const out = { list: "all", area: "", check: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--list") out.list = argv[++i] ?? "all";
    else if (argv[i] === "--area") out.area = argv[++i] ?? "";
    else if (argv[i] === "--check") out.check = true;
    else if (argv[i] === "--help" || argv[i] === "-h") out.help = true;
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return out;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/uc-spec-list.mjs --list all",
    "  node scripts/uc-spec-list.mjs --list l1",
    "  node scripts/uc-spec-list.mjs --list l2",
    "  node scripts/uc-spec-list.mjs --area MB",
    "  node scripts/uc-spec-list.mjs --check",
  ].join("\n");
}

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }
  if (args.check) {
    runCheck();
    console.log("uc spec lists validated");
    process.exit(0);
  }
  let specs;
  if (args.area) {
    const key = args.area.toUpperCase();
    specs = AREA_SPECS[key];
    if (!specs) throw new Error(`unknown area: ${args.area}`);
  } else if (args.list === "all") specs = allSpecs();
  else if (args.list === "l1") specs = l1Specs();
  else if (args.list === "l2") specs = l2Specs();
  else throw new Error(`unknown list: ${args.list}`);

  for (const spec of specs) console.log(spec);
} catch (error) {
  console.error(String(error?.message ?? error));
  console.error(usage());
  process.exit(2);
}
