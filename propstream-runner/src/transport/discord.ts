import { redactValue } from "../redaction.js";
import type { Envelope } from "../types.js";

export class DiscordMirror {
  constructor(
    private readonly hooks: {
      commands: string;
      results: string;
      quota: string;
      alfred: string;
    },
  ) {}

  private async post(url: string, content: string) {
    if (!url) return;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch(() => undefined);
  }

  async mirrorCommand(envelope: Envelope<object>) {
    await this.post(this.hooks.commands, `\`\`\`json\n${JSON.stringify(redactValue(envelope), null, 2)}\n\`\`\``);
  }

  async mirrorResult(envelope: Envelope<object>) {
    await this.post(this.hooks.results, `\`\`\`json\n${JSON.stringify(redactValue(envelope), null, 2)}\n\`\`\``);
  }

  async mirrorQuota(payload: object) {
    await this.post(this.hooks.quota, `\`\`\`json\n${JSON.stringify(redactValue(payload), null, 2)}\n\`\`\``);
  }

  async postAlfredAlert(text: string) {
    await this.post(this.hooks.alfred, text);
  }

  async postQuotaAlert(text: string) {
    await this.post(this.hooks.quota, text);
  }
}
