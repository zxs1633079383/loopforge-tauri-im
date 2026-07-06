import { Injectable } from "@angular/core";

export interface TraceSidecar {
  traceparent: string;
  baggage?: string;
}

function isNonZeroHex(value: string, length: number): boolean {
  return value.length === length &&
    /^[0-9a-f]+$/.test(value) &&
    !/^0+$/.test(value);
}

function isHex(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/.test(value);
}

function traceparentParts(traceparent: string): string[] {
  return traceparent.trim().toLowerCase().split("-");
}

export function isValidTraceparent(traceparent: string): boolean {
  const parts = traceparentParts(traceparent);
  if (parts.length !== 4) return false;
  const [version, traceId, parentSpanId, flags] = parts;
  return isNonZeroHex(traceId ?? "", 32) &&
    isNonZeroHex(parentSpanId ?? "", 16) &&
    isHex(version ?? "", 2) &&
    version !== "ff" &&
    isHex(flags ?? "", 2);
}

export function traceIdFromTraceparent(traceparent: string): string {
  const parts = traceparentParts(traceparent);
  const traceId = parts[1] ?? "";
  if (!isValidTraceparent(traceparent)) return "";
  return traceId;
}

export function parentSpanIdFromTraceparent(traceparent: string): string {
  const parts = traceparentParts(traceparent);
  const spanId = parts[2] ?? "";
  if (!isValidTraceparent(traceparent)) return "";
  return spanId;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return bytes;
  }
  let seed = Date.now() ^ Math.floor(Math.random() * 0xffffffff);
  for (let i = 0; i < bytes.length; i += 1) {
    seed = (1664525 * seed + 1013904223) >>> 0;
    bytes[i] = seed & 0xff;
  }
  return bytes;
}

function nonZeroHex(bytes: number): string {
  const data = randomBytes(bytes);
  if (data.every((value) => value === 0)) {
    data[data.length - 1] = 1;
  }
  return Array.from(data, (value) => value.toString(16).padStart(2, "0")).join("");
}

@Injectable({ providedIn: "root" })
export class TraceContextService {
  startTrace(): TraceSidecar {
    const traceId = nonZeroHex(16);
    const spanId = nonZeroHex(8);
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      baggage: "client=loopforge-tauri-im",
    };
  }

  childTrace(parent: TraceSidecar): TraceSidecar {
    const traceId = traceIdFromTraceparent(parent.traceparent) || nonZeroHex(16);
    const spanId = nonZeroHex(8);
    return {
      traceparent: `00-${traceId}-${spanId}-01`,
      baggage: parent.baggage,
    };
  }

  traceId(trace: TraceSidecar): string {
    return traceIdFromTraceparent(trace.traceparent);
  }
}
