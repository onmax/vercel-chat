import { describe, expect, it } from "vitest";
import {
  normalizeRcsSenderId,
  parseChannelMetadata,
  resolveInboundThreadSender,
} from "./channel";

describe("parseChannelMetadata", () => {
  it("parses a plain object", async () => {
    expect(parseChannelMetadata('{"type":"rcs"}')).toEqual({ type: "rcs" });
  });

  it("rejects arrays", async () => {
    expect(parseChannelMetadata('["rcs"]')).toBeUndefined();
  });

  it("rejects null and invalid JSON", async () => {
    expect(parseChannelMetadata("null")).toBeUndefined();
    expect(parseChannelMetadata("not-json")).toBeUndefined();
    expect(parseChannelMetadata(undefined)).toBeUndefined();
  });
});

describe("resolveInboundThreadSender", () => {
  it("keeps the phone sender for plain SMS routed through a messaging service", async () => {
    // Twilio sends MessagingServiceSid on every inbound webhook for numbers
    // in a Messaging Service; SMS threads must stay keyed by phone number.
    expect(
      resolveInboundThreadSender({
        messagingServiceSid: "MG123",
        to: "+15550000001",
      })
    ).toBe("+15550000001");
  });

  it("uses the webhook MessagingServiceSid for inbound RCS metadata", async () => {
    expect(
      resolveInboundThreadSender({
        channelMetadata: { type: "rcs" },
        messagingServiceSid: "MG123",
        to: "+15550000001",
      })
    ).toBe("MG123");
  });

  it("keeps rcs: addresses as the thread sender", async () => {
    expect(
      resolveInboundThreadSender({
        messagingServiceSid: "MG123",
        to: "rcs:brand_agent",
      })
    ).toBe("rcs:brand_agent");
  });

  it("uses configured messaging service for inbound RCS metadata", async () => {
    expect(
      resolveInboundThreadSender({
        channelMetadata: { type: "rcs" },
        messagingServiceSidConfig: "MG123",
        to: "+15550000001",
      })
    ).toBe("MG123");
  });

  it("uses configured rcsSenderId for inbound RCS metadata", async () => {
    expect(
      resolveInboundThreadSender({
        channelMetadata: { type: "rcs" },
        rcsSenderIdConfig: "brand_agent",
        to: "+15550000001",
      })
    ).toBe("rcs:brand_agent");
  });

  it("keeps plain phone sender for non-RCS inbound", async () => {
    expect(
      resolveInboundThreadSender({
        messagingServiceSidConfig: "MG123",
        to: "+15550000001",
      })
    ).toBe("+15550000001");
  });
});

describe("normalizeRcsSenderId", () => {
  it("adds the rcs: prefix when missing", async () => {
    expect(normalizeRcsSenderId("brand_agent")).toBe("rcs:brand_agent");
    expect(normalizeRcsSenderId("rcs:brand_agent")).toBe("rcs:brand_agent");
  });
});
