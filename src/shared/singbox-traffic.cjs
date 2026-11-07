'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const LOOPBACK = '127.0.0.1';
const DEFAULT_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 1800;

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host: LOOPBACK, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法分配 Clash API 本地端口'));
        return;
      }
      const port = address.port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function createClashApiEndpoint() {
  const port = await reserveLoopbackPort();
  return {
    host: LOOPBACK,
    port,
    secret: crypto.randomBytes(32).toString('hex'),
  };
}

function toClashApiConfig(endpoint) {
  if (!endpoint || endpoint.host !== LOOPBACK) {
    throw new Error('Clash API 只允许绑定 127.0.0.1');
  }
  const port = Number(endpoint.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Clash API 端口无效');
  }
  if (typeof endpoint.secret !== 'string' || !/^[a-f0-9]{64}$/i.test(endpoint.secret)) {
    throw new Error('Clash API 会话密钥无效');
  }
  return {
    external_controller: LOOPBACK + ':' + port,
    secret: endpoint.secret,
  };
}

function parseConnectionsSnapshot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const uploadBytes = Number(value.uploadTotal);
  const downloadBytes = Number(value.downloadTotal);
  if (!Number.isSafeInteger(uploadBytes) || uploadBytes < 0
    || !Number.isSafeInteger(downloadBytes) || downloadBytes < 0) return null;
  return { uploadBytes, downloadBytes };
}

class TrafficMonitor {
  constructor(options = {}) {
    const endpoint = options.endpoint;
    if (!endpoint || endpoint.host !== LOOPBACK
      || !Number.isInteger(Number(endpoint.port)) || Number(endpoint.port) < 1 || Number(endpoint.port) > 65535
      || typeof endpoint.secret !== 'string' || !/^[a-f0-9]{64}$/i.test(endpoint.secret)) {
      throw new TypeError('TrafficMonitor 需要有效的 loopback Clash API 会话端点');
    }
    this.endpoint = { host: LOOPBACK, port: Number(endpoint.port), secret: endpoint.secret };
    this.sessionId = String(options.sessionId || '');
    this.mode = options.mode === 'tun' ? 'tun' : 'proxy';
    this.nodeId = typeof options.nodeId === 'string' ? options.nodeId : null;
    this.nodeName = typeof options.nodeName === 'string' ? options.nodeName : null;
    this.startedAt = options.startedAt || new Date().toISOString();
    this.intervalMs = Math.max(250, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
    this.timeoutMs = Math.max(250, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS);
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.now = options.now || Date.now;
    this.onSample = options.onSample || (() => {});
    if (typeof this.fetchImpl !== 'function') throw new TypeError('当前 Node.js 环境不支持 fetch');
    this.lastTotals = null;
    this.lastSuccessAt = null;
    this.totalUploadBytes = 0;
    this.totalDownloadBytes = 0;
    this.uploadRates = [];
    this.downloadRates = [];
    this.lastStatus = 'starting';
    this.timer = null;
    this.inFlight = null;
    this.stopped = false;
    this.finalEmitted = false;
  }

  _makeSample(status, extra = {}) {
    const sampledAt = new Date(this.now()).toISOString();
    return {
      sessionId: this.sessionId,
      mode: this.mode,
      nodeId: this.nodeId,
      nodeName: this.nodeName,
      startedAt: this.startedAt,
      sampledAt,
      status,
      active: !this.stopped,
      uploadBytes: this.totalUploadBytes,
      downloadBytes: this.totalDownloadBytes,
      totalBytes: this.totalUploadBytes + this.totalDownloadBytes,
      uploadBps: this.uploadRates.length ? this.uploadRates.reduce((a, b) => a + b, 0) / this.uploadRates.length : 0,
      downloadBps: this.downloadRates.length ? this.downloadRates.reduce((a, b) => a + b, 0) / this.downloadRates.length : 0,
      ...extra,
    };
  }

  async _emit(sample) {
    try { await this.onSample(sample); } catch { /* Telemetry must never affect the network session. */ }
  }

  start() {
    if (this.stopped || this.timer) return;
    this.timer = setInterval(() => { void this.pollNow(); }, this.intervalMs);
    this.timer.unref?.();
    void this.pollNow();
  }

  pollNow() {
    if (this.stopped) return Promise.resolve(null);
    if (this.inFlight) return this.inFlight;
    this.inFlight = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      timeout.unref?.();
      try {
        const response = await this.fetchImpl(
          'http://' + LOOPBACK + ':' + this.endpoint.port + '/connections',
          { method: 'GET', headers: { Authorization: 'Bearer ' + this.endpoint.secret }, signal: controller.signal },
        );
        if (!response || !response.ok) throw new Error('Clash API HTTP ' + Number(response?.status || 0));
        const snapshot = parseConnectionsSnapshot(await response.json());
        if (!snapshot) throw new Error('Clash API 流量快照格式无效');
        const now = this.now();
        let deltaUploadBytes = 0;
        let deltaDownloadBytes = 0;
        let elapsedSeconds = this.intervalMs / 1000;
        if (this.lastTotals) {
          deltaUploadBytes = snapshot.uploadBytes >= this.lastTotals.uploadBytes
            ? snapshot.uploadBytes - this.lastTotals.uploadBytes : 0;
          deltaDownloadBytes = snapshot.downloadBytes >= this.lastTotals.downloadBytes
            ? snapshot.downloadBytes - this.lastTotals.downloadBytes : 0;
          elapsedSeconds = Math.max(0.001, (now - this.lastSuccessAt) / 1000);
          this.totalUploadBytes += deltaUploadBytes;
          this.totalDownloadBytes += deltaDownloadBytes;
          this.uploadRates.push(deltaUploadBytes / elapsedSeconds);
          this.downloadRates.push(deltaDownloadBytes / elapsedSeconds);
          if (this.uploadRates.length > 3) this.uploadRates.shift();
          if (this.downloadRates.length > 3) this.downloadRates.shift();
        }
        this.lastTotals = snapshot;
        this.lastSuccessAt = now;
        this.lastStatus = 'ok';
        const sample = this._makeSample('ok', {
          deltaUploadBytes,
          deltaDownloadBytes,
          elapsedSeconds,
          final: false,
        });
        await this._emit(sample);
        return sample;
      } catch (error) {
        this.lastStatus = 'unavailable';
        const sample = this._makeSample('unavailable', {
          deltaUploadBytes: 0,
          deltaDownloadBytes: 0,
          error: String(error?.message || error).slice(0, 240),
          final: false,
        });
        await this._emit(sample);
        return sample;
      } finally {
        clearTimeout(timeout);
      }
    })().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async stop(options = {}) {
    if (this.finalEmitted) return this._makeSample('stopped', { final: true });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (options.pollFinal !== false && !this.stopped) await this.pollNow();
    this.stopped = true;
    if (this.inFlight) await this.inFlight;
    this.uploadRates = [];
    this.downloadRates = [];
    const sample = this._makeSample(this.lastStatus === 'unavailable' ? 'unavailable' : 'stopped', {
      deltaUploadBytes: 0,
      deltaDownloadBytes: 0,
      final: true,
    });
    this.finalEmitted = true;
    await this._emit(sample);
    return sample;
  }
}

module.exports = {
  LOOPBACK,
  TrafficMonitor,
  createClashApiEndpoint,
  toClashApiConfig,
  parseConnectionsSnapshot,
  reserveLoopbackPort,
};
