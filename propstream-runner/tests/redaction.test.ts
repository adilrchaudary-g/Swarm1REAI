import { describe, expect, it } from "vitest";
import { redactString, redactValue } from "../src/redaction.js";

describe("redaction", () => {
  it("redacts direct pii strings", () => {
    expect(redactString("Call me at (555) 123-4567 or email test@example.com")).toContain(
      "[REDACTED_PHONE]",
    );
  });

  it("redacts object fields by semantic key", () => {
    const value = redactValue({
      owner_name: "Jane Doe",
      phone_numbers: ["555-123-4567"],
      note: "Contact at test@example.com",
    });

    expect(value).toEqual({
      owner_name: "[REDACTED]",
      phone_numbers: ["[REDACTED_PHONE]"],
      note: "Contact at [REDACTED_EMAIL]",
    });
  });
});
