#!/usr/bin/env node
import { readFileSync } from "node:fs";

const DEFAULT_JAEGER_QUERY_URL = "http://127.0.0.1:16686";

const clientSpanGroups = [
  {
    label: "client action",
    alternatives: ["pc.ui.action", "mobile.js.im_send"],
  },
  {
    label: "client bridge",
    alternatives: ["pc.tauri.invoke", "mobile.core_bridge.call_with_trace"],
  },
  {
    label: "client render",
    alternatives: ["pc.ui.render", "mobile.render"],
  },
];

const requiredMiddleSpans = [
  { name: "helix.command.accept", count: 1 },
  { name: "helix.core.step", count: 1 },
  { name: "helix.storage.persist", count: 1 },
  { name: "helix.event.emit", count: 2 },
  { name: "helix.http.request", count: 1 },
  { name: "cses.http.request", count: 1 },
  { name: "cses.handler.create_post", count: 1 },
  { name: "cses.service.create_post", count: 1 },
  { name: "cses.store.create_post", count: 1 },
  { name: "cses.ws.publish", count: 1 },
  { name: "cses.ws.fanout", count: 1 },
  { name: "cses.ws.deliver", count: 1 },
  { name: "helix.ws.recv", count: 1 },
];

function usage() {
  return [
    "usage: node scripts/otel-trace-check.mjs [--jaeger-url <url>] [--input <json>] <trace-id>",
    "       node scripts/otel-trace-check.mjs --self-test",
    "",
    "options:",
    "  --jaeger-url <url>  Jaeger Query base URL; defaults to JAEGER_QUERY_URL or http://127.0.0.1:16686",
    "  --input <json>      Read Jaeger /api/traces response from a local fixture instead of the network",
    "  --self-test         Run the checker against an embedded passing fixture",
  ].join("\n");
}

function parseArgs(argv) {
  const args = {
    input: "",
    jaegerUrl: process.env.JAEGER_QUERY_URL || DEFAULT_JAEGER_QUERY_URL,
    selfTest: false,
    traceId: "",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--input") {
      args.input = argv[++i] ?? "";
      if (!args.input) {
        throw new Error("--input requires a path");
      }
    } else if (arg === "--jaeger-url" || arg === "--jaeger-query-url") {
      args.jaegerUrl = argv[++i] ?? "";
      if (!args.jaegerUrl) {
        throw new Error(`${arg} requires a URL`);
      }
    } else if (arg === "--self-test") {
      args.selfTest = true;
    } else if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else if (!args.traceId) {
      args.traceId = arg;
    } else {
      throw new Error(`unexpected argument: ${arg}`);
    }
  }

  if (args.selfTest) {
    args.traceId = args.traceId || "self-test-trace";
    return args;
  }
  if (!args.traceId) {
    throw new Error("trace id is required");
  }
  if (!args.jaegerUrl) {
    throw new Error("--jaeger-url must not be empty");
  }
  return args;
}

function jaegerTraceUrl(baseUrl, traceId) {
  const base = baseUrl.replace(/\/+$/, "");
  const encodedTraceId = encodeURIComponent(traceId);
  if (base.endsWith("/api/traces")) {
    return `${base}/${encodedTraceId}`;
  }
  if (base.endsWith("/api")) {
    return `${base}/traces/${encodedTraceId}`;
  }
  return `${base}/api/traces/${encodedTraceId}`;
}

function fixtureResponse() {
  const spanNames = [
    "pc.ui.action",
    "pc.tauri.invoke",
    "helix.command.accept",
    "helix.core.step",
    "helix.storage.persist",
    "helix.event.emit",
    "helix.http.request",
    "cses.http.request",
    "cses.handler.create_post",
    "cses.service.create_post",
    "cses.store.create_post",
    "cses.ws.publish",
    "cses.ws.fanout",
    "cses.ws.deliver",
    "helix.ws.recv",
    "helix.event.emit",
    "pc.ui.render",
  ];
  return {
    data: [
      {
        traceID: "self-test-trace",
        spans: spanNames.map((operationName, index) => ({
          traceID: "self-test-trace",
          spanID: String(index + 1).padStart(16, "0"),
          operationName,
        })),
      },
    ],
  };
}

async function loadTraceResponse(args) {
  if (args.selfTest) {
    return fixtureResponse();
  }
  if (args.input) {
    return JSON.parse(readFileSync(args.input, "utf8"));
  }

  const url = jaegerTraceUrl(args.jaegerUrl, args.traceId);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`jaeger query failed: ${res.status} ${res.statusText} (${url})`);
  }
  return res.json();
}

function collectSpanCounts(body) {
  const traces = Array.isArray(body?.data) ? body.data : [];
  const counts = new Map();

  for (const trace of traces) {
    const spans = Array.isArray(trace?.spans) ? trace.spans : [];
    for (const span of spans) {
      if (typeof span?.operationName !== "string" || span.operationName.length === 0) {
        continue;
      }
      counts.set(span.operationName, (counts.get(span.operationName) ?? 0) + 1);
    }
  }

  return counts;
}

function formatCount(count) {
  return count === 1 ? "1 span" : `${count} spans`;
}

function evaluateTrace(counts) {
  const missing = [];
  const satisfiedClientGroups = [];

  for (const group of clientSpanGroups) {
    const matched = group.alternatives.filter((name) => (counts.get(name) ?? 0) > 0);
    if (matched.length === 0) {
      missing.push(`${group.label}: one of ${group.alternatives.join(" | ")}`);
    } else {
      satisfiedClientGroups.push(`${group.label}=${matched.join("|")}`);
    }
  }

  for (const expected of requiredMiddleSpans) {
    const actual = counts.get(expected.name) ?? 0;
    if (actual < expected.count) {
      missing.push(`${expected.name}: expected >=${expected.count}, got ${actual}`);
    }
  }

  return { missing, satisfiedClientGroups };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    process.exit(2);
  }

  let body;
  try {
    body = await loadTraceResponse(args);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const counts = collectSpanCounts(body);
  const { missing, satisfiedClientGroups } = evaluateTrace(counts);
  if (missing.length > 0) {
    console.error(`trace ${args.traceId} is missing required spans:`);
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    console.error(`observed operation names: ${[...counts.keys()].sort().join(", ") || "(none)"}`);
    process.exit(1);
  }

  const totalObserved = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const emitCount = counts.get("helix.event.emit") ?? 0;
  console.log(
    `trace ${args.traceId} contains required full-link spans (${formatCount(totalObserved)} observed; helix.event.emit=${emitCount}; ${satisfiedClientGroups.join(", ")})`,
  );
}

await main();
