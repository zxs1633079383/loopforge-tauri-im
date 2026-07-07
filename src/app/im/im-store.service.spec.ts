import { MessageRow } from "./message-row.model";
import { buildRenderTraceEvent } from "./im-store.service";

describe("buildRenderTraceEvent", () => {
  it("does not attach ambient traceparent to render events", () => {
    const row: MessageRow = {
      msgId: "srv-1",
      temporaryId: "tmp-1",
      channelId: "channel-1",
      eventSeq: 12,
      sendStatus: "sent",
      readBits: "0",
      text: "hello",
    };

    const event = buildRenderTraceEvent(row);

    expect("traceparent" in event).toBeFalse();
    expect(event).toEqual({
      name: "pc.ui.render",
      layer: "pc.ui",
      direction: "internal",
      payload: {
        anchor: "t:tmp-1|channel-1",
        msgId: "srv-1",
        temporaryId: "tmp-1",
        channelId: "channel-1",
        status: "sent",
        text: "hello",
      },
    });
  });

  it("falls back to the stable server anchor when no temporary id exists", () => {
    const row: MessageRow = {
      msgId: "srv-2",
      temporaryId: "",
      channelId: "channel-2",
      eventSeq: 13,
      sendStatus: "sent",
      readBits: "1",
      text: "world",
    };

    const event = buildRenderTraceEvent(row);

    expect(event["payload"]).toEqual({
      anchor: "s:srv-2",
      msgId: "srv-2",
      temporaryId: "",
      channelId: "channel-2",
      status: "sent",
      text: "world",
    });
  });
});
