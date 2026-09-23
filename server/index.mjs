#!/usr/bin/env node
// Agents AI Next.js Bridge — MCP server (stdio, zero dependencies).
//
// Speaks the Model Context Protocol over newline-delimited JSON-RPC 2.0 on
// stdin/stdout, so it runs anywhere Node.js 18+ runs — including Termux on
// Android — without `npm install`. Logs go to stderr only; stdout is reserved
// for protocol messages.

import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

const SERVER_INFO = { name: 'agents-ai-nextjs-bridge', version: '0.2.0' };
const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const VERCEL_PLUGIN = 'vercel/vercel-plugin';

const log = (...args) => process.stderr.write(`[${SERVER_INFO.name}] ${args.join(' ')}\n`);

// ---------------------------------------------------------------------------
// Helpers

function run(cmd, args, { cwd = process.cwd(), timeoutMs = 15000 } = {}) {
  return new Promise((done) => {
    let stdout = '';
    let stderr = '';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      done({ ok: false, code: null, stdout, stderr: String(err), missing: true });
      return;
    }
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => {
      clearTimeout(timer);
      done({ ok: false, code: null, stdout, stderr: String(err), missing: err.code === 'ENOENT' });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      done({ ok: code === 0, code, signal, stdout: stdout.trim(), stderr: stderr.trim(), missing: false });
    });
  });
}

async function version(cmd) {
  const r = await run(cmd, ['--version'], { timeoutMs: 10000 });
  if (r.missing) return null;
  return (r.stdout || r.stderr).split('\n')[0] || '(unknown version)';
}

function isTermux() {
  return Boolean(process.env.TERMUX_VERSION) || (process.env.PREFIX || '').includes('com.termux');
}

function resolveDir(dir) {
  const target = resolve(dir || process.cwd());
  if (!existsSync(target) || !statSync(target).isDirectory()) {
    throw new Error(`Directory does not exist: ${target}`);
  }
  return target;
}

