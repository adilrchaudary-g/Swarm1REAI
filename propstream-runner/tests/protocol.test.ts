import { describe, expect, it } from "vitest";
import { buildEnvelope, validateCommandEnvelope } from "../src/protocol.js";

describe("protocol", () => {
  it("validates a command envelope", () => {
    const envelope = {
      envelope_version: "1.0",
      message_id: "abc",
      timestamp: new Date().toISOString(),
      source: "swarm",
      lane: "houses",
      type: "command",
      correlation_id: null,
      payload: {
        command_type: "SEARCH",
        zip: "77084",
      },
    };

    expect(validateCommandEnvelope(envelope).payload.command_type).toBe("SEARCH");
  });

  it("builds a result envelope", () => {
    const envelope = buildEnvelope("result", { ok: true });
    expect(envelope.type).toBe("result");
    expect(envelope.source).toBe("playwright-runner");
  });
});
