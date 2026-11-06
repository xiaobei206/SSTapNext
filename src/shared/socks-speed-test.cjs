'use strict';

const net = require('node:net');
const tls = require('node:tls');
const http = require('node:http');
const https = require('node:https');
const { performance } = require('node:perf_hooks');

function readExactly(socket, length) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('readable', onReadable);
      socket.off('error', onError);
      socket.off('end', onEnd);
      socket.off('close', onClose);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onReadable = () => {
      const data = socket.read(length);
      if (data === null) return;
      cleanup();
      resolve(data);
    };
    const onError = (error) => fail(error);
    const onEnd = () => fail(new Error('SOCKS5 代理在握手完成前关闭连接'));
    const onClose = () => fail(new Error('SOCKS5 代理在握手完成前断开连接'));

    socket.on('readable', onReadable);
    socket.once('error', onError);
    socket.once('end', onEnd);
    socket.once('close', onClose);
    onReadable();
  });
}


function probeSocks5(proxyHost, proxyPort, timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: proxyHost, port: proxyPort });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('connect', async () => {
      try {
        socket.write(Buffer.from([5, 1, 0]));
        const greeting = await readExactly(socket, 2);
        finish(greeting[0] === 5 && greeting[1] === 0);
      } catch {
        finish(false);
      }
    });
  });
}

function encodeSocksAddress(host) {
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    return Buffer.from([1, ...host.split('.').map((part) => Number(part))]);
  }
  if (ipVersion === 6) {
    const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
    const halves = normalized.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const fill = new Array(Math.max(0, 8 - left.length - right.length)).fill('0');
    const groups = [...left, ...fill, ...right].map((part) => Number.parseInt(part || '0', 16));
    if (groups.length !== 8 || groups.some((part) => !Number.isInteger(part) || part < 0 || part > 0xffff)) {
      throw new Error('目标 IPv6 地址格式无效');
    }
    const bytes = Buffer.alloc(16);
    groups.forEach((part, index) => bytes.writeUInt16BE(part, index * 2));
    return Buffer.concat([Buffer.from([4]), bytes]);
  }
  const domain = Buffer.from(host, 'utf8');
  if (domain.length < 1 || domain.length > 255) throw new Error('目标域名长度无效');
  return Buffer.concat([Buffer.from([3, domain.length]), domain]);
}

function createSocks5Socket(proxyHost, proxyPort, targetHost, targetPort, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: proxyHost, port: proxyPort });
    let settled = false;
    const timer = setTimeout(() => finish(new Error('连接本地 SOCKS5 代理超时')), timeoutMs);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        socket.destroy();
        reject(error);
      } else {
        resolve(result);
      }
    };

    socket.setNoDelay(true);
    socket.once('error', (error) => finish(error));
    socket.once('connect', async () => {
      try {
        const read = (length) => readExactly(socket, length);
        socket.write(Buffer.from([5, 1, 0]));
        const greeting = await read(2);
        if (greeting[0] !== 5 || greeting[1] !== 0) {
          throw new Error(greeting[1] === 0xff ? '本地 SOCKS5 代理不接受无认证连接' : '本地 SOCKS5 握手失败');
        }

        const address = encodeSocksAddress(targetHost);
        const port = Buffer.alloc(2);
        port.writeUInt16BE(targetPort);
        socket.write(Buffer.concat([Buffer.from([5, 1, 0]), address, port]));

        const header = await read(4);
        if (header[0] !== 5) throw new Error('SOCKS5 响应版本无效');
        if (header[1] !== 0) {
          const reasons = ['成功', '一般性失败', '规则禁止', '网络不可达', '主机不可达', '连接拒绝', 'TTL 过期', '不支持的命令', '不支持的地址类型'];
          throw new Error(`SOCKS5 连接目标失败：${reasons[header[1]] || `状态 ${header[1]}`}`);
        }
        if (header[3] === 1) await read(4);
        else if (header[3] === 4) await read(16);
        else if (header[3] === 3) {
          const length = (await read(1))[0];
          await read(length);
        } else throw new Error('SOCKS5 返回了未知地址类型');
        await read(2); // Bound port.
        finish(null, socket);
      } catch (error) {
        finish(error);
      }
    });
  });
}

