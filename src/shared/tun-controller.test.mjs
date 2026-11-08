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
        // Mirror the real .NET Agent: write a complete temporary status file,
        // then atomically replace status.json so polling never observes partial JSON.
        const status = async (state, lastError = null) => {
          const tempStatusPath = `${statusPath}.tmp`;
          await fs.writeFile(tempStatusPath, JSON.stringify({
            sessionId: session.sessionId, status: state, corePid: 1234, interfaceName: 'SSTap Next',
            mode: session.mode, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastError,
          }));
          await fs.rename(tempStatusPath, statusPath);
        };
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

async function makeController(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sstap-tun-controller-'));
  const fake = makeFakePowerShell();
  const controller = new TunController({
    getAgentPath: () => path.join(root, 'SstapNext.Agent.exe'),
    getCorePath: () => path.join(root, 'sing-box.exe'),
    getLauncherPath: () => path.join(root, 'Start-Tun-Agent.ps1'),
    getUserDataPath: () => root,
    spawnImpl: fake.spawnImpl,
    powershellPath: 'powershell.exe',
    ...(options.inspectAdapter ? { inspectAdapter: options.inspectAdapter } : {}),
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

test('locks SSTap rule-library mutation during TUN startup and while a session is active', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  assert.equal(controller.isRuleLibraryMutationLocked(), false);

  const starting = controller.connect(node, { mode: 'global' });
  assert.equal(controller.isRuleLibraryMutationLocked(), true, 'the in-flight start promise must lock rule file rotation immediately');
  await starting;
  assert.equal(controller.isRuleLibraryMutationLocked(), true, 'an active TUN session must keep rule mutation locked');

  await controller.disconnect();
  assert.equal(controller.isRuleLibraryMutationLocked(), false, 'a confirmed clean stop releases the lock');
});

test('keeps SSTap rule-library mutation locked when TUN cleanup is unresolved', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  controller._publish({ status: 'cleanup_error', connected: false, lastError: 'unresolved adapter ownership' });
  assert.equal(controller.isRuleLibraryMutationLocked(), true, 'cleanup_error is a fail-closed lock even without a current session object');
});

test('refuses to start a second TUN session while one is already running', async (t) => {
  const { root, fake, controller } = await makeController();
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  await controller.connect(node, { mode: 'global' });
  await assert.rejects(controller.connect({ ...node, id: 'other-node' }, { mode: 'global' }), /请先断开/);
  await controller.disconnect();
});

test('recovers a dead-core running orphan only after dual-source proof all SSTap Next TUN adapters are inactive', async (t) => {
  const adapter = (name, description, id) => ({
    name, description, id, status: 'NotPresent', addresses: [],
    operationallyActive: false, inspectionError: null,
  });
  const { root, fake, controller } = await makeController({
    inspectAdapter: async (id, pid) => {
      assert.equal(id, '{00000000-0000-0000-0000-000000000000}');
      assert.equal(pid, 4968);
      return {
        found: false, absent: true, inspectionComplete: true, matchCount: 0,
        relatedAdapters: [
          adapter('singbox_tun', 'sing-tun Tunnel', '{B738A021-9842-444C-10B0-A4E3F65AB5B6}'),
          adapter('SSTap Next Test', 'sing-tun Tunnel #2', '{A5BF671B-9F50-B1F2-2EB1-6A40815D5AC5}'),
          adapter('SSTap Next', 'sing-tun Tunnel #3', '{8AC250D2-5056-026B-1DA1-96E3759C87AB}'),
          adapter('SSTap FullDiag', 'sing-tun Tunnel #4', '{A966B662-F331-7ACE-2FC4-597F37BF13CD}'),
        ],
        processCheckComplete: true, singBoxProcessRunning: false,
        expectedTunAddress: '172.19.0.1', operationallyActive: false,
        agentProcessCheckComplete: true, activeAgentProcessCount: 0,
        otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0,
        verificationSources: [
          'PowerShell Get-NetAdapter -IncludeHidden',
          '.NET NetworkInterface.GetAllNetworkInterfaces',
        ],
      };
    },
  });
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });

  const staleId = 'e'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({
    sessionId: staleId, interfaceName: 'SSTap Next', mode: 'global',
  }));
  const originalStatus = {
    sessionId: staleId, status: 'running', corePid: 4968,
    interfaceName: 'SSTap Next', mode: 'global', lastError: null,
  };
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify(originalStatus));
  await fs.writeFile(path.join(staleDirectory, 'sing-box.log'), 'preserve-orphan-log');

  const started = await controller.connect(node, { mode: 'global' });
  assert.equal(started.status, 'running');
  const archived = JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.orphaned-running-legacy.json'), 'utf8'));
  assert.equal(archived.status, 'running');
  assert.equal(archived.corePid, 4968);
  const recovered = JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.json'), 'utf8'));
  assert.equal(recovered.status, 'stopped_with_warning');
  assert.equal(recovered.corePid, null);
  assert.match(recovered.lastError, /双重只读核验确认旧 sing-box PID 4968 已退出/);
  assert.ok((await fs.readdir(staleDirectory)).includes('.verified-orphaned-running-recovered-0.3.18'));
  assert.equal(await fs.readFile(path.join(staleDirectory, 'sing-box.log'), 'utf8'), 'preserve-orphan-log');
  await controller.disconnect();
});

