import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

const require = createRequire(import.meta.url);
const {
  BatchNodeTester,
  parseIcmpOutput,
  runIcmpPing,
  tcpPing,
  effectiveDownloadThreads,
  runWithConcurrency,
} = require('./batch-node-test.cjs');
const { parseShareText } = require('./node-parser.cjs');
const { buildBatchProxyConfig } = require('./singbox-config.cjs');

const sampleNodes = () => parseShareText([
  'vless://00000000-0000-4000-8000-000000000001@one.example.com:443?security=tls&sni=one.example.com#One',
  'hy2://password@two.example.com:443?sni=two.example.com#Two',
].join('\n')).nodes;

test('parses Windows ping latency and packet loss, including fully blocked ICMP', () => {
  const output = [
    'Pinging 1.1.1.1 with 32 bytes of data:',
    'Reply from 1.1.1.1: bytes=32 time=12ms TTL=58',
    'Reply from 1.1.1.1: bytes=32 time<1ms TTL=58',
    'Reply from 1.1.1.1: bytes=32 time=14ms TTL=58',
    'Packets: Sent = 3, Received = 3, Lost = 0 (0% loss)',
  ].join('\n');
  const parsed = parseIcmpOutput(output, '', 3);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.received, 3);
  assert.equal(parsed.lossPercent, 0);
  assert.ok(parsed.averageMs > 0);

  const blocked = parseIcmpOutput('Packets: Sent = 3, Received = 0, Lost = 3 (100% loss)', '', 3);
  assert.equal(blocked.status, 'timeout');
  assert.equal(blocked.averageMs, null);
  assert.equal(blocked.lossPercent, 100);
});

test('parses localized Chinese Windows ping output', () => {
  const output = [
    '正在 Ping 1.1.1.1 具有 32 字节的数据:',
    '来自 1.1.1.1 的回复: 字节=32 时间=11ms TTL=57',
    '来自 1.1.1.1 的回复: 字节=32 时间<1ms TTL=57',
    '来自 1.1.1.1 的回复: 字节=32 时间=13ms TTL=57',
    '数据包: 已发送 = 3，已接收 = 3，丢失 = 0 (0% 丢失)',
  ].join('\n');
  const parsed = parseIcmpOutput(output, '', 3);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.received, 3);
  assert.equal(parsed.lossPercent, 0);
  assert.ok(parsed.averageMs > 0);
});

test('parses RTT values when a Windows OEM-codepage prefix is garbled', () => {
  const output = [
    '��=45ms TTL=49',
    '��=43ms TTL=49',
    '\\uFFFD\\uFFFD=43ms TTL=49',
  ].join('\n');
  const parsed = parseIcmpOutput(output, '', 3);
  assert.equal(parsed.status, 'ok');
  assert.equal(parsed.received, 3);
  assert.equal(parsed.lossPercent, 0);
  assert.equal(parsed.averageMs, 43.67);

  const subMillisecond = parseIcmpOutput('�<1ms TTL=49', '', 1);
  assert.equal(subMillisecond.status, 'ok');
  assert.equal(subMillisecond.averageMs, 1);
});

test('runs ICMP ping with an argument array and parses the process output', async () => {
  const spawnCalls = [];
  const spawnImpl = (executable, args) => {
    spawnCalls.push({ executable, args });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    setImmediate(() => {
      child.stdout.write('Reply from 127.0.0.1: bytes=32 time=2ms TTL=128\nPackets: Sent = 3, Received = 1, Lost = 2 (66% loss)');
      child.emit('close', 0);
    });
    return child;
  };
  const result = await runIcmpPing('127.0.0.1', { spawnImpl, platform: 'win32', count: 3 });
  assert.equal(spawnCalls[0].executable, 'ping.exe');
  assert.deepEqual(spawnCalls[0].args.slice(0, 4), ['-n', '3', '-w', '1200']);
  assert.equal(result.status, 'ok');
  assert.equal(result.lossPercent, 66);
});

