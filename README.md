# Agents AI Next.js Bridge

A thin routing plugin for keeping Vercel/Next.js agent work deterministic across three tool domains:

- **Official Vercel Plugin** — current Vercel, Next.js, AI SDK, deployment, performance, and architecture knowledge.
- **Remote Desktop Commander** — local filesystem, terminal, process, package, git, and test execution on an authorized device.
- **Remote SDK-dev** — authenticated SaaS/OAuth actions through Zapier MCP.

## Why this exists

The canonical Vercel coding-agent plugin is installed separately with:

```bash
npx plugins add vercel/vercel-plugin
```

This bridge intentionally does **not** fork or rename the Vercel knowledge base. It only defines routing, verification, and safety boundaries so local shell work and SaaS actions don't overlap or duplicate each other.

## MCP server

`server/index.mjs` is a real MCP server (stdio transport, JSON-RPC 2.0) with
**zero npm dependencies** — it only needs Node.js 18+, so it runs as-is on
Termux. It exposes three tools:

| Tool                  | What it does                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `doctor`              | Checks Node.js ≥ 18, npm, npx, Bun (optional), git, and write access to `cwd`. Detects Termux. Read-only. |
| `status`              | Reports the three domains separately: Vercel plugin (via `claude plugin list` or `~/.claude/plugins`), local device, and Remote SDK-dev. Unverifiable states come back as `unknown`. Read-only. |
| `setup_vercel_plugin` | Runs `npx plugins add vercel/vercel-plugin` in `cwd`. Dry run unless called with `confirm: true`. |

Every tool returns human-readable text plus `structuredContent` JSON.

### Run it on Termux (Android)

```bash
pkg update && pkg install git
node --version || pkg install nodejs-lts   # nodejs-lts or nodejs both work; keep whichever you have
git clone https://github.com/thanabartbb/main.git ~/agents-ai-nextjs-bridge
cd ~/agents-ai-nextjs-bridge
npm test                 # MCP handshake + tool calls, no install needed
```

Then register it with whichever MCP client runs on the phone. For Claude Code
running inside Termux:

```bash
claude mcp add agents-ai-nextjs-bridge -- node ~/agents-ai-nextjs-bridge/server/index.mjs
```

For any other client, the generic config is:

```json
{
  "mcpServers": {
    "agents-ai-nextjs-bridge": {
      "command": "node",
      "args": ["/data/data/com.termux/files/home/agents-ai-nextjs-bridge/server/index.mjs"]
    }
  }
}
```

> **Claude Code does not run natively on Termux.** Its npm package ships no
> `linux-arm64-android` binary (`claude --version` fails with "native binary
> not installed"). The MCP server itself works on Termux — verified on
> android/arm64, Termux 0.119.0-beta.3, Node v24.18.0. To use it from Claude
> Code, either run Claude Code inside `proot-distro` Ubuntu (untested), or use
> another MCP client that runs on Android.

Termux notes: Bun has no official Android build, so `bun` shows as `absent`
(it is optional). To work on files in shared storage, run `termux-setup-storage`
first; otherwise keep projects under `$HOME`.

When installed as a Claude Code plugin (below), `.mcp.json` starts the server
automatically — no `claude mcp add` needed.

## Install (Claude Code)

Pick whichever fits how you use this:

### Option A — personal, no marketplace (fastest)

Copy this whole folder into your personal skills directory and restart Claude Code (or run `/reload-plugins`):

```bash
git clone https://github.com/thanabartbb/main.git ~/.claude/skills/agents-ai-nextjs-bridge
```

It loads automatically as `agents-ai-nextjs-bridge@skills-dir` — no marketplace, no install step, no uninstall step. To stop using it, delete the folder or run `claude plugin disable agents-ai-nextjs-bridge@skills-dir`.

### Option B — project-scoped, shared with your team

Put the folder at `<your-repo>/.claude/skills/agents-ai-nextjs-bridge/` and commit it. Anyone who clones the repo and trusts the workspace gets it automatically.

### Option C — via a marketplace (for distributing to others outside your repo)

This package ships its own single-plugin marketplace manifest (`.claude-plugin/marketplace.json`), so you can also do:

```bash
/plugin marketplace add /path/to/agents-ai-nextjs-bridge
/plugin install agents-ai-nextjs-bridge@agents-ai-nextjs-bridge-marketplace
```

(or point `marketplace add` at a git URL if you push this folder to its own repo).

## Verify it loaded

```bash
claude plugin list
```

You should see `agents-ai-nextjs-bridge` (with a `@skills-dir` or marketplace suffix depending on which option you used).

## Commands this plugin adds

| Command    | What it does                                                              |
| ---------- | --------------------------------------------------------------------------- |
| `/setup`   | Runs `doctor`, then `setup_vercel_plugin` (dry run, then confirmed) to install `vercel/vercel-plugin`. |
| `/status`  | Calls the `status` MCP tool — readiness across all three domains (Vercel plugin, local device, SaaS/OAuth). |
| `/doctor`  | Calls the `doctor` MCP tool — Node.js, npm, npx, Bun (optional), git, and cwd write access. |

If the MCP server is not connected, the commands fall back to the shell script,
which you can also run yourself outside Claude Code:

```bash
sh scripts/doctor.sh
```

## Current state

- MCP server: `server/index.mjs` (stdio, zero dependencies), `doctor` verified on a real Termux device.
- Claude Code on Termux: not available natively (no Android binary); proot-distro route not yet tried.
- Remote SDK-dev skill: `agents-ai-nextjs-bridge` created.
- Remote Desktop Commander: pending until an authorized device is online.
- No secrets are stored in this package.
