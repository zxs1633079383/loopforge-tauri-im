#!/usr/bin/env node
import { readFileSync } from "node:fs";

const DEFAULT_JAEGER_QUERY_URL = "http://127.0.0.1:16686";

const middleSpanRequirements = [
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

const middleOrderedGroups = [
  ["helix.command.accept"],
  ["helix.core.step"],
  ["helix.storage.persist"],
  ["helix.event.emit"],
  ["helix.http.request"],
  ["cses.http.request"],
  ["cses.handler.create_post"],
  ["cses.service.create_post"],
  ["cses.store.create_post"],
  ["cses.ws.publish"],
  ["cses.ws.fanout"],
  ["cses.ws.deliver"],
  ["helix.ws.recv"],
  ["helix.event.emit"],
];

const pcOrderedGroups = [
  ["pc.ui.action"],
  ["pc.tauri.invoke", "pc.tauri.invoke.out", "pc.tauri.invoke.in"],
  ["pc.tauri.command", "pc.tauri.command.enqueue"],
  ...middleOrderedGroups,
  ["pc.tauri.app_emit", "pc.tauri.app.emit"],
  ["pc.ui.render"],
];

const mobileOrderedGroups = [
  ["mobile.js.im_send", "mobile.ui.action"],
  ["mobile.core_bridge.call_with_trace", "mobile.native.invoke", "mobile.helix.invoke"],
  ...middleOrderedGroups,
  ["mobile.render", "mobile.ui.render"],
];

const clientSpanGroups = [
  {
    label: "client action",
    alternatives: ["pc.ui.action", "mobile.js.im_send", "mobile.ui.action"],
  },
  {
    label: "client bridge",
    alternatives: [
      "pc.tauri.invoke",
      "pc.tauri.invoke.out",
      "pc.tauri.invoke.in",
      "mobile.core_bridge.call_with_trace",
      "mobile.native.invoke",
      "mobile.helix.invoke",
    ],
  },
  {
    label: "client render",
    alternatives: ["pc.ui.render", "mobile.render", "mobile.ui.render"],
  },
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
    args.traceId = args.traceId || "11111111111111111111111111111111";
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

function fixtureResponse(traceId = "11111111111111111111111111111111") {
  const spanNames = [
    "pc.ui.action",
    "pc.tauri.invoke",
    "pc.tauri.command",
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
    "pc.tauri.app_emit",
    "pc.ui.render",
  ];
  return {
    data: [
      {
        traceID: traceId,
        spans: spanNames.map((operationName, index) => ({
          traceID: traceId,
          spanID: String(index + 1).padStart(16, "0"),
          operationName,
          startTime: index + 1,
          logs:
            operationName === "helix.http.request" || operationName === "cses.http.request"
              ? [{ fields: [{ key: "event", value: "http.request.capture" }] }]
              : operationName === "cses.ws.publish" || operationName === "cses.ws.deliver"
                ? [{ fields: [{ key: "event", value: "ws.payload.capture" }] }]
                : [],
        })),
      },
    ],
  };
}

async function loadTraceResponse(args) {
  if (args.selfTest) {
    return fixtureResponse(args.traceId);
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

function spansFromResponse(body) {
  const traces = Array.isArray(body?.data) ? body.data : [];
  return traces.flatMap((trace) => (Array.isArray(trace?.spans) ? trace.spans : []));
}

function collectSpanCounts(body) {
  const counts = new Map();

  for (const span of spansFromResponse(body)) {
    if (typeof span?.operationName !== "string" || span.operationName.length === 0) {
      continue;
    }
    counts.set(span.operationName, (counts.get(span.operationName) ?? 0) + 1);
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

  for (const expected of middleSpanRequirements) {
    const actual = counts.get(expected.name) ?? 0;
    if (actual < expected.count) {
      missing.push(`${expected.name}: expected >=${expected.count}, got ${actual}`);
    }
  }

  return { missing, satisfiedClientGroups };
}

function assertSameTraceId(body, expectedTraceId) {
  const traces = Array.isArray(body?.data) ? body.data : [];
  const ids = new Set();
  let spanCount = 0;

  for (const trace of traces) {
    if (typeof trace?.traceID === "string" && trace.traceID.length > 0) {
      ids.add(trace.traceID);
    }
    const spans = Array.isArray(trace?.spans) ? trace.spans : [];
    for (const span of spans) {
      spanCount += 1;
      if (typeof span?.traceID === "string" && span.traceID.length > 0) {
        ids.add(span.traceID);
      } else {
        ids.add("(missing span traceID)");
      }
    }
  }

  if (spanCount === 0 || ids.size !== 1 || !ids.has(expectedTraceId)) {
    throw new Error(`trace id mismatch: expected exactly ${expectedTraceId}, got ${[...ids].join(", ") || "(none)"}`);
  }
}

function sortedSpans(body) {
  return spansFromResponse(body).slice().sort((a, b) => {
    const startDelta = (Number(a?.startTime) || 0) - (Number(b?.startTime) || 0);
    if (startDelta !== 0) {
      return startDelta;
    }
    return String(a?.spanID ?? "").localeCompare(String(b?.spanID ?? ""));
  });
}

function chooseOrderedGroups(counts) {
  const hasMobileStart = ["mobile.js.im_send", "mobile.ui.action"].some((name) => (counts.get(name) ?? 0) > 0);
  return hasMobileStart ? mobileOrderedGroups : pcOrderedGroups;
}

function assertOrdered(body, counts) {
  const spans = sortedSpans(body);
  const requiredGroups = chooseOrderedGroups(counts);
  let cursor = 0;

  for (const span of spans) {
    const group = requiredGroups[cursor];
    if (group?.includes(span.operationName)) {
      cursor += 1;
    }
  }

  if (cursor !== requiredGroups.length) {
    throw new Error(`ordering check failed at ${requiredGroups[cursor].join(" | ")}`);
  }
}

function fieldValue(field) {
  if (field && typeof field === "object" && "value" in field) {
    return field.value;
  }
  if (field && typeof field === "object" && "stringValue" in field) {
    return field.stringValue;
  }
  return undefined;
}

function spanHasLogEvent(span, eventName) {
  const logs = Array.isArray(span?.logs) ? span.logs : [];
  const logMatch = logs.some((log) =>
    (Array.isArray(log?.fields) ? log.fields : []).some((field) => field.key === "event" && fieldValue(field) === eventName),
  );
  if (logMatch) {
    return true;
  }

  const tags = Array.isArray(span?.tags) ? span.tags : [];
  return tags.some((tag) => tag.key === "event" && fieldValue(tag) === eventName);
}

function assertCaptureEvents(body) {
  const spans = spansFromResponse(body);
  if (!spans.some((span) => spanHasLogEvent(span, "http.request.capture"))) {
    throw new Error("missing http.request.capture event");
  }
  if (!spans.some((span) => spanHasLogEvent(span, "ws.payload.capture"))) {
    throw new Error("missing ws.payload.capture event");
  }
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

  try {
    assertSameTraceId(body, args.traceId);
    assertOrdered(body, counts);
    assertCaptureEvents(body);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const totalObserved = [...counts.values()].reduce((sum, count) => sum + count, 0);
  const emitCount = counts.get("helix.event.emit") ?? 0;
  console.log(
    `trace ${args.traceId} contains required full-link spans (${formatCount(totalObserved)} observed; helix.event.emit=${emitCount}; ${satisfiedClientGroups.join(", ")}) ordering=ok capture=ok same_trace=ok`,
  );
}

await main();
