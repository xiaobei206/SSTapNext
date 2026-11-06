import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

const require = createRequire(import.meta.url);
const { TunController } = require('./tun-controller.cjs');

const node = {
  id: 'node-tun-test', type: 'vless', name: 'TUN Test Node', server: 'edge.example.com', server_port: 443,
  uuid: '00000000-0000-4000-8000-000000000000', tls: { enabled: true, server_name: 'edge.example.com' },
};

function makeFakePowerShell() {
  let sessionDirectory;
  let stopWatcher;
  const spawnImpl = (_exe, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    const sessionArg = args.indexOf('-SessionPath');
    sessionDirectory = args[sessionArg + 1];
    const sessionFile = path.join(sessionDirectory, 'session.json');
    setTimeout(async () => {
      try {
        const session = JSON.parse(await fs.readFile(sessionFile, 'utf8'));
        const statusPath = session.statusPath;
        const status = (state, lastError = null) => fs.writeFile(statusPath, JSON.stringify({
          sessionId: session.sessionId, status: state, corePid: 1234, interfaceName: 'SSTap Next',
          mode: session.mode, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError,
        }));
        await status('running');
        stopWatcher = setInterval(async () => {
          try {
            const stopToken = (await fs.readFile(session.stopPath, 'utf8')).trim();
            if (stopToken === session.sessionId) {
              clearInterval(stopWatcher);
              await status('stopping');
              await new Promise((resolve) => setTimeout(resolve, 10));
              await status('stopped');
            }
          } catch { /* Stop signal has not been written yet. */ }
        }, 10);
      } catch { /* A rejected UAC launch must not fabricate a running Agent. */ }
    }, 5);
    setImmediate(() => child.emit('close', 0));
    return child;
  };
  return { spawnImpl, getSessionDirectory: () => sessionDirectory, clear: () => clearInterval(stopWatcher) };
}

async function makeController() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sstap-tun-controller-'));
  const fake = makeFakePowerShell();
  const controller = new TunController({
    getAgentPath: () => path.join(root, 'SstapNext.Agent.exe'),
    getCorePath: () => path.join(root, 'sing-box.exe'),
    getLauncherPath: () => path.join(root, 'Start-Tun-Agent.ps1'),
    getUserDataPath: () => root,
    spawnImpl: fake.spawnImpl,
    powershellPath: 'powershell.exe',
  });
  await fs.writeFile(path.join(root, 'SstapNext.Agent.exe'), 'test');
  await fs.writeFile(path.join(root, 'sing-box.exe'), 'test');
  await fs.writeFile(path.join(root, 'Start-Tun-Agent.ps1'), 'test');
  return { root, fake, controller };
}

test('starts a TUN Agent session, writes a routed config, and stops cleanly on authenticated stop signal', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const started = await controller.connect(node, { mode: 'bypass-cn' });
  assert.equal(started.connected, true);
  assert.equal(started.status, 'running');
  assert.equal(started.mode, 'bypass-cn');
  const sessionDirectory = fake.getSessionDirectory();
  const files = await fs.readdir(sessionDirectory);
  assert.ok(files.includes('config.json'));
  assert.ok(files.includes('heartbeat.touch'));
  const config = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'config.json'), 'utf8'));
  assert.match(config.experimental.cache_file.path, /sing-box-cache-ipv4\.db$/);
  assert.equal(config.inbounds[0].auto_route, true);
  assert.deepEqual(config.route.rule_set.map((item) => item.tag), ['geosite-cn', 'geoip-cn']);
  const stopped = await controller.disconnect();
  assert.equal(stopped.connected, false);
  assert.equal(stopped.status, 'stopped');
  assert.equal(controller.getStatus().status, 'stopped');
});

test('refuses to start a second TUN session while one is already running', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  await controller.connect(node, { mode: 'global' });
  await assert.rejects(controller.connect({ ...node, id: 'other-node' }, { mode: 'global' }), /请先断开/);
  await controller.disconnect();
});