test('waits for the Windows ping child to close before completing cancellation', async () => {
  const abort = new AbortController();
  let closed = false;
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      setTimeout(() => {
        closed = true;
        child.emit('close', null, 'SIGTERM');
      }, 25);
      return true;
    };
    return child;
  };
  const pending = runIcmpPing('127.0.0.1', { spawnImpl, platform: 'win32', signal: abort.signal });
  setImmediate(() => abort.abort());
  await assert.rejects(pending, /测速已取消/);
  assert.equal(closed, true);
});

test('TCPING measures TCP connect only and returns refusal distinctly', async (t) => {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const success = await tcpPing('127.0.0.1', server.address().port, { count: 2, timeoutMs: 500 });
  assert.equal(success.status, 'ok');
  assert.equal(success.received, 2);
  assert.ok(success.averageMs >= 0);

  const closed = await tcpPing('127.0.0.1', 1, { count: 1, timeoutMs: 500 });
  assert.equal(closed.status, 'error');
  assert.equal(closed.averageMs, null);
});

test('separates concurrent node workers from per-node Range threads and caps total workers', () => {
  assert.equal(effectiveDownloadThreads(32, 1), 32);
  assert.equal(effectiveDownloadThreads(32, 4), 16);
  assert.equal(effectiveDownloadThreads(32, 16), 4);
  assert.equal(effectiveDownloadThreads(32, 32), 2);
  assert.equal(effectiveDownloadThreads(32, 3), 16, 'non-power-of-two effective concurrency rounds down to a supported Range tier');
  assert.equal(effectiveDownloadThreads(32, 5), 8);
  assert.equal(effectiveDownloadThreads(8, 32) * 32, 64);
  assert.throws(() => effectiveDownloadThreads(3, 4), /只允许/);
  assert.throws(() => effectiveDownloadThreads(8, 0), /1 至 32/);
});

test('builds one isolated loopback inbound and outbound per node, with an explicit route per inbound', () => {
  const nodes = sampleNodes();
  const config = buildBatchProxyConfig(nodes.map((node, index) => ({ node, listenPort: 23000 + index })));
  assert.equal(config.inbounds.length, 2);
  assert.equal(config.outbounds.length, 3);
  assert.ok(config.inbounds.every((inbound) => inbound.type === 'mixed' && inbound.listen === '127.0.0.1' && inbound.set_system_proxy === false));
  assert.ok(config.route.rules.every((rule) => rule.action === 'route' && rule.inbound.length === 1));
  assert.equal(config.route.rules[0].outbound, config.outbounds[0].tag);
  assert.equal(config.route.rules[1].outbound, config.outbounds[1].tag);
  assert.equal(config.route.final, 'block');
  assert.throws(() => buildBatchProxyConfig([{ node: nodes[0], listenPort: 23000 }, { node: nodes[0], listenPort: 23001 }]), /重复节点/);
  assert.throws(() => buildBatchProxyConfig([{ node: nodes[0], listenPort: 23000 }, { node: nodes[1], listenPort: 23000 }]), /不能重复/);
});

test('bounded worker pool never exceeds configured concurrency and isolates item failures', async () => {
  let active = 0;
  let maximum = 0;
  const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 8));
    active--;
    if (item === 3) throw new Error('one node failed');
    return item * 2;
  });
  assert.equal(maximum, 2);
  assert.deepEqual(results.slice(0, 2), [2, 4]);
  assert.match(results[2].error, /one node failed/);
  assert.deepEqual(results.slice(3), [8, 10]);
});

test('bounded worker pool stops scheduling new nodes after cancellation', async () => {
  const abort = new AbortController();
  const visited = [];
  const work = runWithConcurrency([1, 2, 3, 4, 5], 2, async (item) => {
    visited.push(item);
    await new Promise((resolve) => setTimeout(resolve, 60));
    return item;
  }, abort.signal);
  setTimeout(() => abort.abort(), 10);
  await assert.rejects(work, /测速已取消/);
  assert.ok(visited.length <= 2);
});

