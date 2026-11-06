import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { downloadSpeedTest, requestLatency } = require('./socks-speed-test.cjs');

function readAddress(buffer) {
  const type = buffer[3];
  if (type === 1) return { hostLength: 4, headerLength: 4 };
  if (type === 4) return { hostLength: 16, headerLength: 4 };
  if (type === 3) return { hostLength: buffer[4], headerLength: 5 };
  throw new Error('bad address type');
}

async function createRelaySocksServer() {
  const server = net.createServer((client) => {
    let buffer = Buffer.alloc(0);
    let stage = 0;
    let target = null;
    client.on('data', (chunk) => {
      if (stage >= 2 && target) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (stage === 0 && buffer.length >= 3) {
        buffer = buffer.subarray(3);
        client.write(Buffer.from([5, 0]));
        stage = 1;
      }
      if (stage === 1 && buffer.length >= 5) {
        const info = readAddress(buffer);
        const requestLength = info.headerLength + info.hostLength + 2;
        if (buffer.length < requestLength) return;
        const type = buffer[3];
        let host;
        if (type === 1) host = [...buffer.subarray(4, 8)].join('.');
        else if (type === 3) host = buffer.subarray(5, 5 + info.hostLength).toString('utf8');
        else throw new Error('IPv6 not needed in test');
        const portOffset = info.headerLength + info.hostLength;
        const port = buffer.readUInt16BE(portOffset);
        buffer = buffer.subarray(requestLength);
        target = net.createConnection({ host, port }, () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          stage = 2;
          client.pipe(target);
          target.pipe(client);
          if (buffer.length) target.write(buffer);
          buffer = Buffer.alloc(0);
        });
        target.on('error', () => client.destroy());
      }
    });
    client.on('error', () => target?.destroy());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, port: server.address().port };
}


async function startNoRangeHttpSource() {
  const body = Buffer.alloc(2 * 1024 * 1024, 0x62);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}/no-range.bin` };
}

async function startHttpSource() {
  const body = Buffer.alloc(2 * 1024 * 1024, 0x61);
  const server = http.createServer((request, response) => {
    if (request.url === '/blocked.bin') {
      response.writeHead(403, { 'Content-Type': 'text/plain' });
      response.end('forbidden');
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: '/test.bin' });
      response.end();
      return;
    }
    if (request.method === 'HEAD') {
      response.writeHead(200, { 'Content-Length': body.length });
      response.end();
      return;
    }
    const range = request.headers.range;
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d+)/);
      const start = Number(match[1]);
      const end = Math.min(Number(match[2]), body.length - 1);
      response.writeHead(206, {
        'Content-Length': end - start + 1,
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
      });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'Content-Length': body.length });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}/test.bin`,
    redirectUrl: `http://127.0.0.1:${server.address().port}/redirect`,
    blockedUrl: `http://127.0.0.1:${server.address().port}/blocked.bin`,
  };
}

test('measures HTTP latency and downloads the configured byte count through a SOCKS5 proxy', async (t) => {
  const socks = await createRelaySocksServer();
  const source = await startHttpSource();
  t.after(() => socks.server.close());
  t.after(() => source.server.close());

  const latency = await requestLatency(source.url, '127.0.0.1', socks.port, { timeoutMs: 5000 });
  assert.ok(latency.latencyMs >= 0);
  assert.equal(latency.statusCode, 206);

  const progress = [];
  const result = await downloadSpeedTest({
    url: source.url,
    totalBytes: 1_000_000,
    threads: 2,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
    onProgress: (event) => progress.push(event),
  });
  assert.equal(result.bytes, 1_000_000);
  assert.equal(result.threads, 2);
  assert.ok(result.averageMbps > 0);
  assert.ok(result.elapsedMs > 0);
  assert.ok(progress.length > 0);
  assert.equal(progress.at(-1).ratio, 1);
});


test('follows HTTP redirects for both latency and the actual proxied download', async (t) => {
  const socks = await createRelaySocksServer();
  const source = await startHttpSource();
  t.after(() => socks.server.close());
  t.after(() => source.server.close());

  const result = await downloadSpeedTest({
    url: source.redirectUrl,
    totalBytes: 1_000_000,
    threads: 2,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
  });
  assert.equal(result.bytes, 1_000_000);
  assert.equal(result.statusCode, 206);
});

