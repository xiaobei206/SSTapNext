'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TrafficMonitor,
  createClashApiEndpoint,
  toClashApiConfig,
  parseConnectionsSnapshot,
} = require('./singbox-traffic.cjs');

const endpoint = { host: '127.0.0.1', port: 19090, secret: 'a'.repeat(64) };
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('Clash API endpoint binds loopback and creates a random bearer secret', async () => {
  const first = await createClashApiEndpoint();
  const second = await createClashApiEndpoint();
  assert.equal(first.host, '127.0.0.1');
  assert.equal(second.host, '127.0.0.1');
  assert.ok(first.port > 0 && first.port <= 65535);
  assert.match(first.secret, /^[a-f0-9]{64}$/);
  assert.notEqual(first.secret, second.secret);
  assert.deepEqual(toClashApiConfig(endpoint), {
    external_controller: '127.0.0.1:19090',
    secret: endpoint.secret,
  });
});

test('Clash API endpoint rejects non-loopback hosts and invalid credentials', () => {
  assert.throws(() => toClashApiConfig({ ...endpoint, host: '0.0.0.0' }), /只允许绑定 127.0.0.1/);
  assert.throws(() => toClashApiConfig({ ...endpoint, port: 0 }), /端口无效/);
  assert.throws(() => toClashApiConfig({ ...endpoint, secret: 'public' }), /密钥无效/);
});

test('connections snapshot parses upload and download totals independently', () => {
  assert.deepEqual(parseConnectionsSnapshot({ uploadTotal: 1200, downloadTotal: 9800 }), {
    uploadBytes: 1200,
    downloadBytes: 9800,
  });
  assert.equal(parseConnectionsSnapshot({ uploadTotal: -1, downloadTotal: 2 }), null);
  assert.equal(parseConnectionsSnapshot({ uploadTotal: Number.MAX_SAFE_INTEGER + 1, downloadTotal: 2 }), null);
  assert.equal(parseConnectionsSnapshot({ uploadTotal: 'bad', downloadTotal: 2 }), null);
  assert.equal(parseConnectionsSnapshot(null), null);
});

test('monitor establishes a baseline, then accumulates upload/download and smooths rates', async () => {
  let now = 1000;
  const snapshots = [
    { uploadTotal: 100, downloadTotal: 500 },
    { uploadTotal: 300, downloadTotal: 1500 },
    { uploadTotal: 500, downloadTotal: 2500 },
  ];
  const events = [];
  const monitor = new TrafficMonitor({
    endpoint, sessionId: 'session-a', nodeId: 'node-a', nodeName: 'node A',
    mode: 'proxy', now: () => now, intervalMs: 1000,
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://127.0.0.1:19090/connections');
      assert.equal(options.headers.Authorization, 'Bearer ' + endpoint.secret);
      return response(snapshots.shift());
    },
    onSample: (sample) => events.push(sample),
  });

  await monitor.pollNow();
  assert.equal(events[0].uploadBytes, 0);
  assert.equal(events[0].downloadBytes, 0);
  now += 1000;
  await monitor.pollNow();
  assert.equal(events[1].deltaUploadBytes, 200);
  assert.equal(events[1].deltaDownloadBytes, 1000);
  assert.equal(events[1].uploadBytes, 200);
  assert.equal(events[1].downloadBytes, 1000);
  assert.equal(events[1].uploadBps, 200);
  assert.equal(events[1].downloadBps, 1000);
  now += 1000;
  await monitor.pollNow();
  assert.equal(events[2].uploadBytes, 400);
  assert.equal(events[2].downloadBytes, 2000);
  assert.equal(events[2].uploadBps, 200);
  assert.equal(events[2].downloadBps, 1000);
  assert.equal(events[2].nodeId, 'node-a');
  assert.equal(events[2].mode, 'proxy');
  await monitor.stop({ pollFinal: false });
  assert.equal(events.at(-1).final, true);
  assert.equal(events.at(-1).active, false);
});

test('counter rollback creates a new baseline without adding negative traffic', async () => {
  let now = 0;
  const snapshots = [
    { uploadTotal: 500, downloadTotal: 900 },
    { uploadTotal: 100, downloadTotal: 200 },
    { uploadTotal: 150, downloadTotal: 260 },
  ];
  const events = [];
  const monitor = new TrafficMonitor({
    endpoint, now: () => now, fetchImpl: async () => response(snapshots.shift()),
    onSample: (sample) => events.push(sample),
  });
  await monitor.pollNow();
  now += 1000;
  await monitor.pollNow();
  assert.equal(events[1].uploadBytes, 0);
  assert.equal(events[1].downloadBytes, 0);
  now += 1000;
  await monitor.pollNow();
  assert.equal(events[2].uploadBytes, 50);
  assert.equal(events[2].downloadBytes, 60);
  await monitor.stop({ pollFinal: false });
});

test('API failures emit unavailable without losing the last accumulated values', async () => {
  let call = 0;
  const events = [];
  const monitor = new TrafficMonitor({
    endpoint,
    fetchImpl: async () => {
      call += 1;
      if (call === 1) return response({ uploadTotal: 10, downloadTotal: 20 });
      if (call === 2) return response({}, false, 500);
      return response({ uploadTotal: 30, downloadTotal: 70 });
    },
    onSample: (sample) => events.push(sample),
  });
  await monitor.pollNow();
  const failure = await monitor.pollNow();
  assert.equal(failure.status, 'unavailable');
  assert.equal(failure.uploadBytes, 0);
  const resumed = await monitor.pollNow();
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.uploadBytes, 20);
  assert.equal(resumed.downloadBytes, 50);
  await monitor.stop({ pollFinal: false });
});

test('stop emits exactly one final event and disables further polling', async () => {
  let calls = 0;
  const events = [];
  const monitor = new TrafficMonitor({
    endpoint,
    fetchImpl: async () => { calls += 1; return response({ uploadTotal: 3, downloadTotal: 5 }); },
    onSample: (sample) => events.push(sample),
  });
  monitor.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const before = calls;
  await monitor.stop({ pollFinal: false });
  const afterStop = await monitor.pollNow();
  assert.equal(afterStop, null);
  assert.equal(calls, before);
  assert.equal(events.filter((event) => event.final).length, 1);
});