test('does not recover a running orphan when any SSTap Next adapter is active', async (t) => {
  const { root, fake, controller } = await makeController({
    inspectAdapter: async () => ({
      found: false, absent: true, inspectionComplete: true, matchCount: 0,
      relatedAdapters: [{
        name: 'SSTap Next', description: 'sing-tun Tunnel #3',
        id: '{8AC250D2-5056-026B-1DA1-96E3759C87AB}',
        status: 'Up', addresses: ['172.19.0.1'], operationallyActive: true, inspectionError: null,
      }],
      processCheckComplete: true, singBoxProcessRunning: false,
      expectedTunAddress: '172.19.0.1', operationallyActive: true,
      agentProcessCheckComplete: true, activeAgentProcessCount: 0,
        otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0,
        verificationSources: [
        'PowerShell Get-NetAdapter -IncludeHidden',
        '.NET NetworkInterface.GetAllNetworkInterfaces',
      ],
    }),
  });
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
  const status = {
    sessionId: 'f'.repeat(32), status: 'running', corePid: 4968,
    interfaceName: 'SSTap Next', mode: 'global',
  };
  assert.equal(await controller._verifyOrphanedRunningSession(status), null);
});

test('keeps the orphan lock when another Agent exists or Agent liveness cannot be verified', async (t) => {
  const inactiveAdapter = {
    name: 'SSTap Next', description: 'sing-tun Tunnel #3',
    id: '{8AC250D2-5056-026B-1DA1-96E3759C87AB}',
    status: 'NotPresent', addresses: [], operationallyActive: false, inspectionError: null,
  };
  const base = {
    found: false, absent: true, inspectionComplete: true, matchCount: 0,
    relatedAdapters: [inactiveAdapter],
    processCheckComplete: true, singBoxProcessRunning: false,
    expectedTunAddress: '172.19.0.1', operationallyActive: false,
    agentProcessCheckComplete: true, activeAgentProcessCount: 0,
    otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0,
    verificationSources: [
      'PowerShell Get-NetAdapter -IncludeHidden',
      '.NET NetworkInterface.GetAllNetworkInterfaces',
    ],
  };
  for (const inspection of [
    { ...base, activeAgentProcessCount: 1, otherAgentProcessCount: 1 },
    { ...base, otherAgentProcessCheckComplete: false, otherAgentProcessCount: -1 },
  ]) {
    const { root, fake, controller } = await makeController({ inspectAdapter: async () => inspection });
    t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });
    assert.equal(await controller._verifyOrphanedRunningSession({
      status: 'running', interfaceName: 'SSTap Next', corePid: 4968,
    }), null);
  }
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

