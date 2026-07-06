import { Injectable } from "@angular/core";

export interface TraceSidecar {
  traceparent: string;
  baggage?: string;
}

export function traceIdFromTraceparent(traceparent: string): string {
  const parts = traceparent.trim().toLowerCase().split("-");
  if (parts.length !== 4 || parts[1]?.length !== 32) return "";
  return parts[1];
}

export function parentSpanIdFromTraceparent(traceparent: string): string {
  const parts = traceparent.trim().toLowerCase().split("-");
  if (parts.length !== 4 || parts[2]?.length !== 16) return "";
  return parts[2];
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
