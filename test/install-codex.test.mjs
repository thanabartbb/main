import { spawnSync } from 'node:child_process';
import { accessSync, chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const pluginName = 'agents-ai-nextjs-bridge';
const installerSource = fileURLToPath(new URL('../scripts/install-codex.sh', import.meta.url));

function findExecutable(name) {
  for (const directory of (process.env.PATH || '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep checking PATH.
    }
  }
  throw new Error('Could not find executable: ' + name);
}

function createFixture({ checkoutAtPluginDestination = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'codex-install-test-'));
  const home = join(root, 'home with spaces');
  mkdirSync(home, { recursive: true });
  const checkout = checkoutAtPluginDestination
    ? join(home, 'plugins', pluginName)
    : join(root, 'checkout');
  const script = join(checkout, 'scripts', 'install-codex.sh');
  mkdirSync(join(checkout, 'scripts'), { recursive: true });
  copyFileSync(installerSource, script);
  chmodSync(script, 0o755);
  return {
    root,
    home,
    checkout,
    script,
    marketplace: join(home, '.agents', 'plugins', 'marketplace.json'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function makeNodeOnlyPath(root) {
  const path = join(root, 'path-without-python');
  mkdirSync(path);
  for (const command of ['node', 'dirname', 'mkdir', 'ln']) {
    symlinkSync(findExecutable(command), join(path, command));
  }
  return path;
}

function runInstaller(fixture, extraEnv = {}, path = process.env.PATH) {
  return spawnSync(findExecutable('sh'), [fixture.script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: path,
      ...extraEnv,
    },
  });
}

function readMarketplace(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('custom plugin directory is recorded relative to the marketplace root and runs without Python', (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const pluginDir = join(fixture.home, 'custom', 'bridge-plugin');
  const restrictedPath = makeNodeOnlyPath(fixture.root);

  const result = runInstaller(fixture, { CODEX_PLUGIN_DIR: pluginDir }, restrictedPath);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(realpathSync(pluginDir), realpathSync(fixture.checkout));
  const entries = readMarketplace(fixture.marketplace).plugins;
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source.path, './custom/bridge-plugin');
  assert.match(result.stdout, new RegExp('marketplacePath=' + encodeURIComponent(fixture.marketplace)));

  const secondRun = runInstaller(fixture, { CODEX_PLUGIN_DIR: pluginDir }, restrictedPath);
  assert.equal(secondRun.status, 0, secondRun.stderr);
  assert.equal(readMarketplace(fixture.marketplace).plugins.length, 1);
});

test('accepts a checkout already at the default plugin destination', (t) => {
  const fixture = createFixture({ checkoutAtPluginDestination: true });
  t.after(fixture.cleanup);

  const result = runInstaller(fixture, { CODEX_PLUGIN_DIR: fixture.checkout });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(lstatSync(fixture.checkout).isDirectory(), true);
  assert.equal(lstatSync(fixture.checkout).isSymbolicLink(), false);
  assert.equal(readMarketplace(fixture.marketplace).plugins[0].source.path, './plugins/' + pluginName);
});

test('rejects plugin directory overrides outside the marketplace root before linking', (t) => {
  const fixture = createFixture();
  t.after(fixture.cleanup);
  const outside = join(fixture.root, 'outside', pluginName);

  const result = runInstaller(fixture, { CODEX_PLUGIN_DIR: outside });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CODEX_PLUGIN_DIR must be inside the marketplace root/);
  assert.equal(existsSync(outside), false);
  assert.equal(existsSync(fixture.marketplace), false);
});
