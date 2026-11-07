'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { buildBatchProxyConfig } = require('./singbox-config.cjs');
const { findAvailablePort, runCapture } = require('./core-controller.cjs');
const { probeSocks5, requestLatency, downloadSpeedTest } = require('./socks-speed-test.cjs');

const ALLOWED_CONCURRENCY = [1, 2, 4, 8, 16, 32];
const ALLOWED_DOWNLOAD_THREADS = [1, 2, 4, 8, 16, 32];
const MAX_BATCH_NODES = 32;
const MAX_NODE_COUNT = 512;
const MAX_TOTAL_RANGE_WORKERS = 64;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  return new Error('测速已取消');
}

function assertNotAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function parseIcmpOutput(stdout, stderr, sent = 3) {
  const output = String(stdout || '') + '\n' + String(stderr || '');
  const times = [...output.matchAll(/[=<]\s*(\d+(?:\.\d+)?)\s*ms/gi)].map((match) => Number(match[1]));
  const lossMatches = [...output.matchAll(/(\d{1,3})\s*%\s*(?:loss|丢失)/gi)];
  const lossPercent = lossMatches.length
    ? Math.min(100, Number(lossMatches[lossMatches.length - 1][1]))
    : Math.max(0, Math.min(100, Math.round((1 - times.length / sent) * 100)));
  const received = Math.max(0, Math.min(sent, times.length));
  if (/could not find host|找不到主机|unknown host|name or service not known|temporary failure in name resolution/i.test(output)) {
    return { status: 'error', averageMs: null, lossPercent: 100, sent, received, message: '域名解析失败' };
  }
  if (received === 0) {
    return { status: 'timeout', averageMs: null, lossPercent: 100, sent, received, message: '超时或服务器屏蔽 ICMP' };
  }
  return {
    status: 'ok',
    averageMs: Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(2)),
    lossPercent,
    sent,
    received,
    message: lossPercent > 0 ? '存在丢包' : null,
  };
}

function runIcmpPing(host, options = {}) {
  const count = Math.max(1, Math.min(5, Number(options.count) || 3));
  const timeoutMs = Math.max(250, Math.min(5000, Number(options.timeoutMs) || 1200));
  const spawnImpl = options.spawnImpl || spawn;
  const platform = options.platform || process.platform;
  const executable = platform === 'win32' ? 'ping.exe' : 'ping';
  const args = platform === 'win32'
    ? ['-n', String(count), '-w', String(timeoutMs), String(host)]
    : ['-c', String(count), '-W', String(Math.max(1, Math.ceil(timeoutMs / 1000))), String(host)];
  return new Promise((resolve, reject) => {
    assertNotAborted(options.signal);
    let child;
    try {
      child = spawnImpl(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: 'error', averageMs: null, lossPercent: 100, sent: count, received: 0, message: '无法启动 ICMP 检测：' + String(error.message || error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-32 * 1024);
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const finish = (result, error = null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(result);
    };
    const finishCancelled = () => finish(null, abortError());
    const onAbort = () => {
      if (settled) return;
      // Wait for ChildProcess close so a cancelled ICMP worker is not left behind.
      try { child.kill(); } catch { /* The ping process may already have exited. */ }
    };
    options.signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      try { child.kill(); } catch { /* The ping process may already have exited. */ }
      finish(parseIcmpOutput(stdout, stderr, count));
    }, count * (timeoutMs + 250) + 2500);
    child.once('error', (error) => {
      if (options.signal?.aborted) finishCancelled();
      else finish({
        status: 'error', averageMs: null, lossPercent: 100, sent: count, received: 0,
        message: 'ICMP 检测启动失败：' + String(error.message || error),
      });
    });
    child.once('close', () => {
      if (options.signal?.aborted) finishCancelled();
      else finish(parseIcmpOutput(stdout, stderr, count));
    });
  });
}

function tcpConnectOnce(host, port, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    assertNotAborted(signal);
    const startedAt = performance.now();
    let socket;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      socket?.destroy();
      resolve(result);
    };
    const fail = (error) => finish({
      ok: false,
      code: error?.code || 'ERROR',
      message: error?.code === 'ECONNREFUSED' ? 'TCP 端口拒绝连接'
        : error?.code === 'ETIMEDOUT' ? 'TCP 连接超时'
          : error?.code === 'ENOTFOUND' ? '域名解析失败'
            : 'TCP 连接失败' + (error?.code ? '（' + error.code + '）' : ''),
    });
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket?.destroy();
      reject(abortError());
    };
    const timer = setTimeout(() => finish({ ok: false, code: 'ETIMEDOUT', message: 'TCP 连接超时' }), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      socket = net.createConnection({ host, port });
      socket.once('connect', () => finish({ ok: true, latencyMs: performance.now() - startedAt }));
      socket.once('error', fail);
    } catch (error) {
      fail(error);
    }
  });
}

