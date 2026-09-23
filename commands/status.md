---
description: Show bridge health across Vercel knowledge, local execution, and SaaS actions.
---
# Status

Call the `status` tool on the `agents-ai-nextjs-bridge` MCP server and use its
output as the evidence. If the MCP server is not connected, say so, then fall
back to `"${CLAUDE_PLUGIN_ROOT}"/scripts/doctor.sh` plus `claude plugin list`.
Do not report a state you have not verified with a command or tool call.

Report three independent states:
- Vercel plugin: canonical package name (`vercel/vercel-plugin`), installed
  true / false / unknown, and the evidence the tool returned.
- Local device: whether the MCP server is running (and on Termux), plus local
  execution readiness from the doctor section.
- Remote SDK-dev: bridge loaded, and whether authenticated app actions are
  available (check the host's MCP/connector status, e.g. `/mcp`).

Do not collapse these into a single green/red state; partial readiness is valid.