test('recovers an inactive Wintun object using exact-GUID live inspection', async (t) => {
  const adapterId = '{8AC250D2-5056-026B-1DA1-96E3759C87AB}';
  let inspectedId = null;
  const { root, fake, controller } = await makeController({
    inspectAdapter: async (id) => {
      inspectedId = id;
      return {
        found: true, name: 'SSTap Next', description: 'sing-tun Tunnel #3', id: adapterId,
        status: 'Down', type: 53, addresses: [], expectedTunAddress: '172.19.0.1', operationallyActive: false,
        processCheckComplete: true, singBoxProcessRunning: false,
      };
    },
  });
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });

  const staleId = 'd'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  const oldError = [
    'sing-box PID 24372 已退出，但 TUN 接口 SSTap Next 在 18 秒后仍被检测为本次会话残留。',
    `适配器详情：Name=SSTap Next; Description=sing-tun Tunnel #3; Id=${adapterId}; Status=Down; Type=53; Addresses=[]`,
  ].join('\n');
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId, interfaceName: 'SSTap Next' }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({
    sessionId: staleId, status: 'cleanup_error', corePid: null, interfaceName: 'SSTap Next', lastError: oldError,
  }));
  await fs.writeFile(path.join(staleDirectory, 'sing-box.log'), 'preserve-original-agent-evidence');

  const started = await controller.connect(node, { mode: 'global' });
  assert.equal(started.status, 'running');
  assert.equal(inspectedId, adapterId);
  const existingFiles = await fs.readdir(staleDirectory);
  assert.ok(existingFiles.includes('.verified-inactive-adapter-recovered-0.3.11'));
  assert.ok(existingFiles.includes('status.cleanup_error-legacy.json'));
  assert.ok(existingFiles.includes('status.json'));
  assert.equal(existingFiles.includes('session.json'), false, 'the stale session lock metadata must be retired');
  assert.equal(await fs.readFile(path.join(staleDirectory, 'sing-box.log'), 'utf8'), 'preserve-original-agent-evidence');
  assert.equal(JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.json'), 'utf8')).status, 'stopped_with_warning');
  assert.equal(JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.cleanup_error-legacy.json'), 'utf8')).status, 'cleanup_error');
  await controller.disconnect();
});

test('recovers a missing historical GUID when related SSTap/sing-tun objects are all NotPresent and unaddressed', async (t) => {
  const adapterId = '{8AC250D2-5056-026B-1DA1-96E3759C87AB}';
  let inspected = null;
  const { root, fake, controller } = await makeController({
    inspectAdapter: async (id, pid) => {
      inspected = { id, pid };
      return {
        found: false, absent: true, inspectionComplete: true, matchCount: 0,
        relatedAdapters: [
          { name: 'singbox_tun', description: 'sing-tun Tunnel', id: '{B738A021-9842-444C-10B0-A4E3F65AB5B6}', status: 'NotPresent', addresses: [], operationallyActive: false, inspectionError: null },
          { name: 'SSTap Next Test', description: 'sing-tun Tunnel #2', id: '{A5BF671B-9F50-B1F2-2EB1-6A40815D5AC5}', status: 'NotPresent', addresses: [], operationallyActive: false, inspectionError: null },
          { name: 'SSTap FullDiag', description: 'sing-tun Tunnel #4', id: '{A966B662-F331-7ACE-2FC4-597F37BF13CD}', status: 'NotPresent', addresses: [], operationallyActive: false, inspectionError: null },
        ],
        processId: 24372, processCheckComplete: true, singBoxProcessRunning: false, processName: null,
        id: adapterId, expectedTunAddress: '172.19.0.1', operationallyActive: false,
        agentProcessCheckComplete: true, activeAgentProcessCount: 0, otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0, verificationSources: ['PowerShell Get-NetAdapter -IncludeHidden', '.NET NetworkInterface.GetAllNetworkInterfaces'],
      };
    },
  });
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });

  const staleId = 'f'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  const oldError = [
    'sing-box PID 24372 已退出，但 TUN 接口 SSTap Next 在 18 秒后仍被检测为本次会话残留。',
    `适配器详情：Name=SSTap Next; Description=sing-tun Tunnel #3; Id=${adapterId}; Status=Down; Type=53; Addresses=[]`,
  ].join('\n');
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId, interfaceName: 'SSTap Next' }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({
    sessionId: staleId, status: 'cleanup_error', corePid: null, interfaceName: 'SSTap Next', lastError: oldError,
  }));
  await fs.writeFile(path.join(staleDirectory, 'sing-box.log'), 'preserve-logs');

  const started = await controller.connect(node, { mode: 'global' });
  assert.equal(started.status, 'running');
  assert.deepEqual(inspected, { id: adapterId, pid: 24372 });
  const files = await fs.readdir(staleDirectory);
  assert.ok(files.includes('.verified-absent-adapter-recovered-0.3.11'));
  assert.ok(files.includes('status.cleanup_error-legacy.json'));
  assert.equal(files.includes('session.json'), false);
  assert.equal(await fs.readFile(path.join(staleDirectory, 'sing-box.log'), 'utf8'), 'preserve-logs');
  const recovered = JSON.parse(await fs.readFile(path.join(staleDirectory, 'status.json'), 'utf8'));
  assert.equal(recovered.status, 'stopped_with_warning');
  assert.match(recovered.lastError, /已不存在/);
  await controller.disconnect();
});