async function tcpPing(host, port, options = {}) {
  const count = Math.max(1, Math.min(5, Number(options.count) || 3));
  const timeoutMs = Math.max(250, Math.min(10000, Number(options.timeoutMs) || 2500));
  const samples = [];
  let lastError = null;
  for (let index = 0; index < count; index++) {
    assertNotAborted(options.signal);
    const result = await tcpConnectOnce(host, port, timeoutMs, options.signal);
    if (result.ok) samples.push(result.latencyMs);
    else lastError = result;
  }
  const lossPercent = Math.round((1 - samples.length / count) * 100);
  if (samples.length === 0) {
    return {
      status: lastError?.code === 'ETIMEDOUT' ? 'timeout' : 'error',
      averageMs: null,
      lossPercent: 100,
      sent: count,
      received: 0,
      message: lastError?.message || 'TCP 连接失败',
    };
  }
  return {
    status: 'ok',
    averageMs: Number((samples.reduce((sum, value) => sum + value, 0) / samples.length).toFixed(2)),
    lossPercent,
    sent: count,
    received: samples.length,
    message: lossPercent > 0 ? lastError?.message || '存在连接失败' : null,
  };
}

function effectiveDownloadThreads(requestedThreads, concurrency) {
  const threads = Number(requestedThreads);
  const workers = Number(concurrency);
  if (!ALLOWED_DOWNLOAD_THREADS.includes(threads)) throw new Error('单节点下载线程只允许 1、2、4、8、16 或 32');
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_BATCH_NODES) throw new Error('有效并发节点数必须在 1 至 32 之间');
  const budget = Math.max(1, Math.min(threads, Math.floor(MAX_TOTAL_RANGE_WORKERS / workers)));
  return ALLOWED_DOWNLOAD_THREADS.filter((value) => value <= budget).at(-1) || 1;
}

async function runWithConcurrency(items, concurrency, worker, signal) {
  if (!Array.isArray(items) || typeof worker !== 'function') throw new TypeError('并发任务参数无效');
  if (!ALLOWED_CONCURRENCY.includes(Number(concurrency))) throw new Error('并发节点数无效');
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Number(concurrency));
  const runners = Array.from({ length: workerCount }, async () => {
    while (!signal?.aborted) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (signal?.aborted) return;
        results[index] = { error: String(error?.message || error) };
      }
    }
  });
  const settled = await Promise.allSettled(runners);
  assertNotAborted(signal);
  const failedRunner = settled.find((item) => item.status === 'rejected');
  if (failedRunner) throw failedRunner.reason;
  return results;
}

function sanitizeMetricMessage(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, 180);
}

class BatchNodeTester {
  constructor(options) {
    if (!options || typeof options.getCorePath !== 'function' || typeof options.getUserDataPath !== 'function') {
      throw new TypeError('BatchNodeTester 缺少核心路径或用户数据目录提供器');
    }
    this.getCorePath = options.getCorePath;
    this.getUserDataPath = options.getUserDataPath;
    this.spawnImpl = options.spawnImpl || spawn;
    this.runCaptureImpl = options.runCaptureImpl || runCapture;
    this.findAvailablePortImpl = options.findAvailablePortImpl || findAvailablePort;
    this.probeSocksImpl = options.probeSocksImpl || probeSocks5;
    this.pingImpl = options.pingImpl || runIcmpPing;
    this.tcpPingImpl = options.tcpPingImpl || tcpPing;
    this.requestLatencyImpl = options.requestLatencyImpl || requestLatency;
    this.downloadSpeedTestImpl = options.downloadSpeedTestImpl || downloadSpeedTest;
    this.onProgress = options.onProgress || (() => {});
    this.onNodeResult = options.onNodeResult || (async () => {});
    this.activePromise = null;
    this.abortController = null;
  }

  get isRunning() {
    return Boolean(this.activePromise);
  }

  cancel() {
    if (!this.abortController || !this.activePromise) return Promise.resolve(false);
    this.abortController.abort();
    return this.activePromise.then(() => true, () => true);
  }

  run(nodes, options = {}) {
    if (this.activePromise) throw new Error('批量节点检测正在运行。');
    const controller = new AbortController();
    this.abortController = controller;
    this.activePromise = this._run(nodes, options, controller.signal)
      .finally(() => {
        this.activePromise = null;
        this.abortController = null;
      });
    return this.activePromise;
  }