function writable(dir) {
  try {
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Looks for the Vercel plugin in Claude Code's on-disk plugin registry. This is
// evidence, not proof: `claude plugin list` is preferred when available.
function findVercelPluginOnDisk() {
  const root = join(homedir(), '.claude', 'plugins');
  const hits = [];
  const installed = join(root, 'installed_plugins.json');
  if (existsSync(installed)) {
    try {
      const text = readFileSync(installed, 'utf8');
      if (/vercel-plugin/.test(text)) hits.push(installed);
    } catch { /* unreadable, ignore */ }
  }
  for (const sub of ['cache', 'marketplaces']) {
    const dir = join(root, sub);
    if (!existsSync(dir)) continue;
    try {
      for (const name of readdirSync(dir)) {
        if (/vercel/i.test(name)) hits.push(join(dir, name));
      }
    } catch { /* ignore */ }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Tool implementations

async function doctor({ cwd } = {}) {
  const dir = resolveDir(cwd);
  const [node, npm, npx, bun, git] = await Promise.all(['node', 'npm', 'npx', 'bun', 'git'].map(version));
  const nodeMajor = Number((process.versions.node || '0').split('.')[0]);
  const termux = isTermux();
  const canWrite = writable(dir);

  const checks = [
    { domain: 'toolchain', name: 'node', required: true, ok: nodeMajor >= 18, detail: node || process.version, note: 'need >= 18' },
    { domain: 'toolchain', name: 'npm', required: true, ok: Boolean(npm), detail: npm, note: termux ? 'pkg install nodejs' : 'required' },
    { domain: 'toolchain', name: 'npx', required: true, ok: Boolean(npx), detail: npx, note: termux ? 'pkg install nodejs' : 'required' },
    { domain: 'toolchain', name: 'bun', required: false, ok: Boolean(bun), detail: bun, note: termux ? 'optional; Bun has no official Android build' : 'optional' },
    { domain: 'local', name: 'git', required: true, ok: Boolean(git), detail: git, note: termux ? 'pkg install git' : 'required' },
    { domain: 'local', name: 'cwd-write', required: true, ok: canWrite, detail: dir, note: termux && dir.startsWith('/storage') ? 'run termux-setup-storage, or work under $HOME' : 'need write access' },
  ];
  const ok = checks.every((c) => c.ok || !c.required);

  const lines = ['Agents AI Next.js Bridge doctor', '--------------------------------'];
  const termuxLabel = process.env.TERMUX_VERSION ? `Termux ${process.env.TERMUX_VERSION}` : 'Termux';
  lines.push(`host: ${platform()}/${arch()}${termux ? ` (${termuxLabel})` : ''}`);
  let domain = '';
  for (const c of checks) {
    if (c.domain !== domain) {
      domain = c.domain;
      lines.push('', domain === 'toolchain' ? '[1/3] Vercel / Next.js / AI SDK toolchain' : '[2/3] Local device');
    }
    const state = c.ok ? 'OK     ' : c.required ? 'MISSING' : 'absent ';
    lines.push(`${c.name.padEnd(9)} ${state} ${c.ok ? c.detail : c.note}`);
  }
  lines.push('', '[3/3] Remote SDK-dev (authenticated SaaS/OAuth via Zapier MCP)');
  lines.push('not checkable from this server; confirm the connector in your MCP host (e.g. /mcp).');
  lines.push('', '--------------------------------');
  lines.push(ok ? 'Result: local prerequisites look OK.' : 'Result: one or more required prerequisites are missing.');

  return { text: lines.join('\n'), structured: { ok, termux, cwd: dir, checks }, isError: false };
}

async function status({ cwd } = {}) {
  const diag = await doctor({ cwd });
  let vercel = { installed: 'unknown', evidence: [] };

  const list = await run('claude', ['plugin', 'list'], { timeoutMs: 20000 });
  if (!list.missing && list.ok) {
    const found = /vercel-plugin/.test(list.stdout);
    vercel = { installed: found, evidence: ['claude plugin list'], output: list.stdout };
  } else {
    const hits = findVercelPluginOnDisk();
    vercel = hits.length
      ? { installed: true, evidence: hits, note: 'found on disk; `claude` CLI not available to confirm' }
      : { installed: 'unknown', evidence: [], note: '`claude plugin list` unavailable and nothing found under ~/.claude/plugins' };
  }

  const local = {
    online: true,
    termux: diag.structured.termux,
    ready: diag.structured.checks.filter((c) => c.domain === 'local').every((c) => c.ok),
  };
  const saas = { bridgeLoaded: true, connector: 'unknown — check your MCP host (e.g. /mcp)' };

  const text = [
    `Vercel plugin (${VERCEL_PLUGIN}): installed=${vercel.installed}${vercel.evidence.length ? ` [evidence: ${vercel.evidence.join(', ')}]` : ''}${vercel.note ? ` — ${vercel.note}` : ''}`,
    `Local device: online (this server is running)${local.termux ? ' on Termux' : ''}; execution ready=${local.ready}`,
    `Remote SDK-dev: bridge MCP server loaded; Zapier/OAuth connector=${saas.connector}`,
    '',
    diag.text,
  ].join('\n');

  return { text, structured: { vercelPlugin: vercel, localDevice: local, remoteSdkDev: saas, doctor: diag.structured }, isError: false };
}

async function setupVercelPlugin({ cwd, confirm } = {}) {
  const dir = resolveDir(cwd);
  if (confirm !== true) {
    return {
      text: `Dry run. Would run in ${dir}:\n  npx plugins add ${VERCEL_PLUGIN}\nCall again with confirm: true to install.`,
      structured: { ran: false, cwd: dir, command: `npx plugins add ${VERCEL_PLUGIN}` },
      isError: false,
    };
  }
  const diag = await doctor({ cwd: dir });
  if (!diag.structured.ok) {
    return { text: `Prerequisites missing; not installing.\n\n${diag.text}`, structured: { ran: false, doctor: diag.structured }, isError: true };
  }
  const r = await run('npx', ['--yes', 'plugins', 'add', VERCEL_PLUGIN], { cwd: dir, timeoutMs: 300000 });
  const hits = findVercelPluginOnDisk();
  const text = [
    `$ npx --yes plugins add ${VERCEL_PLUGIN}   (cwd: ${dir})`,
    `exit code: ${r.code}${r.signal ? ` (signal ${r.signal})` : ''}`,
    r.stdout && `stdout:\n${r.stdout}`,
    r.stderr && `stderr:\n${r.stderr}`,
    `plugin files found afterwards: ${hits.length ? hits.join(', ') : 'none under ~/.claude/plugins — verify with your host\'s plugin list'}`,
  ].filter(Boolean).join('\n');
  return { text, structured: { ran: true, cwd: dir, exitCode: r.code, filesFound: hits }, isError: !r.ok };
}

const cwdProp = { type: 'string', description: 'Project directory to check. Defaults to the server\'s working directory.' };

const TOOLS = [
  {
    name: 'doctor',
    title: 'Bridge doctor',
    description: 'Check the local toolchain for Vercel/Next.js work: Node.js >= 18, npm, npx, Bun (optional), git, and write access to the project directory. Detects Termux.',
    inputSchema: { type: 'object', properties: { cwd: cwdProp }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: doctor,
  },
  {
    name: 'status',
    title: 'Bridge status',
    description: 'Report readiness across the three bridge domains separately: the canonical Vercel plugin, the local device, and Remote SDK-dev (SaaS/OAuth). Unverifiable states are reported as unknown.',
    inputSchema: { type: 'object', properties: { cwd: cwdProp }, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
    handler: status,
  },
  {
    name: 'setup_vercel_plugin',
    title: 'Install Vercel plugin',
    description: `Install the canonical ${VERCEL_PLUGIN} with \`npx plugins add\`. Without confirm: true this is a dry run that only shows the command.`,
    inputSchema: {
      type: 'object',
      properties: {
        cwd: { type: 'string', description: 'Project directory to install into.' },
        confirm: { type: 'boolean', description: 'Must be true to actually run the install.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    handler: setupVercelPlugin,
  },
];

// ---------------------------------------------------------------------------
// JSON-RPC / MCP plumbing

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case 'initialize': {
      const requested = params.protocolVersion;
      const protocolVersion = PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
      return reply(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: 'Local-device diagnostics for the Agents AI Next.js Bridge. Use `status` before claiming readiness, and `setup_vercel_plugin` (dry run first) to install vercel/vercel-plugin.',
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS.map(({ handler, ...t }) => t) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = await tool.handler(params.arguments || {});
        return reply(id, { content: [{ type: 'text', text: out.text }], structuredContent: out.structured, isError: out.isError });
      } catch (err) {
        return reply(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true });
      }
    }
    default:
      if (method && method.startsWith('notifications/')) return undefined;
      if (isRequest) return fail(id, -32601, `Method not found: ${method}`);
      return undefined;
  }
}

const inFlight = new Set();
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return fail(null, -32700, 'Parse error');
  }
  const batch = Array.isArray(msg) ? msg : [msg];
  for (const m of batch) {
    const job = handle(m).catch((err) => {
      log('handler crashed:', err.stack || err);
      if (m.id !== undefined) fail(m.id, -32603, 'Internal error');
    });
    inFlight.add(job);
    job.finally(() => inFlight.delete(job));
  }
});
// Let in-flight tool calls finish writing their replies before exiting.
rl.on('close', () => Promise.allSettled([...inFlight]).then(() => process.exit(0)));
log(`ready (node ${process.version}${isTermux() ? ', termux' : ''})`);
