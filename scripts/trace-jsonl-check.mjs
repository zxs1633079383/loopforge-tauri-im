#!/usr/bin/env node
import { readFileSync } from "node:fs";

const requiredNames = [
  "pc.ui.action",
  "pc.tauri.invoke.out",
  "pc.tauri.invoke.in",
  "pc.tauri.command.enqueue",
  "helix.http.request",
  "helix.http.response",
  "helix.ws.recv",
  "pc.tauri.event.emit",
  "pc.tauri.event.listen",
  "pc.ui.render",
];

function usage() {
  return "usage: node scripts/trace-jsonl-check.mjs [--input <jsonl>] [--trace-id <id>] [--self-test]";
}

function parseArgs(argv) {
  const args = { input: "/tmp/loopforge-trace/events.jsonl", traceId: "", selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i] ?? "";
    else if (arg === "--trace-id") args.traceId = argv[++i] ?? "";
    else if (arg === "--self-test") args.selfTest = true;
    else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function selfTestLines() {
  return requiredNames
    .map((name, index) =>
      JSON.stringify({
        ts: "2026-07-06T12:00:00.000Z",
        run_id: "self-test",
        trace_id: "self-test-trace",
        span_id: String(index + 1).padStart(16, "0"),
        parent_span_id: index === 0 ? null : String(index).padStart(16, "0"),
        corr_key: "ch=c1;tmp=t1",
        layer: name.startsWith("pc.") ? "pc" : "helix",
        direction: name.includes(".in") || name.includes(".recv") ? "in" : "out",
        name,
        payload: { marker: name },
        result: {},
        duration_ms: 1,
        error: null,
      }),
    )
    .join("\n");
}

function parseJsonl(text) {
  const events = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch (error) {
        throw new Error(`invalid JSONL line ${index + 1}: ${error.message}`);
      }
  }
  return events;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.selfTest ? selfTestLines() : readFileSync(args.input, "utf8");
  const events = parseJsonl(text);
  const traceId = args.traceId || events.find((event) => event.trace_id)?.trace_id;
  if (!traceId) throw new Error("trace id is required or must exist in input");

  const scoped = events.filter((event) => event.trace_id === traceId);
  const names = new Set(scoped.map((event) => event.name));
  const missing = requiredNames.filter((name) => !names.has(name));
  if (missing.length > 0) {
    console.error(`trace ${traceId} is missing JSONL events:`);
    for (const name of missing) console.error(`- ${name}`);
    console.error(`observed names: ${[...names].sort().join(", ") || "(none)"}`);
    process.exit(1);
  }
  console.log(`trace ${traceId} contains required JSONL trace events (${scoped.length} events observed)`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exit(2);
}
