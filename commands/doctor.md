---
description: Run the local toolchain diagnostic for the three bridge domains.
---
# Doctor

Call the `doctor` tool on the `agents-ai-nextjs-bridge` MCP server and show its
text output verbatim. If the MCP server is not connected, run
`"${CLAUDE_PLUGIN_ROOT}"/scripts/doctor.sh` instead and show its output.

Then summarize in one line whether local prerequisites are OK, using the
tool's `ok` field (or the script's exit code: 0 = OK, 1 = missing something).
