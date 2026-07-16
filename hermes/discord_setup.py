"""One-time Discord server setup — creates channels and webhooks.

Usage:
    python -m hermes.discord_setup

Requires DISCORD_BOT_TOKEN in .env. After running, webhook URLs are
appended to .env and the bot disconnects.
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

try:
    import discord
except ImportError:
    print("discord.py not installed. Run: pip install discord.py")
    sys.exit(1)

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"

CATEGORY_NAME = "hermes-feed"
CHANNELS = [
    ("sets", "Set alerts — caller got a seller interested"),
    ("daily-stats", "End-of-day caller performance summary"),
    ("recordings", "Graded call recordings with scores"),
    ("hot-leads", "High-motivation leads entering pipeline"),
]

WEBHOOK_ENV_KEYS = {
    "sets": "DISCORD_SETS_WEBHOOK",
    "daily-stats": "DISCORD_DAILY_STATS_WEBHOOK",
    "recordings": "DISCORD_RECORDINGS_WEBHOOK",
    "hot-leads": "DISCORD_HOT_LEADS_WEBHOOK",
}


def _load_env() -> None:
    if _ENV_PATH.is_file():
        for line in _ENV_PATH.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            eq = line.find("=")
            if eq == -1:
                continue
            os.environ.setdefault(line[:eq].strip(), line[eq + 1:].strip())


def _append_env(key: str, value: str) -> None:
    text = _ENV_PATH.read_text() if _ENV_PATH.is_file() else ""
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.strip().startswith(f"{key}="):
            lines[i] = f"{key}={value}"
            _ENV_PATH.write_text("\n".join(lines) + "\n")
            return
    with open(_ENV_PATH, "a") as f:
        f.write(f"{key}={value}\n")


async def setup(token: str) -> None:
    intents = discord.Intents.default()
    intents.guilds = True
    client = discord.Client(intents=intents)

    @client.event
    async def on_ready() -> None:
        if not client.guilds:
            print("Bot is not in any server. Invite it first, then re-run.")
            await client.close()
            return

        guild = client.guilds[0]
        print(f"Connected to: {guild.name} (id: {guild.id})")

        category = discord.utils.get(guild.categories, name=CATEGORY_NAME)
        if not category:
            category = await guild.create_category(CATEGORY_NAME)
            print(f"Created category: {CATEGORY_NAME}")
        else:
            print(f"Category already exists: {CATEGORY_NAME}")

        webhook_urls: dict[str, str] = {}

        for ch_name, ch_topic in CHANNELS:
            channel = discord.utils.get(category.text_channels, name=ch_name)
            if not channel:
                channel = await category.create_text_channel(ch_name, topic=ch_topic)
                print(f"  Created #{ch_name}")
            else:
                print(f"  #{ch_name} already exists")

            existing_webhooks = await channel.webhooks()
            hermes_wh = next((w for w in existing_webhooks if w.name == "Hermes"), None)
            if not hermes_wh:
                hermes_wh = await channel.create_webhook(name="Hermes")
                print(f"    Created webhook for #{ch_name}")
            else:
                print(f"    Webhook already exists for #{ch_name}")

            webhook_urls[ch_name] = hermes_wh.url

        print("\n--- Webhook URLs ---")
        for ch_name, url in webhook_urls.items():
            env_key = WEBHOOK_ENV_KEYS[ch_name]
            print(f"  {env_key}={url}")
            _append_env(env_key, url)

        print(f"\nWebhook URLs saved to {_ENV_PATH}")
        print("Restart Hermes to activate: ./swarm restart")
        await client.close()

    await client.start(token)


def main() -> None:
    _load_env()
    token = os.environ.get("DISCORD_BOT_TOKEN")
    if not token:
        print("DISCORD_BOT_TOKEN not found in .env or environment.")
        print("Add it to .env:  DISCORD_BOT_TOKEN=your_token_here")
        sys.exit(1)
    asyncio.run(setup(token))


if __name__ == "__main__":
    main()