class Socks5HttpAgent extends http.Agent {
  constructor(proxyHost, proxyPort, options = {}) {
    super({ keepAlive: false, maxSockets: options.maxSockets || 8 });
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  createConnection(options, callback) {
    createSocks5Socket(this.proxyHost, this.proxyPort, options.hostname || options.host, Number(options.port || 80), this.timeoutMs)
      .then((socket) => callback(null, socket), callback);
    return undefined;
  }
}

class Socks5HttpsAgent extends https.Agent {
  constructor(proxyHost, proxyPort, options = {}) {
    super({ keepAlive: false, maxSockets: options.maxSockets || 8 });
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.timeoutMs = options.timeoutMs || 15000;
  }

  createConnection(options, callback) {
    const host = options.hostname || options.host;
    createSocks5Socket(this.proxyHost, this.proxyPort, host, Number(options.port || 443), this.timeoutMs)
      .then((socket) => {
        const secureSocket = tls.connect({
          socket,
          servername: net.isIP(host) ? undefined : (options.servername || host),
          rejectUnauthorized: true,
          ALPNProtocols: ['http/1.1'],
        });
        secureSocket.once('secureConnect', () => callback(null, secureSocket));
        secureSocket.once('error', callback);
      }, callback);
    return undefined;
  }
}

function createAgent(url, proxyHost, proxyPort, options) {
  const protocol = new URL(url).protocol;
  if (protocol === 'https:') return new Socks5HttpsAgent(proxyHost, proxyPort, options);
  if (protocol === 'http:') return new Socks5HttpAgent(proxyHost, proxyPort, options);
  throw new Error('测速地址只支持 HTTP 或 HTTPS');
}

function validateTestUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('测速地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('测速地址必须是无账号密码的 HTTP/HTTPS URL');
  }
  return parsed;
}

function requestHeaders(url, agent, headers, timeoutMs, method = 'GET', signal) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.request(parsed, {
      method,
      agent,
      headers: {
        'User-Agent': 'SSTapNext-SpeedTest/0.3.7',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        ...headers,
      },
    }, (response) => resolve({ response, request }));
    const onAbort = () => request.destroy(new Error('测速已取消'));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`测速请求超时（${Math.round(timeoutMs / 1000)} 秒）`)));
    request.once('error', (error) => { signal?.removeEventListener('abort', onAbort); reject(error); });
    request.once('close', () => signal?.removeEventListener('abort', onAbort));
    request.end();
  });
}

async function requestLatency(url, proxyHost, proxyPort, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const maxRedirects = options.maxRedirects ?? 3;
  let current = validateTestUrl(url);
  const originalProtocol = current.protocol;
  const startedAt = performance.now();

  for (let redirect = 0; ; redirect++) {
    const agent = createAgent(current.href, proxyHost, proxyPort, { timeoutMs });
    try {
      const { response } = await requestHeaders(current.href, agent, { Range: 'bytes=0-0' }, timeoutMs, 'GET', options.signal);
      const statusCode = response.statusCode || 0;
      const location = response.headers.location;
      response.destroy();
      if (statusCode >= 300 && statusCode < 400 && location) {
        if (redirect >= maxRedirects) throw new Error('测速地址重定向次数过多');
        const next = new URL(location, current);
        if (!['http:', 'https:'].includes(next.protocol) || (originalProtocol === 'https:' && next.protocol !== 'https:')) {
          throw new Error('测速地址重定向不安全（不允许 HTTPS 降级）');
        }
        current = next;
        continue;
      }
      if (statusCode < 200 || statusCode >= 400) throw new Error(`测速服务器返回 HTTP ${statusCode}`);
      return { latencyMs: Math.max(0, performance.now() - startedAt), statusCode };
    } finally {
      agent.destroy();
    }
  }
}

function isCloudflareDownloadEndpoint(url) {
  const parsed = new URL(url);
  return parsed.hostname === 'speed.cloudflare.com' && parsed.pathname === '/__down';
}

