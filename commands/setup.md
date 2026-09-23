---
description: Verify prerequisites and install the canonical Vercel coding-agent plugin on an authorized local device.
---
# Setup

1. Confirm the `agents-ai-nextjs-bridge` MCP server is connected (it runs on
   the local device, e.g. Termux) and confirm the intended project directory.
2. Call the `doctor` tool with that `cwd`. Stop and report if `ok` is false.
3. Call `setup_vercel_plugin` with that `cwd` and no `confirm` (dry run) and
   show the user the exact command.
4. After the user agrees, call `setup_vercel_plugin` again with `confirm: true`.
5. Verify with the `status` tool (or `claude plugin list`).
6. Report the exact evidence (exit code, output, files found); do not infer
   success from exit code alone if plugin files cannot be found.
