#!/bin/sh
set -eu

PLUGIN_NAME=agents-ai-nextjs-bridge
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PLUGIN_DIR=${CODEX_PLUGIN_DIR:-"$HOME/plugins/$PLUGIN_NAME"}
MARKETPLACE=${CODEX_MARKETPLACE_PATH:-"$HOME/.agents/plugins/marketplace.json"}

mkdir -p "$(dirname -- "$PLUGIN_DIR")" "$(dirname -- "$MARKETPLACE")"

if [ -L "$PLUGIN_DIR" ]; then
  current=$(CDPATH= cd -- "$PLUGIN_DIR" && pwd -P)
  if [ "$current" != "$PLUGIN_ROOT" ]; then
    echo "Refusing to replace $PLUGIN_DIR (it points to $current)." >&2
    exit 1
  fi
elif [ -e "$PLUGIN_DIR" ]; then
  echo "Refusing to replace existing path: $PLUGIN_DIR" >&2
  exit 1
else
  ln -s "$PLUGIN_ROOT" "$PLUGIN_DIR"
fi

python3 - "$MARKETPLACE" "$PLUGIN_NAME" <<'PY'
import json
import os
import sys
import tempfile
from pathlib import Path

marketplace = Path(sys.argv[1])
plugin_name = sys.argv[2]

if marketplace.exists():
    data = json.loads(marketplace.read_text(encoding="utf-8"))
else:
    data = {
        "name": "personal",
        "interface": {"displayName": "Personal"},
        "plugins": [],
    }

plugins = data.setdefault("plugins", [])
entry = {
    "name": plugin_name,
    "source": {"source": "local", "path": f"./plugins/{plugin_name}"},
    "policy": {
        "installation": "INSTALLED_BY_DEFAULT",
        "authentication": "ON_INSTALL",
    },
    "category": "Developer Tools",
}

for index, existing in enumerate(plugins):
    if existing.get("name") == plugin_name:
        plugins[index] = entry
        break
else:
    plugins.append(entry)

fd, temporary = tempfile.mkstemp(prefix="marketplace-", suffix=".json", dir=marketplace.parent)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as stream:
        json.dump(data, stream, indent=2)
        stream.write("\n")
    os.replace(temporary, marketplace)
finally:
    if os.path.exists(temporary):
        os.unlink(temporary)
PY

encoded_marketplace=$(python3 - "$MARKETPLACE" <<'PY'
import sys
from pathlib import Path
from urllib.parse import quote

print(quote(str(Path(sys.argv[1]).expanduser().resolve()), safe=""))
PY
)

echo "Installed $PLUGIN_NAME from $PLUGIN_ROOT"
echo "Marketplace: $MARKETPLACE"
echo "Restart Codex, then open:"
echo "codex://plugins/$PLUGIN_NAME?marketplacePath=$encoded_marketplace"
echo "Source: https://github.com/thanabartbb/main"
