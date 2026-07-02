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

function includes(file, text) {
  const path = join(file.dir, file.name);
  return existsSync(path) && readFileSync(path, "utf8").includes(text);
}

const args = parseArgs(process.argv.slice(2));
const files = { dir: args.archive, name: "wdio-out.log" };
const wdioPass = includes(files, "Spec Files:") && includes(files, "passed");
const apifoxPath = join(args.archive, "apifox-run.log");
const apifoxRan = existsSync(apifoxPath);
const apifoxPass = apifoxRan && !readFileSync(apifoxPath, "utf8").match(/failed|失败|error/i);

const lines = [
  "# LoopForge Run Summary",
  "",
  `Archive: \`${args.archive}\``,
  "",
  "| Gate | Result |",
  "|---|---|",
  `| WDIO | ${wdioPass ? "pass" : "not-pass-or-not-run"} |`,
  `| Apifox HTTP | ${apifoxRan ? (apifoxPass ? "pass" : "not-pass") : "not-run"} |`,
  `| Angular log | ${existsSync(join(args.archive, "run-ng.log")) ? "archived" : "missing"} |`,
  `| Tauri/helix log | ${existsSync(join(args.archive, "run-app.log")) ? "archived" : "missing"} |`,
  `| run.jsonl | ${existsSync(join(args.archive, "run.jsonl")) ? "archived" : "missing"} |`,
  `| Go log | ${existsSync(join(args.archive, "cses-im-server.log")) ? "archived" : "missing"} |`,
  "",
];

writeFileSync(args.out, lines.join("\n"));
