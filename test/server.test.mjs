import { spawn } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';

const serverPath = fileURLToPath(new URL('../server/index.mjs', import.meta.url));

function startServer() {
  const child = spawn(process.execPath, [serverPath], { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { child, request, notify, close: () => child.stdin.end() };
}

test('MCP handshake, tools/list and tools/call', async () => {
  const s = startServer();
  try {
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'agents-ai-nextjs-bridge');
    s.notify('notifications/initialized');

    const list = await s.request('tools/list', {});
    assert.deepEqual(list.result.tools.map((t) => t.name).sort(), ['doctor', 'setup_vercel_plugin', 'status']);

    const doc = await s.request('tools/call', { name: 'doctor', arguments: {} });
    assert.equal(doc.result.isError, false);
    assert.match(doc.result.content[0].text, /\[1\/3\]/);
    assert.equal(typeof doc.result.structuredContent.ok, 'boolean');

    const dry = await s.request('tools/call', { name: 'setup_vercel_plugin', arguments: {} });
    assert.equal(dry.result.structuredContent.ran, false);
    assert.match(dry.result.content[0].text, /Dry run/);

    const bad = await s.request('tools/call', { name: 'doctor', arguments: { cwd: '/definitely/not/here' } });
    assert.equal(bad.result.isError, true);

    const unknown = await s.request('nope', {});
    assert.equal(unknown.error.code, -32601);
  } finally {
    s.close();
  }
});