test('does not accept adapter absence when the historical PID is still sing-box or related adapters remain', async (t) => {
  const adapterId = '{8AC250D2-5056-026B-1DA1-96E3759C87AB}';
  for (const inspection of [
    { found: false, absent: true, inspectionComplete: true, matchCount: 0, relatedAdapters: [], processCheckComplete: true, singBoxProcessRunning: true, expectedTunAddress: '172.19.0.1', operationallyActive: false, agentProcessCheckComplete: true, activeAgentProcessCount: 0, otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0, verificationSources: ['PowerShell Get-NetAdapter -IncludeHidden', '.NET NetworkInterface.GetAllNetworkInterfaces'] },
    { found: false, absent: true, inspectionComplete: true, matchCount: 0, relatedAdapters: [{ name: 'SSTap Next', description: 'sing-tun Tunnel #3' }], processCheckComplete: true, singBoxProcessRunning: false, expectedTunAddress: '172.19.0.1', operationallyActive: false, agentProcessCheckComplete: true, activeAgentProcessCount: 0, otherAgentProcessCheckComplete: true, otherAgentProcessCount: 0, verificationSources: ['PowerShell Get-NetAdapter -IncludeHidden', '.NET NetworkInterface.GetAllNetworkInterfaces'] },
  ]) {
    const { root, fake, controller } = await makeController({ inspectAdapter: async () => inspection });
    const staleId = '9'.repeat(32);
    const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
    await fs.mkdir(staleDirectory, { recursive: true });
    const oldError = [
      'sing-box PID 24372 已退出，但 TUN 接口 SSTap Next 在 18 秒后仍被检测为本次会话残留。',
      `适配器详情：Name=SSTap Next; Description=sing-tun Tunnel #3; Id=${adapterId}; Status=Down; Type=53; Addresses=[]`,
    ].join('\n');
    await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId, interfaceName: 'SSTap Next' }));
    await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({
      sessionId: staleId, status: 'cleanup_error', corePid: null, interfaceName: 'SSTap Next', lastError: oldError,
    }));
    await assert.rejects(controller.connect(node, { mode: 'global' }), /清理异常/);
    assert.equal(fake.getSessionDirectory(), undefined);
    fake.clear();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('does not recover an old cleanup_error when the same adapter is currently Up or addressed', async (t) => {
  const adapterId = '{8AC250D2-5056-026B-1DA1-96E3759C87AB}';
  const { root, fake, controller } = await makeController({
    inspectAdapter: async () => ({
      found: true, name: 'SSTap Next', description: 'sing-tun Tunnel #3', id: adapterId,
      status: 'Up', addresses: ['172.19.0.1'], expectedTunAddress: '172.19.0.1', operationallyActive: true,
      processCheckComplete: true, singBoxProcessRunning: false,
    }),
  });
  t.after(async () => { fake.clear(); await fs.rm(root, { recursive: true, force: true }); });

  const staleId = 'e'.repeat(32);
  const staleDirectory = path.join(root, 'runtime', `tun-${staleId}`);
  await fs.mkdir(staleDirectory, { recursive: true });
  const oldError = [
    'sing-box PID 24372 已退出，但 TUN 接口 SSTap Next 在 18 秒后仍被检测为本次会话残留。',
    `适配器详情：Name=SSTap Next; Description=sing-tun Tunnel #3; Id=${adapterId}; Status=Down; Type=53; Addresses=[]`,
  ].join('\n');
  await fs.writeFile(path.join(staleDirectory, 'session.json'), JSON.stringify({ sessionId: staleId, interfaceName: 'SSTap Next' }));
  await fs.writeFile(path.join(staleDirectory, 'status.json'), JSON.stringify({
    sessionId: staleId, status: 'cleanup_error', corePid: null, interfaceName: 'SSTap Next', lastError: oldError,
  }));
  await assert.rejects(controller.connect(node, { mode: 'global' }), /清理异常/);
  assert.equal(fake.getSessionDirectory(), undefined);
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
