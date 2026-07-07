import { TestBed } from "@angular/core/testing";

import { TauriBridgeService } from "./tauri-bridge.service";

describe("TauriBridgeService", () => {
  let service: TauriBridgeService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(TauriBridgeService);
  });

  it("accepts explicit inheritCurrent option without throwing outside Tauri", async () => {
    await service.recordTraceEvent({ name: "pc.trace.noop" });
    await service.recordTraceEvent(
      { name: "pc.trace.noop" },
      { inheritCurrent: true },
    );

    expect(true).toBeTrue();
  });
});
