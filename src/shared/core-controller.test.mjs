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
const { CoreController } = require('./core-controller.cjs');
const { parseShareText } = require('./node-parser.cjs');

function fakeSingBoxSpawn(_executable, args) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 43210;
  let server = null;
  let closed = false;
  const command = args[0];

  const finish = (code = 0, signal = null) => {
    if (closed) return;
    closed = true;
    child.stdout.end();
    child.stderr.end();
    child.emit('exit', code, signal);
    child.emit('close', code, signal);
  };

  child.kill = (signal = 'SIGTERM') => {
    if (server?.listening) {
      server.close(() => finish(signal === 'SIGKILL' ? 1 : 0, signal));
    } else {
      setImmediate(() => finish(signal === 'SIGKILL' ? 1 : 0, signal));
    }
    return true;
  };

  setImmediate(async () => {
    try {
      if (command === 'version') {
        child.stdout.write('sing-box version 1.14.4\n');
        finish(0);
        return;
      }
      if (command === 'check') {
        const configIndex = args.indexOf('-c');
        assert.ok(configIndex >= 0, 'check command should receive -c');
        const config = JSON.parse(await readFile(args[configIndex + 1], 'utf8'));
        assert.equal(config.inbounds[0].listen, '127.0.0.1');
        child.stdout.write('Configuration is valid\n');
        finish(0);
        return;
      }
      if (command === 'run') {
        const configIndex = args.indexOf('-c');
        const config = JSON.parse(await readFile(args[configIndex + 1], 'utf8'));
        const inbound = config.inbounds[0];
        server = net.createServer((socket) => {
          socket.once('data', (data) => {
            if (data.length >= 3 && data[0] === 5) socket.write(Buffer.from([5, 0]));
            else socket.destroy();
          });
        });
        server.listen(inbound.listen_port, inbound.listen, () => child.stdout.write('fake sing-box ready\n'));
        return;
      }
      child.stderr.write(`unknown command: ${command}\n`);
      finish(2);
    } catch (error) {
      child.stderr.write(`${error.stack || error}\n`);
      finish(1);
    }
  });
  return child;
}

const sampleNode = () => parseShareText('vless://00000000-0000-4000-8000-000000000001@edge.example.com:443?security=tls&sni=edge.example.com#Test').nodes[0];

test('starts a checked loopback proxy, prevents parallel node replacement, and cleans up on disconnect', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sstap-core-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const events = [];
  const controller = new CoreController({
    getCorePath: () => 'fake-sing-box.exe',
    getUserDataPath: () => root,
    spawnImpl: fakeSingBoxSpawn,
    onEvent: (event) => events.push(event.status),
  });

  const core = await controller.checkCore();
  assert.equal(core.installed, true);
  assert.match(core.version, /1\.14\.4/);

  const node = sampleNode();
  const connected = await controller.connect(node);
  assert.equal(connected.status, 'connected');
  assert.equal(connected.proxyHost, '127.0.0.1');
  assert.ok(connected.proxyPort > 0);
  assert.match(connected.socks5Url, /^socks5h:\/\/127\.0\.0\.1:/);
  assert.deepEqual(await readdir(path.join(root, 'runtime')).then((names) => names.length), 1);
  assert.equal((await controller.connect(node)).status, 'connected');
  await assert.rejects(() => controller.connect({ ...node, id: 'another-node' }), /请先断开/);

  const stopped = await controller.disconnect();
  assert.equal(stopped.status, 'disconnected');
  assert.equal(stopped.connected, false);
  assert.equal(await readdir(path.join(root, 'runtime')).then((names) => names.length), 0);
  assert.ok(events.includes('starting'));
  assert.ok(events.includes('connected'));
  assert.ok(events.includes('stopping'));
  assert.ok(events.includes('disconnected'));
});

test('reports missing sing-box without creating a session', async () => {
  const controller = new CoreController({ getCorePath: () => null, getUserDataPath: () => tmpdir() });
  const result = await controller.checkCore();
  assert.equal(result.installed, false);
  assert.match(result.error, /Fetch-SingBox/);
  await assert.rejects(() => controller.connect(sampleNode()), /未找到 sing-box/);
  assert.equal(controller.getStatus().status, 'error');
});

test('a disconnect during the preflight/startup window waits for startup then stops the child', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'sstap-core-start-stop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const controller = new CoreController({
    getCorePath: () => 'fake-sing-box.exe',
    getUserDataPath: () => root,
    spawnImpl: fakeSingBoxSpawn,
  });

  const node = sampleNode();
  const starting = controller.connect(node);
  assert.equal(controller.getStatus().status, 'starting');
  await assert.rejects(() => controller.connect({ ...node, id: 'another-node' }), /另一个节点正在启动/);
  const stopping = controller.disconnect();
  const [, stopped] = await Promise.all([starting, stopping]);
  assert.equal(stopped.status, 'disconnected');
  assert.equal(controller.getStatus().status, 'disconnected');
  assert.equal(await readdir(path.join(root, 'runtime')).then((names) => names.length), 0);
});
