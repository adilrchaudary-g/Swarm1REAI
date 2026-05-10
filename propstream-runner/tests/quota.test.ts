import { describe, expect, it } from "vitest";
import { BridgeError, QuotaManager } from "../src/quota.js";

describe("quota manager", () => {
  it("requires a recent quota check before cost-bearing work", () => {
    const manager = new QuotaManager();
    expect(() => manager.guardCostBearingCommand("exports", 1)).toThrow(BridgeError);
  });

  it("increments counters and emits threshold alerts", () => {
    const manager = new QuotaManager({
      exports: 27_999,
      remoteRemaining: { exports: 10_000 },
      reconciledAt: new Date().toISOString(),
    });

    const alerts = manager.increment("exports", 1_000);
    expect(alerts.some((item) => item.threshold === 70)).toBe(true);
  });
});