  _emit(payload) {
    try { this.onProgress(payload); } catch { /* Renderer delivery must not affect network cleanup. */ }
  }

  async _run(nodes, options, signal) {
    if (!Array.isArray(nodes) || nodes.length < 1 || nodes.length > MAX_NODE_COUNT) {
      throw new Error('批量检测节点数量必须在 1 至 ' + MAX_NODE_COUNT + ' 个之间。');
    }
    const concurrency = Number(options.concurrency || 4);
    const requestedThreads = Number(options.downloadThreads || 1);
    if (!ALLOWED_DOWNLOAD_THREADS.includes(requestedThreads)) throw new Error('单节点下载线程只允许 1、2、4、8、16 或 32');
    const totalBytes = Number(options.totalBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes < 1_000_000 || totalBytes > 1_000_000_000) {
      throw new Error('测速下载量必须在 1 MB 至 1 GB 之间。');
    }
    if (typeof options.url !== 'string' || !options.url.trim()) throw new Error('测速地址不能为空。');
    const unique = [];
    const seen = new Set();
    for (const node of nodes) {
      if (!node || typeof node.id !== 'string' || !node.id || typeof node.server !== 'string'
        || !Number.isInteger(node.server_port) || node.server_port < 1 || node.server_port > 65535) {
        throw new Error('批量检测中包含无效节点。');
      }
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      unique.push(structuredClone(node));
    }
    if (unique.length === 0) throw new Error('没有可检测的节点。');
    const effectiveConcurrency = Math.min(concurrency, Math.min(MAX_BATCH_NODES, unique.length));
    const threads = effectiveDownloadThreads(requestedThreads, effectiveConcurrency);
    const batchId = crypto.randomUUID();
    const summary = { status: 'starting', batchId, total: unique.length, completed: 0, failed: 0, active: 0, concurrency, effectiveConcurrency, requestedDownloadThreads: requestedThreads, effectiveDownloadThreads: threads };
    this._emit(summary);
    let completed = 0;
    let failed = 0;
    try {
      const corePath = this.getCorePath();
      if (!corePath) throw new Error('未找到 sing-box 核心，无法执行真实代理检测。');
      const version = await this.runCaptureImpl(corePath, ['version'], { timeoutMs: 10000, spawnImpl: this.spawnImpl });
      if (version.exitCode !== 0) throw new Error('sing-box 核心检查失败：' + sanitizeMetricMessage(version.stderr || version.stdout));
      const coreVersion = String(version.stdout || version.stderr || '').split(/\r?\n/)[0].trim();

      for (let offset = 0; offset < unique.length; offset += MAX_BATCH_NODES) {
        assertNotAborted(signal);
        const group = unique.slice(offset, offset + MAX_BATCH_NODES);
        const session = await this._startSession(corePath, group, batchId, signal);
        try {
          const readiness = await Promise.all(session.entries.map((entry) => this._waitForProxy(entry.port, session, signal)));
          session.entries.forEach((entry, index) => { entry.proxyReady = readiness[index]; });
          await runWithConcurrency(group, concurrency, async (node, index) => {
            assertNotAborted(signal);
            const entry = session.entries[index];
            summary.status = 'running';
            summary.active++;
            this._emit({ ...summary, nodeId: node.id, nodeName: node.name, metric: 'node-started', result: { testedAt: new Date().toISOString(), status: 'testing' } });
            try {
              let result;
              try {
              result = await this._testNode(node, entry, {
                signal,
                batchId,
                url: options.url,
                fallbackUrls: options.fallbackUrls || [],
                totalBytes,
                threads,
                onMetric: (metric, currentResult, detail = {}) => {
                  this._emit({
                    ...summary,
                    status: 'running',
                    nodeId: node.id,
                    nodeName: node.name,
                    metric,
                    result: currentResult,
                    ...detail,
                  });
                },
              });
            } catch (error) {
              if (signal.aborted) throw abortError();
              result = {
                testedAt: new Date().toISOString(),
                status: 'error',
                ping: { status: 'error', averageMs: null, lossPercent: 100, message: sanitizeMetricMessage(error.message) },
                tcping: { status: node.type === 'hysteria2' ? 'not-applicable' : 'error', averageMs: null, lossPercent: 100, message: sanitizeMetricMessage(error.message) },
                proxyLatency: { status: 'error', latencyMs: null, message: sanitizeMetricMessage(error.message) },
                download: { status: 'error', averageMbps: null, peakMbps: null, bytes: 0, elapsedMs: 0, threads, message: sanitizeMetricMessage(error.message) },
              };
            }
            completed++;
            if (result.status !== 'complete') failed++;
            summary.completed = completed;
            summary.failed = failed;
            let persistenceWarning = null;
            try { await this.onNodeResult({ nodeId: node.id, result }); }
            catch (error) { persistenceWarning = sanitizeMetricMessage('结果保存失败：' + String(error.message || error)); }
            this._emit({ ...summary, status: 'running', completed, failed, active: Math.max(0, summary.active - 1), nodeId: node.id, nodeName: node.name, metric: 'node-complete', result, ...(persistenceWarning ? { persistenceWarning } : {}) });
              return result;
            } finally {
              summary.active = Math.max(0, summary.active - 1);
            }
          }, signal);
        } finally {
          await session.stop();
        }
      }
      const result = { status: 'completed', batchId, total: unique.length, completed, failed, concurrency, effectiveConcurrency, requestedDownloadThreads: requestedThreads, effectiveDownloadThreads: threads, coreVersion };
      this._emit(result);
      return result;
    } catch (error) {
      if (signal.aborted || String(error?.message || error).includes('测速已取消')) {
        const result = { status: 'cancelled', batchId, total: unique.length, completed, failed, concurrency, effectiveConcurrency, requestedDownloadThreads: requestedThreads, effectiveDownloadThreads: threads };
        this._emit(result);
        return result;
      }
      this._emit({ ...summary, status: 'error', message: sanitizeMetricMessage(error.message), completed, failed });
      throw error;
    }
  }