function fakeBatchSpawn(configurations) {
  return (_executable, args) => {
    const child = new EventEmitter();
    child.pid = 54321;
    const servers = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      child.emit('exit', 0, 'SIGTERM');
      child.emit('close', 0, 'SIGTERM');
    };
    child.kill = () => {
      const listening = servers.filter((server) => server.listening);
      if (listening.length === 0) setImmediate(finish);
      else Promise.all(listening.map((server) => new Promise((resolve) => server.close(resolve)))).then(finish);
      return true;
    };
    setImmediate(async () => {
      const configPath = args[args.indexOf('-c') + 1];
      const config = JSON.parse(await readFile(configPath, 'utf8'));
      configurations.push(config);
      for (const inbound of config.inbounds) {
        const server = net.createServer((socket) => {
          socket.once('data', () => socket.end(Buffer.from([5, 0])));
        });
        servers.push(server);
        await new Promise((resolve) => server.listen(inbound.listen_port, inbound.listen, resolve));
      }
    });
    return child;
  };
}

test('runs multiple nodes through one temporary sing-box batch session and persists per-node results', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sstap-batch-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const nodes = sampleNodes();
  const configurations = [];
  const saved = [];
  const events = [];
  let maximum = 0;
  let active = 0;
  const tester = new BatchNodeTester({
    getCorePath: () => 'fake-sing-box.exe',
    getUserDataPath: () => root,
    runCaptureImpl: async (_exe, args) => {
      if (args[0] === 'version') return { exitCode: 0, stdout: 'sing-box version 1.14.4' };
      const config = JSON.parse(await readFile(args[args.indexOf('-c') + 1], 'utf8'));
      assert.equal(config.inbounds.length, 2);
      assert.ok(config.inbounds.every((inbound) => inbound.listen === '127.0.0.1' && inbound.set_system_proxy === false));
      return { exitCode: 0, stdout: 'Configuration is valid' };
    },
    spawnImpl: fakeBatchSpawn(configurations),
    probeSocksImpl: async () => true,
    pingImpl: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 8));
      active--;
      return { status: 'ok', averageMs: 10, lossPercent: 0, sent: 3, received: 3 };
    },
    tcpPingImpl: async () => ({ status: 'ok', averageMs: 12, lossPercent: 0, sent: 3, received: 3 }),
    requestLatencyImpl: async () => ({ latencyMs: 28, statusCode: 206 }),
    downloadSpeedTestImpl: async (options) => ({
      averageMbps: 320,
      peakMbps: 400,
      bytes: options.totalBytes,
      elapsedMs: 250,
      threads: options.threads,
      statusCode: 206,
      url: options.url,
    }),
    onProgress: (event) => events.push(event),
    onNodeResult: async (item) => saved.push(item),
  });
  const result = await tester.run(nodes, {
    concurrency: 32,
    downloadThreads: 32,
    url: 'https://speed.example.test/10mb.bin',
    totalBytes: 10_000_000,
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.completed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.effectiveDownloadThreads, 32, 'two actual workers may each use 32 Range connections within the 64-worker budget');
  assert.equal(configurations.length, 1);
  assert.equal(configurations[0].inbounds.length, 2);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((item) => item.result.download.averageMbps === 320 && item.result.download.threads === 32));
  assert.ok(events.some((event) => event.metric === 'node-complete'));
  assert.equal(tester.isRunning, false);
  assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
  assert.equal(maximum, 2);
});

test('cancels batch tests, stops the owned sing-box process and removes its temporary config', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sstap-batch-cancel-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configurations = [];
  const tester = new BatchNodeTester({
    getCorePath: () => 'fake-sing-box.exe',
    getUserDataPath: () => root,
    runCaptureImpl: async (_exe, args) => args[0] === 'version'
      ? { exitCode: 0, stdout: 'sing-box version 1.14.4' }
      : { exitCode: 0, stdout: 'Configuration is valid' },
    spawnImpl: fakeBatchSpawn(configurations),
    probeSocksImpl: async () => true,
    pingImpl: (_host, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('测速已取消')), { once: true })),
    tcpPingImpl: (_host, _port, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('测速已取消')), { once: true })),
    onNodeResult: async () => {},
  });
  const pending = tester.run(sampleNodes(), {
    concurrency: 2,
    downloadThreads: 1,
    url: 'https://speed.example.test/10mb.bin',
    totalBytes: 10_000_000,
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await tester.cancel();
  const result = await pending;
  assert.equal(result.status, 'cancelled');
  assert.equal(tester.isRunning, false);
  assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
});