test('recovers an orphaned prior session before opening a new TUN session', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const staleId = 'a'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({ sessionId: staleId, status: 'running' }));
  const watcher = setInterval(async () => {
    try {
      const token = (await fs.readFile(path.join(staleDirectory, 'stop.signal'), 'utf8')).trim();
      if (token === staleId) {
        clearInterval(watcher);
        await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({ sessionId: staleId, status: 'stopped' }));
      }
    } catch { /* Wait for a recovery stop signal. */ }
  }, 10);
  const started = await controller.connect(node, { mode: 'global' });
  assert.equal(started.status, 'running');
  const staleFiles = await fs.readdir(staleDirectory);
  assert.deepEqual(staleFiles, ['status.json']);
  clearInterval(watcher);
  await controller.disconnect();
});


test('serializes concurrent TUN starts and does not return another node start promise', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const first = controller.connect(node, { mode: 'global' });
  const same = controller.connect(node, { mode: 'global' });
  const other = controller.connect({ ...node, id: 'node-other' }, { mode: 'global' });
  await assert.rejects(other, /另一个系统 TUN 会话正在启动/);
  assert.deepEqual(await same, await first);
  await controller.disconnect();
});

test('quarantines the known 0.3.1 stop-signal cleanup lock without deleting evidence', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const staleId = 'c'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  const oldError = 'TUN 接口 SSTap Next 仍然存在。不要再次启动系统代理；请检查网络适配器。';
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({
    sessionId: staleId, status: 'cleanup_error', corePid: null, interfaceName: 'SSTap Next', lastError: oldError,
  }));
  await fs.writeFile(path.join(staleDirectory, 'sing-box.log'), 'preserve-this-log');

  const started = await controller.connect(node, { mode: 'global' });
  assert.equal(started.status, 'running');
  assert.ok((await fs.readdir(staleDirectory)).includes('.legacy-cleanup-review-0.3.2'));
  assert.equal(await fs.readFile(path.join(staleDirectory, 'sing-box.log'), 'utf8'), 'preserve-this-log');
  assert.equal(JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.json'), 'utf8')).status, 'cleanup_error');
  await controller.disconnect();
});

test('blocks a new TUN start when a prior session is marked cleanup_error', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const staleId = 'b'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({ sessionId: staleId, status: 'cleanup_error', lastError: 'test route residue' }));
  await assert.rejects(controller.connect(node, { mode: 'global' }), /清理异常/);
  assert.equal(controller.getStatus().status, 'cleanup_error');
});


test('uses a fresh IPv4-only DNS cache and preserves the legacy cache file', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const cacheDirectory = path.join(root, 'cache');
  await fs.mkdir(cacheDirectory, { recursive: true });
  const legacyCache = path.join(cacheDirectory, 'sing-box-cache.db');
  await fs.writeFile(legacyCache, 'legacy-cache-must-be-preserved');

  await controller.connect(node, { mode: 'global' });
  const sessionDirectory = fake.getSessionDirectory();
  const config = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'config.json'), 'utf8'));
  const session = JSON.parse(await fs.readFile(path.join(sessionDirectory, 'session.json'), 'utf8'));
  assert.match(config.experimental.cache_file.path, /sing-box-cache-ipv4\.db$/);
  assert.match(session.cachePath, /sing-box-cache-ipv4\.db$/);
  assert.equal(await fs.readFile(legacyCache, 'utf8'), 'legacy-cache-must-be-preserved');
  await controller.disconnect();
});


test('isolates DNS cache databases for IPv4-only, IPv4-first dual-stack and IPv6-first dual-stack', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const cases = [
    [{ mode: 'global', dnsStrategy: 'ipv4_only' }, 'sing-box-cache-ipv4.db', 'ipv4_only'],
    [{ mode: 'global', dnsStrategy: 'prefer_ipv4' }, 'sing-box-cache-dual-ipv4.db', 'prefer_ipv4'],
    [{ mode: 'global', dnsStrategy: 'prefer_ipv6' }, 'sing-box-cache-dual-ipv6.db', 'prefer_ipv6'],
  ];
  for (const [settings, cacheName, strategy] of cases) {
    const started = await controller.connect(node, settings);
    assert.equal(started.connected, true);
    const sessionDir = fake.getSessionDirectory();
    const config = JSON.parse(await fs.readFile(path.join(sessionDir, 'config.json'), 'utf8'));
    const session = JSON.parse(await fs.readFile(path.join(sessionDir, 'session.json'), 'utf8'));
    assert.equal(config.dns.strategy, strategy);
    assert.equal(path.basename(config.experimental.cache_file.path), cacheName);
    assert.equal(path.basename(session.cachePath), cacheName);
    await controller.disconnect();
  }
});