  async _startSession(corePath, nodes, batchId, signal) {
    assertNotAborted(signal);
    const entries = [];
    for (const node of nodes) {
      entries.push({ node, port: await this.findAvailablePortImpl('127.0.0.1'), proxyReady: false });
    }
    const config = buildBatchProxyConfig(entries.map((entry) => ({ node: entry.node, listenPort: entry.port })));
    const runtimeDir = path.join(this.getUserDataPath(), 'runtime');
    await fs.mkdir(runtimeDir, { recursive: true });
    const configPath = path.join(runtimeDir, 'batch-node-test-' + batchId + '-' + crypto.randomUUID() + '.json');
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    try {
      const checked = await this.runCaptureImpl(corePath, ['check', '-c', configPath], { timeoutMs: 30000, spawnImpl: this.spawnImpl });
      if (checked.exitCode !== 0) {
        throw new Error('批量 sing-box 配置检查失败：' + sanitizeMetricMessage(checked.stderr || checked.stdout || String(checked.exitCode)));
      }
      assertNotAborted(signal);
      const child = this.spawnImpl(corePath, ['run', '-c', configPath], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        cwd: path.dirname(corePath),
      });
      let exited = false;
      let exitResult = null;
      let resolveExit;
      const exitPromise = new Promise((resolve) => { resolveExit = resolve; });
      const finish = (code, closeSignal, spawnError) => {
        if (exited) return;
        exited = true;
        exitResult = { code: Number.isInteger(code) ? code : -1, signal: closeSignal || null, error: spawnError || null };
        resolveExit(exitResult);
      };
      child.once('exit', (code, closeSignal) => finish(code, closeSignal));
      child.once('close', (code, closeSignal) => finish(code, closeSignal));
      child.once('error', (error) => finish(-1, null, error));
      const session = {
        entries,
        child,
        configPath,
        exitPromise,
        get exited() { return exited; },
        get exitResult() { return exitResult; },
        stop: async () => {
          if (!exited) {
            try { child.kill('SIGTERM'); } catch { /* Process may already have exited. */ }
            await Promise.race([exitPromise, delay(4000)]);
          }
          if (!exited) {
            try { child.kill('SIGKILL'); } catch { /* Process may already have exited. */ }
            await Promise.race([exitPromise, delay(2000)]);
          }
          if (!exited) throw new Error('无法确认批量测速 sing-box 进程已退出；临时配置保留在用户数据目录。');
          await fs.rm(configPath, { force: true }).catch(() => {});
        },
      };
      // Do not throw after spawning: the caller owns this session and its finally
      // block must be responsible for terminating the child if cancellation raced
      // with process startup.
      return session;
    } catch (error) {
      await fs.rm(configPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async _waitForProxy(port, session, signal) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      assertNotAborted(signal);
      if (session.exited) return false;
      try {
        if (await this.probeSocksImpl('127.0.0.1', port, 700)) return true;
      } catch { /* Retry until the bounded readiness deadline. */ }
      await delay(120);
    }
    return false;
  }

