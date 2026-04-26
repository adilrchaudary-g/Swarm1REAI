# Userscript

This folder is reserved for Codex's deliverables per `docs/codex-handoff-v2.md`, Section 13.

## Expected files (to be populated by Codex)

```
userscript/
├── propstream-swarm-bridge.user.js   The TamperMonkey userscript itself
├── README.md                         Install + first-run setup
├── PROTOCOL.md                       JSON envelope and command schemas
├── SELECTORS.md                      PropStream DOM selectors + fallbacks
└── TEST_CHECKLIST.md                 Runnable testing path from handoff §12
```

## For Codex

1. Read `../docs/codex-handoff-v2.md` end to end before writing any code.
2. Resolve the open decisions in §14 with the operator first.
3. Build per the testing path in §12 — don't skip steps.
4. Update `../docs/changelog.md` whenever you make a significant decision (e.g., chose long-poll over short-poll, picked a specific transport library, found a workaround for a PropStream UI quirk).

## For the operator

Until Codex delivers, this folder is empty by design. If you're seeing this README and there's no userscript yet, that's the state — not a bug.
