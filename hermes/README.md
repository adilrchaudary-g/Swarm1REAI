# Hermes

This folder is reserved for the Hermes orchestrator code if/when it gets versioned alongside the rest of the project.

Currently Hermes runs separately. If you ever consolidate Hermes source into this monorepo, it goes here.

## What Hermes is

Hermes is the orchestrator bot powering the Discord operating layer. Its instance name in the operator's server is "Alfred." It:

- Routes messages between Discord channels per agent role
- Maintains an HTTP endpoint that the PropStream userscript bridge polls
- Dispatches commands to agents based on lane and routing rules
- Pins architectural decisions to channels for new contributors
- Tracks state across the Swarm (lead lifecycle transitions, quota rollups, kill-switch state)

## What goes here

If/when Hermes source is consolidated:
- bot entry point
- HTTP API routes
- channel-to-agent routing config
- state persistence layer
- deployment scripts

Until then: empty.