test('automatically switches to a fallback speed source when the primary returns HTTP 403', async (t) => {
  const socks = await createRelaySocksServer();
  const source = await startHttpSource();
  t.after(() => socks.server.close());
  t.after(() => source.server.close());
  const progress = [];

  const result = await downloadSpeedTest({
    url: source.blockedUrl,
    fallbackUrls: [source.url],
    totalBytes: 1_000_000,
    threads: 1,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
    onProgress: (event) => progress.push(event),
  });

  assert.equal(result.bytes, 1_000_000);
  assert.equal(result.url, source.url);
  assert.ok(progress.some((event) => /HTTP 403/.test(event.message || '')));
  assert.equal(progress.at(-1).ratio, 1);
});

test('honours an already-aborted speed-test signal before opening a request', async (t) => {
  const socks = await createRelaySocksServer();
  const source = await startHttpSource();
  t.after(() => socks.server.close());
  t.after(() => source.server.close());
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(() => downloadSpeedTest({
    url: source.url,
    totalBytes: 1_000_000,
    threads: 1,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    signal: abort.signal,
  }), /测速已取消/);
});


test('allows a single-thread prefix read when a server ignores Range, but rejects fake multi-thread ranges', async (t) => {
  const socks = await createRelaySocksServer();
  const source = await startNoRangeHttpSource();
  t.after(() => socks.server.close());
  t.after(() => source.server.close());

  const single = await downloadSpeedTest({
    url: source.url,
    totalBytes: 1_000_000,
    threads: 1,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
  });
  assert.equal(single.bytes, 1_000_000);
  assert.equal(single.threads, 1);

  await assert.rejects(() => downloadSpeedTest({
    url: source.url,
    totalBytes: 1_000_000,
    threads: 2,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
  }), /Range 分段下载/);
});

test('rejects a 206 response whose Content-Range end exceeds the requested segment', async (t) => {
  const socks = await createRelaySocksServer();
  const body = Buffer.alloc(2 * 1024 * 1024, 0x63);
  const source = http.createServer((request, response) => {
    const range = request.headers.range;
    if (!range) {
      response.writeHead(200, { 'Content-Length': body.length });
      response.end(body);
      return;
    }
    const match = range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(match[1]);
    const requestedEnd = Number(match[2]);
    const end = Math.min(requestedEnd + 8, body.length - 1);
    response.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${body.length}`,
    });
    response.end(body.subarray(start, end + 1));
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  t.after(() => socks.server.close());
  t.after(() => source.close());

  await assert.rejects(() => downloadSpeedTest({
    url: `http://127.0.0.1:${source.address().port}/bad-range.bin`,
    totalBytes: 1_000_000,
    threads: 2,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 10000,
  }), /不匹配的 Content-Range/);
});

test('cancels an active download request and settles without waiting for the timeout', async (t) => {
  const socks = await createRelaySocksServer();
  const body = Buffer.alloc(2 * 1024 * 1024, 0x64);
  const source = http.createServer((request, response) => {
    const match = String(request.headers.range || '').match(/bytes=(\d+)-(\d+)/);
    if (!match) {
      response.writeHead(200, { 'Content-Length': body.length });
      response.end(body);
      return;
    }
    const start = Number(match[1]);
    const end = Math.min(Number(match[2]), body.length - 1);
    response.writeHead(206, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${body.length}`,
    });
    let offset = start;
    const timer = setInterval(() => {
      if (offset > end || response.destroyed) {
        clearInterval(timer);
        return;
      }
      const next = Math.min(offset + 16 * 1024, end + 1);
      response.write(body.subarray(offset, next));
      offset = next;
      if (offset > end) {
        clearInterval(timer);
        response.end();
      }
    }, 10);
    response.once('close', () => clearInterval(timer));
  });
  await new Promise((resolve) => source.listen(0, '127.0.0.1', resolve));
  t.after(() => socks.server.close());
  t.after(() => source.close());

  const abort = new AbortController();
  await assert.rejects(() => downloadSpeedTest({
    url: `http://127.0.0.1:${source.address().port}/slow.bin`,
    totalBytes: 1_000_000,
    threads: 1,
    proxyHost: '127.0.0.1',
    proxyPort: socks.port,
    timeoutMs: 30000,
    signal: abort.signal,
    onProgress: (progress) => {
      if (progress.receivedBytes > 0) abort.abort();
    },
  }), /测速已取消/);
});
