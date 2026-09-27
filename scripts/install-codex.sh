#!/bin/sh
set -eu

PLUGIN_NAME=agents-ai-nextjs-bridge
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PLUGIN_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
MARKETPLACE=${CODEX_MARKETPLACE_PATH:-"$HOME/.agents/plugins/marketplace.json"}

case "$MARKETPLACE" in
  */.agents/plugins/marketplace.json) ;;
  *)
    echo "CODEX_MARKETPLACE_PATH must be an absolute path ending in /.agents/plugins/marketplace.json." >&2
    exit 1
    ;;
esac

MARKETPLACE_DIR=$(dirname -- "$MARKETPLACE")
mkdir -p "$MARKETPLACE_DIR"
MARKETPLACE_DIR=$(CDPATH= cd -- "$MARKETPLACE_DIR" && pwd -P)
MARKETPLACE="$MARKETPLACE_DIR/marketplace.json"
MARKETPLACE_ROOT=$(CDPATH= cd -- "$MARKETPLACE_DIR/../.." && pwd -P)
PLUGIN_DIR=${CODEX_PLUGIN_DIR:-"$MARKETPLACE_ROOT/plugins/$PLUGIN_NAME"}
PLUGIN_DIR=$(node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' "$PLUGIN_DIR")

MARKETPLACE_PLUGIN_PATH=$(node - "$MARKETPLACE_ROOT" "$PLUGIN_DIR" <<'NODE'
const path = require('node:path');
const marketplaceRoot = path.resolve(process.argv[2]);
const pluginDir = path.resolve(process.argv[3]);
const relative = path.relative(marketplaceRoot, pluginDir);

if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
  console.error('CODEX_PLUGIN_DIR must be inside the marketplace root (' + marketplaceRoot + '): ' + pluginDir);
  process.exit(1);
}

process.stdout.write('./' + relative.split(path.sep).join('/'));
NODE
)

mkdir -p "$(dirname -- "$PLUGIN_DIR")"

if [ -L "$PLUGIN_DIR" ]; then
  if ! current=$(CDPATH= cd -- "$PLUGIN_DIR" 2>/dev/null && pwd -P); then
    echo "Refusing to use broken symlink: $PLUGIN_DIR" >&2
    exit 1
  fi
  if [ "$current" != "$PLUGIN_ROOT" ]; then
    echo "Refusing to replace $PLUGIN_DIR (it points to $current)." >&2
    exit 1
  fi
elif [ -e "$PLUGIN_DIR" ]; then
  if [ ! -d "$PLUGIN_DIR" ]; then
    echo "Refusing to replace existing path: $PLUGIN_DIR" >&2
    exit 1
  fi
  current=$(CDPATH= cd -- "$PLUGIN_DIR" && pwd -P)
  if [ "$current" != "$PLUGIN_ROOT" ]; then
    echo "Refusing to replace existing directory: $PLUGIN_DIR (it resolves to $current)." >&2
    exit 1
  fi
else
  ln -s "$PLUGIN_ROOT" "$PLUGIN_DIR"
fi

encoded_marketplace=$(node - "$MARKETPLACE" "$PLUGIN_NAME" "$MARKETPLACE_PLUGIN_PATH" <<'NODE'
const fs = require('node:fs/promises');
const path = require('node:path');

async function main() {
  const marketplace = path.resolve(process.argv[2]);
  const pluginName = process.argv[3];
  const pluginPath = process.argv[4];
  let data;

  try {
    data = JSON.parse(await fs.readFile(marketplace, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    data = {
      name: 'personal',
      interface: { displayName: 'Personal' },
      plugins: [],
    };
  }

  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error('Marketplace file must contain a JSON object.');
  }
  if (data.plugins === undefined) data.plugins = [];
  if (!Array.isArray(data.plugins)) {
    throw new Error('Marketplace plugins property must be an array.');
  }

  const entry = {
    name: pluginName,
    source: { source: 'local', path: pluginPath },
    policy: {
      installation: 'INSTALLED_BY_DEFAULT',
      authentication: 'ON_INSTALL',
    },
    category: 'Developer Tools',
  };
  const index = data.plugins.findIndex((existing) => existing && existing.name === pluginName);
  if (index === -1) data.plugins.push(entry);
  else data.plugins[index] = entry;

  const temporary = path.join(path.dirname(marketplace), 'marketplace-' + process.pid + '.tmp');
  const file = await fs.open(temporary, 'wx', 0o600);
  try {
    await file.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8');
  } finally {
    await file.close();
  }
  try {
    await fs.rename(temporary, marketplace);
  } catch (error) {
    await fs.unlink(temporary).catch(() => {});
    throw error;
  }

  process.stdout.write(encodeURIComponent(marketplace));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
NODE
)

echo "Installed $PLUGIN_NAME from $PLUGIN_ROOT"
echo "Marketplace: $MARKETPLACE"
echo "Restart Codex, then open:"
echo "codex://plugins/$PLUGIN_NAME?marketplacePath=$encoded_marketplace"
echo "Source: https://github.com/thanabartbb/main"
