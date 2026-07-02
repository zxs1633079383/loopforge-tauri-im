#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function parseArgs(argv) {
  const args = { out: "/tmp/loopforge" };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i] ?? args.out;
    else throw new Error(`unknown arg: ${argv[i]}`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
mkdirSync(args.out, { recursive: true });

const summary = [
  "# UI Screenshot Gate",
  "",
  "Capture these screenshots with the project browser tool or Playwright-capable local environment:",
  "",
  `- desktop: \`${join(args.out, "desktop.png")}\` at 1440x1000`,
  `- mobile: \`${join(args.out, "mobile.png")}\` at 390x844`,
  "",
  "Required visual checks:",
  "",
  "- dark top/rail and light message canvas match target message page direction",
  "- channel list, message list, member/aux area, and composer are visible",
  "- no text overlap",
  "- no test control is hidden at mobile width",
  "- DOM `data-testid` elements used by representative specs remain interactable",
  "",
  "If this script runs in an environment without browser screenshot support, use the summary as the manual capture checklist and attach the two images to the archive directory.",
  "",
];

writeFileSync(join(args.out, "screenshot-summary.md"), summary.join("\n"));
console.log(`screenshot checklist written to ${join(args.out, "screenshot-summary.md")}`);