  async _testNode(node, entry, context) {
    const base = {
      testedAt: new Date().toISOString(),
      status: 'testing',
      ping: { status: 'testing', averageMs: null, lossPercent: null },
      tcping: node.type === 'hysteria2'
        ? { status: 'not-applicable', averageMs: null, lossPercent: null, message: 'Hysteria2 使用 UDP/QUIC' }
        : { status: 'testing', averageMs: null, lossPercent: null },
      proxyLatency: { status: 'testing', latencyMs: null },
      download: { status: 'testing', averageMbps: null, peakMbps: null, bytes: 0, elapsedMs: 0, threads: context.threads },
    };
    const report = (metric) => context.onMetric(metric, structuredClone(base));
    const [ping, tcp] = await Promise.all([
      this.pingImpl(node.server, { count: 3, timeoutMs: 1200, signal: context.signal }),
      node.type === 'hysteria2'
        ? Promise.resolve(base.tcping)
        : this.tcpPingImpl(node.server, node.server_port, { count: 3, timeoutMs: 2500, signal: context.signal }),
    ]);
    assertNotAborted(context.signal);
    base.ping = ping;
    report('ping');
    base.tcping = tcp;
    report('tcping');

    if (!entry.proxyReady) {
      base.proxyLatency = { status: 'error', latencyMs: null, message: '批量本地 SOCKS5 入站未能就绪' };
      base.download = { status: 'error', averageMbps: null, peakMbps: null, bytes: 0, elapsedMs: 0, threads: context.threads, message: '批量本地 SOCKS5 入站未能就绪' };
      base.status = 'partial';
      base.testedAt = new Date().toISOString();
      report('node-complete');
      return base;
    }

    try {
      const latency = await this.requestLatencyImpl(context.url, '127.0.0.1', entry.port, { timeoutMs: 20000, signal: context.signal });
      base.proxyLatency = { status: 'ok', latencyMs: Math.round(latency.latencyMs), statusCode: latency.statusCode };
    } catch (error) {
      if (context.signal.aborted) throw abortError();
      base.proxyLatency = { status: 'error', latencyMs: null, message: sanitizeMetricMessage(error.message) };
    }
    report('proxy-latency');

    try {
      const download = await this.downloadSpeedTestImpl({
        url: context.url,
        fallbackUrls: context.fallbackUrls,
        totalBytes: context.totalBytes,
        threads: context.threads,
        proxyHost: '127.0.0.1',
        proxyPort: entry.port,
        timeoutMs: 90000,
        signal: context.signal,
        onProgress: (progress) => context.onMetric('download-progress', structuredClone(base), {
          downloadProgress: {
            receivedBytes: progress.receivedBytes || 0,
            totalBytes: progress.totalBytes || context.totalBytes,
            ratio: progress.ratio || 0,
            completedWorkers: progress.completedWorkers || 0,
            threads: progress.threads || context.threads,
            message: sanitizeMetricMessage(progress.message),
          },
        }),
      });
      base.download = {
        status: 'ok',
        averageMbps: download.averageMbps,
        peakMbps: download.peakMbps,
        bytes: download.bytes,
        elapsedMs: download.elapsedMs,
        threads: download.threads,
        statusCode: download.statusCode,
      };
    } catch (error) {
      if (context.signal.aborted) throw abortError();
      base.download = {
        status: 'error', averageMbps: null, peakMbps: null, bytes: 0,
        elapsedMs: 0, threads: context.threads, message: sanitizeMetricMessage(error.message),
      };
    }
    base.status = base.ping.status === 'ok' || base.tcping.status === 'ok'
      || base.proxyLatency.status === 'ok' || base.download.status === 'ok' ? 'complete' : 'error';
    if (base.status === 'complete' && (base.ping.status !== 'ok' || (node.type !== 'hysteria2' && base.tcping.status !== 'ok')
      || base.proxyLatency.status !== 'ok' || base.download.status !== 'ok')) base.status = 'partial';
    base.testedAt = new Date().toISOString();
    report('node-complete');
    return base;
  }
}

module.exports = {
  ALLOWED_CONCURRENCY,
  ALLOWED_DOWNLOAD_THREADS,
  MAX_BATCH_NODES,
  MAX_NODE_COUNT,
  MAX_TOTAL_RANGE_WORKERS,
  BatchNodeTester,
  parseIcmpOutput,
  runIcmpPing,
  tcpPing,
  effectiveDownloadThreads,
  runWithConcurrency,
};
