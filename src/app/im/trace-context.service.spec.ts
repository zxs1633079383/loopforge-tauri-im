import { TestBed } from "@angular/core/testing";

import {
  isValidTraceparent,
  parentSpanIdFromTraceparent,
  TraceContextService,
} from "./trace-context.service";

describe("TraceContextService", () => {
  it("creates valid W3C traceparent and exposes trace id", () => {
    const service = TestBed.inject(TraceContextService);
    const trace = service.startTrace();

    expect(trace.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(isValidTraceparent(trace.traceparent)).toBeTrue();
    expect(service.traceId(trace)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("creates child sidecar without changing trace id", () => {
    const service = TestBed.inject(TraceContextService);
    const root = service.startTrace();
    const child = service.childTrace(root);

    expect(service.traceId(child)).toBe(service.traceId(root));
    expect(parentSpanIdFromTraceparent(child.traceparent)).toMatch(/^[0-9a-f]{16}$/);
    expect(child.traceparent).not.toBe(root.traceparent);
    expect(child.baggage).toBe(root.baggage);
    expect(service.currentTraceparent()).toBeUndefined();
  });

  it("rejects malformed traceparents when reading trace ids", () => {
    const service = TestBed.inject(TraceContextService);

    expect(service.traceId({ traceparent: "not-a-traceparent" })).toBe("");
    expect(isValidTraceparent("00-00000000000000000000000000000000-0000000000000001-01")).toBeFalse();
  });

  it("restores previous trace after nested withTraceScope", () => {
    const service = TestBed.inject(TraceContextService);
    const outer = service.startTrace();
    const inner = service.startTrace();

    service.withTraceScope(outer, () => {
      expect(service.currentTraceparent()).toBe(outer.traceparent);
      service.withTraceScope(inner, () => {
        expect(service.currentTraceparent()).toBe(inner.traceparent);
      });
      expect(service.currentTraceparent()).toBe(outer.traceparent);
    });

    expect(service.currentTraceparent()).toBeUndefined();
  });

  it("suppresses current trace inside withoutTrace", () => {
    const service = TestBed.inject(TraceContextService);
    const trace = service.startTrace();

    service.withTraceScope(trace, () => {
      expect(service.currentTraceparent()).toBe(trace.traceparent);
      service.withoutTrace(() => {
        expect(service.currentTraceparent()).toBeUndefined();
      });
      expect(service.currentTraceparent()).toBe(trace.traceparent);
    });
  });

  it("keeps scoped trace across async callbacks and restores afterward", async () => {
    const service = TestBed.inject(TraceContextService);
    const trace = service.startTrace();

    await service.withTraceScope(trace, async () => {
      expect(service.currentTraceparent()).toBe(trace.traceparent);
      await Promise.resolve();
      expect(service.currentTraceparent()).toBe(trace.traceparent);
    });

    expect(service.currentTraceparent()).toBeUndefined();
  });
});