function downloadOne(url, start, length, agent, timeoutMs, onBytes, signal, redirectCount = 0, originalProtocol = new URL(url).protocol) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const cloudflare = isCloudflareDownloadEndpoint(parsed.href);
    if (cloudflare) parsed.searchParams.set('bytes', String(length));
    const range = cloudflare ? undefined : `bytes=${start}-${start + length - 1}`;
    const headers = range ? { Range: range } : {};
    let received = 0;
    let settled = false;
    let response;
    let request;
    const timer = setTimeout(() => finish(new Error(`下载测速超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(value);
    };
    const onAbort = () => {
      const error = new Error('测速已取消');
      request?.destroy(error);
      finish(error);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });

    const parsedUrl = new URL(parsed.href);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    request = client.request(parsedUrl, {
      method: 'GET', agent, headers: {
        'User-Agent': 'SSTapNext-SpeedTest/0.3.7',
        'Accept-Encoding': 'identity',
        Connection: 'close',
        ...headers,
      },
    }, (res) => {
      response = res;
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location) {
        res.resume();
        if (redirectCount >= 3) { finish(new Error('测速下载重定向次数过多')); return; }
        const next = new URL(location, parsed);
        if (!['http:', 'https:'].includes(next.protocol) || (originalProtocol === 'https:' && next.protocol !== 'https:')) {
          finish(new Error('测速下载重定向不安全（不允许 HTTPS 降级）'));
          return;
        }
        const nextAgent = createAgent(next.href, agent.proxyHost, agent.proxyPort, { maxSockets: 1, timeoutMs: 15000 });
        finish(null, { redirect: next.href, agent: nextAgent });
        return;
      }
      if (status !== 200 && status !== 206) {
        res.resume();
        finish(new Error(`测速服务器返回 HTTP ${status}`));
        return;
      }
      if (range && status !== 206 && start !== 0) {
        res.resume();
        finish(new Error('测速服务器未正确支持 HTTP Range 分段下载；请改用支持 Range 的文件地址，或使用单线程测试。'));
        return;
      }
      if (range && status === 206) {
        const contentRange = String(res.headers['content-range'] || '');
        const match = contentRange.match(/^bytes\s+(\d+)-(\d+)\/(\d+|\*)$/i);
        if (!match || Number(match[1]) !== start || Number(match[2]) !== start + length - 1) {
          res.resume();
          finish(new Error(`测速服务器返回了不匹配的 Content-Range：${contentRange || '缺失'}`));
          return;
        }
      }
      res.on('data', (chunk) => {
        const accepted = Math.min(chunk.length, length - received);
        if (accepted <= 0) return;
        received += accepted;
        onBytes(accepted);
        if (received >= length) {
          res.destroy();
          request.destroy();
          finish(null, { bytes: received, statusCode: status });
        }
      });
      res.once('end', () => {
        if (received < length) finish(new Error(`测速文件提前结束：需要 ${length} 字节，实际收到 ${received} 字节`));
      });
      res.once('error', (error) => {
        if (!settled && error.code !== 'ECONNRESET') finish(error);
      });
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`下载测速超时（${Math.round(timeoutMs / 1000)} 秒）`)));
    request.once('error', (error) => {
      if (!settled) finish(error);
    });
    request.end();
  }).then(async (result) => {
    if (!result?.redirect) return result;
    try {
      return await downloadOne(result.redirect, start, length, result.agent, timeoutMs, onBytes, signal, redirectCount + 1, originalProtocol);
    } finally {
      result.agent.destroy();
    }
  });
}

async function downloadSpeedTestOnce(options, requestedUrl) {
  const url = validateTestUrl(requestedUrl).href;
  const totalBytes = Number(options.totalBytes);
  const threads = Number(options.threads || 1);
  const proxyHost = options.proxyHost || '127.0.0.1';
  const proxyPort = Number(options.proxyPort);
  const timeoutMs = Number(options.timeoutMs || 90000);
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 1_000_000 || totalBytes > 1_000_000_000) {
    throw new Error('测速下载量必须在 1 MB 至 1 GB 之间');
  }
  if (!Number.isInteger(threads) || ![1, 2, 4, 8].includes(threads)) throw new Error('测速线程数只允许 1、2、4 或 8');
  if (!Number.isInteger(proxyPort) || proxyPort < 1 || proxyPort > 65535) throw new Error('本地 SOCKS5 端口无效');

  const abortController = new AbortController();
  const onExternalAbort = () => abortController.abort();
  if (options.signal?.aborted) abortController.abort();
  else options.signal?.addEventListener('abort', onExternalAbort, { once: true });
  let totalReceived = 0;
  let peakMbps = 0;
  let sampleBytes = 0;
  let sampleStartedAt = performance.now();
  let completedWorkers = 0;
  const agent = createAgent(url, proxyHost, proxyPort, { maxSockets: threads, timeoutMs: 15000 });
  const emit = () => {
    options.onProgress?.({
      receivedBytes: totalReceived,
      totalBytes,
      ratio: Math.min(1, totalReceived / totalBytes),
      completedWorkers,
      threads,
    });
  };
  const onBytes = (count) => {
    totalReceived += count;
    sampleBytes += count;
    const now = performance.now();
    const elapsed = now - sampleStartedAt;
    if (elapsed >= 400) {
      peakMbps = Math.max(peakMbps, (sampleBytes * 8) / (elapsed * 1000));
      sampleBytes = 0;
      sampleStartedAt = now;
    }
    emit();
  };

  try {
    if (abortController.signal.aborted) throw new Error('测速已取消');
    const latency = await requestLatency(url, proxyHost, proxyPort, { timeoutMs: Math.min(timeoutMs, 20000), signal: abortController.signal });
    const downloadStartedAt = performance.now();
    sampleStartedAt = downloadStartedAt;
    const chunkBase = Math.floor(totalBytes / threads);
    const jobs = Array.from({ length: threads }, (_, index) => {
      const offset = index * chunkBase;
      const length = index === threads - 1 ? totalBytes - offset : chunkBase;
      return downloadOne(url, offset, length, agent, timeoutMs, onBytes, abortController.signal)
        .then((result) => { completedWorkers++; emit(); return result; })
        .catch((error) => { abortController.abort(); throw error; });
    });
    const results = await Promise.all(jobs);
    const elapsedMs = performance.now() - downloadStartedAt;
    if (totalReceived < totalBytes) throw new Error(`下载量不足：${totalReceived}/${totalBytes} 字节`);
    const averageMbps = (totalReceived * 8) / (elapsedMs * 1000);
    if (sampleBytes > 0) {
      const finalSampleMs = performance.now() - sampleStartedAt;
      if (finalSampleMs > 0) peakMbps = Math.max(peakMbps, (sampleBytes * 8) / (finalSampleMs * 1000));
    }
    if (peakMbps <= 0) peakMbps = averageMbps;
    return {
      testedAt: new Date().toISOString(),
      url,
      bytes: totalReceived,
      elapsedMs: Math.round(elapsedMs),
      latencyMs: Math.round(latency.latencyMs),
      averageMbps: Number(averageMbps.toFixed(2)),
      peakMbps: Number(peakMbps.toFixed(2)),
      threads,
      statusCode: results[0]?.statusCode || latency.statusCode,
    };
  } finally {
    abortController.abort();
    options.signal?.removeEventListener('abort', onExternalAbort);
    agent.destroy();
  }
}

function isRetryableSpeedSourceError(error) {
  const message = String(error?.message || error || '');
  if (/测速已取消/.test(message)) return false;
  const status = message.match(/HTTP (\d{3})/i)?.[1];
  if (status) {
    const code = Number(status);
    return code === 403 || code === 404 || code === 408 || code === 429 || code >= 500;
  }
  return /ECONNRESET|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|证书|TLS/i.test(message);
}

async function downloadSpeedTest(options) {
  const primaryUrl = validateTestUrl(options.url).href;
  const fallbackUrls = Array.isArray(options.fallbackUrls) ? options.fallbackUrls.slice(0, 4) : [];
  const urls = [...new Set([primaryUrl, ...fallbackUrls.map((value) => validateTestUrl(value).href)])];
  let lastError;

  for (let index = 0; index < urls.length; index++) {
    if (options.signal?.aborted) throw new Error('测速已取消');
    const currentUrl = urls[index];
    try {
      return await downloadSpeedTestOnce(options, currentUrl);
    } catch (error) {
      lastError = error;
      if (options.signal?.aborted || index === urls.length - 1 || !isRetryableSpeedSourceError(error)) throw error;
      const failedHost = new URL(currentUrl).hostname;
      const nextHost = new URL(urls[index + 1]).hostname;
      options.onProgress?.({
        status: 'running', receivedBytes: 0, totalBytes: Number(options.totalBytes) || 0,
        ratio: 0, completedWorkers: 0, threads: Number(options.threads) || 1,
        message: `测速源 ${failedHost} 不可用（${error.message}），正在切换备用源 ${nextHost}…`,
      });
    }
  }
  throw lastError || new Error('没有可用的测速服务器');
}

module.exports = { Socks5HttpAgent, Socks5HttpsAgent, createSocks5Socket, probeSocks5, requestLatency, downloadSpeedTest, isRetryableSpeedSourceError };
