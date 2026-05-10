import type { RunnerConfig } from "../config.js";
import type { Envelope } from "../types.js";

export class HermesTransport {
  constructor(private readonly config: RunnerConfig) {}

  private headers() {
    if (this.config.hermesAuthType === "none") {
      return { "Content-Type": "application/json" };
    }
    if (this.config.hermesAuthType === "custom") {
      return {
        "Content-Type": "application/json",
        [this.config.hermesAuthHeaderName]: this.config.hermesAuthToken,
      };
    }
    return {
      "Content-Type": "application/json",
      [this.config.hermesAuthHeaderName]:
        `${this.config.hermesAuthPrefix}${this.config.hermesAuthToken}`,
    };
  }

  async poll(): Promise<unknown> {
    if (!this.config.hermesPollUrl) {
      throw new Error("Hermes poll URL not configured");
    }

    const controller = new AbortController();
    const timeout =
      this.config.pollMode === "long"
        ? this.config.longPollTimeoutMs + 5_000
        : this.config.pollIntervalMs + 5_000;
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(this.config.hermesPollUrl, {
        method: "GET",
        headers: this.headers(),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Hermes poll failed with HTTP ${response.status}`);
      }
      return response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async postEnvelope(envelope: Envelope<object>, typeOverride?: "heartbeat" | "event") {
    const url =
      typeOverride === "heartbeat" && this.config.hermesHeartbeatUrl
        ? this.config.hermesHeartbeatUrl
        : this.config.hermesEventUrl;
    if (!url) {
      throw new Error("Hermes event URL not configured");
    }
    const response = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(envelope),
    });
    if (!response.ok) {
      throw new Error(`Hermes POST failed with HTTP ${response.status}`);
    }
  }
}
