#!/usr/bin/env sh
# Agents AI Next.js Bridge doctor
# Checks the three domains this bridge routes between:
#   1) Official Vercel plugin (Vercel/Next.js/AI SDK knowledge)
#   2) Remote Desktop Commander (local filesystem/terminal/git/tests)
#   3) Remote SDK-dev (authenticated SaaS/OAuth actions via Zapier MCP)
# Exits 0 if the local toolchain prerequisites are met, 1 otherwise.
set -u

printf '%s\n' 'Agents AI Next.js Bridge doctor'
printf '%s\n' '--------------------------------'

status=0

check_version() {
  name="$1"
  cmd="$2"
  note="$3"
  required="$4"
  if command -v "$cmd" >/dev/null 2>&1; then
    ver="$("$cmd" --version 2>/dev/null | head -n1)"
    printf '%-6s OK    %s\n' "$name" "$ver"
  else
    printf '%-6s MISSING (%s)\n' "$name" "$note"
    if [ "$required" = "yes" ]; then
      status=1
    fi
  fi
}

printf '\n[1/3] Vercel / Next.js / AI SDK toolchain\n'
check_version "node" "node" "need >= 18" "yes"
check_version "npm" "npm" "required" "yes"
check_version "bun" "bun" "optional, some plugin tooling prefers it" "no"
check_version "npx" "npx" "required" "yes"

if command -v npx >/dev/null 2>&1; then
  printf 'canonical plugin install command: npx plugins add vercel/vercel-plugin\n'
fi

printf '\n[2/3] Remote Desktop Commander (local device)\n'
if command -v git >/dev/null 2>&1; then
  printf 'git    OK    %s\n' "$(git --version 2>/dev/null)"
else
  printf 'git    MISSING\n'
  status=1
fi
printf 'cwd:   %s\n' "$(pwd)"
if [ -w "$(pwd)" ]; then
  printf 'write access to cwd: OK\n'
else
  printf 'write access to cwd: DENIED\n'
  status=1
fi

printf '\n[3/3] Remote SDK-dev (authenticated SaaS/OAuth via Zapier MCP)\n'
printf 'this bridge does not store credentials; confirm your Zapier MCP\n'
printf 'connection status from inside your agent host (e.g. `/mcp` in\n'
printf 'Claude Code, or your client'"'"'s connector/settings panel).\n'

printf '\n%s\n' '--------------------------------'
if [ "$status" -eq 0 ]; then
  printf 'Result: local prerequisites look OK.\n'
else
  printf 'Result: one or more prerequisites are missing (see above).\n'
fi
exit "$status"
