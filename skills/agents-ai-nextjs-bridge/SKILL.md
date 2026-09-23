---
name: agents-ai-nextjs-bridge
description: Route Vercel and Next.js work between the official Vercel plugin, Remote Desktop Commander, and Remote SDK-dev. Use for setup, diagnosis, deployment preparation, local shell/file work, or authenticated SaaS actions.
metadata:
  priority: 8
  docs:
    - "https://vercel.com/docs/agent-resources/vercel-plugin"
  promptSignals:
    phrases:
      - "agents ai nextjs"
      - "vercel plugin"
      - "remote desktop commander"
      - "remote sdk-dev"
      - "next.js agent"
---
# Agents AI Next.js Bridge

Use the canonical Vercel plugin for Vercel/Next.js/AI SDK knowledge. Do not maintain a stale fork of the old `agents-ai/agents-ai-nextjs` package name.

## Routing contract
- Vercel/Next.js/AI SDK context and specialist guidance -> official `vercel/vercel-plugin`.
- Local files, terminal commands, package installs, git, tests, and processes -> Remote Desktop Commander.
- Authenticated SaaS/OAuth actions -> Remote SDK-dev / Zapier MCP.
- Readiness checks and installing the Vercel plugin -> this plugin's own
  `agents-ai-nextjs-bridge` MCP server (`doctor`, `status`,
  `setup_vercel_plugin`), which runs on the local device (Termux supported).

## Canonical install
Run on the authorized local device in the intended project directory:

```bash
npx plugins add vercel/vercel-plugin
```

Prefer the MCP tool `setup_vercel_plugin` (dry run first, then `confirm: true`).

Requirements: Node.js 18+ (Bun optional, used by some plugin tooling; it has
no official Android build, so it is usually absent on Termux). The MCP `doctor`
tool (or `"${CLAUDE_PLUGIN_ROOT}"/scripts/doctor.sh` as a fallback) checks both,
plus git and write access to the current directory, in one pass.

## Commands
- `/setup` — verify prerequisites and install the canonical Vercel plugin.
- `/status` — report readiness across all three domains, backed by `/doctor`.
- `/doctor` — run the local toolchain diagnostic directly.

## Safety
Never hardcode API keys, OAuth tokens, session cookies, signed URLs, or credentials. Do not claim install/deploy/test success without direct command or tool evidence.
