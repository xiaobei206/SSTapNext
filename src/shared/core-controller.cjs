'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { buildProxyConfig } = require('./singbox-config.cjs');
const { probeSocks5 } = require('./socks-speed-test.cjs');
const { TrafficMonitor, createClashApiEndpoint } = require('./singbox-traffic.cjs');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAvailablePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen({ host, port: 0, exclusive: true }, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close();
        reject(new Error('无法分配本地代理端口'));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function canConnect(host, port, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function runCapture(executable, args, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const spawnImpl = options.spawnImpl || spawn;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(executable),
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString('utf8')).slice(-512 * 1024);
    child.stdout?.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* Process may have exited. */ }
      reject(new Error(`sing-box 命令执行超时：${args[0]}`));
    }, timeoutMs);
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode: Number.isInteger(code) ? code : -1, stdout, stderr });
    });
  });
}

class CoreController {
  constructor(options) {
    if (!options || typeof options.getCorePath !== 'function' || typeof options.getUserDataPath !== 'function') {
      throw new TypeError('CoreController 缺少核心路径或用户数据目录提供器');
    }
    this.getCorePath = options.getCorePath;
    this.getUserDataPath = options.getUserDataPath;
    this.spawnImpl = options.spawnImpl || spawn;
    this.onEvent = options.onEvent || (() => {});
    this.onTraffic = options.onTraffic || (() => {});
    this.session = null;
    this.startPromise = null;
    this.startNodeId = null;
    this.stopPromise = null;
    this.lastStatus = { status: 'disconnected', connected: false, lastError: null };
  }

  _emit() {
    const status = this.getStatus();
    this.lastStatus = status;
    try { this.onEvent(status); } catch { /* UI event delivery must not affect the core process. */ }
  }

  getStatus() {
    const session = this.session;
    if (!session) return structuredClone(this.lastStatus);
    return {
      status: session.status,
      sessionId: session.sessionId,
      connected: session.status === 'connected',
      nodeId: session.node.id,
      nodeName: session.node.name,
      server: session.node.server,
      serverPort: session.node.server_port,
      pid: session.child?.pid || null,
      startedAt: session.startedAt || null,
      proxyHost: '127.0.0.1',
      proxyPort: session.proxyPort,
      socks5Url: `socks5h://127.0.0.1:${session.proxyPort}`,
      httpUrl: `http://127.0.0.1:${session.proxyPort}`,
      coreVersion: session.coreVersion,
      logs: [...session.logs],
      lastError: session.lastError || null,
    };
  }

  async checkCore() {
    const executable = this.getCorePath();
    if (!executable) {
      return { installed: false, executable: null, version: null, error: '未找到 sing-box.exe。请先运行 scripts\\Fetch-SingBox.ps1。' };
    }
    try {
      const result = await runCapture(executable, ['version'], { timeoutMs: 10000, spawnImpl: this.spawnImpl });
      if (result.exitCode !== 0) {
        return { installed: false, executable, version: null, error: (result.stderr || result.stdout || `退出代码 ${result.exitCode}`).trim() };
      }
      return { installed: true, executable, version: (result.stdout || result.stderr).trim().split(/\r?\n/)[0] || 'sing-box', error: null };
    } catch (error) {
      return { installed: false, executable, version: null, error: String(error.message || error) };
    }
  }

  async connect(node) {
    if (!node || typeof node.id !== 'string') throw new Error('请先选择一个有效节点');
    if (this.session?.status === 'connected') {
      if (this.session.node.id === node.id) return this.getStatus();
      throw new Error('当前已有节点连接，请先断开，再连接其他节点。');
    }
    if (this.startPromise) {
      if (this.startNodeId === node.id) return this.startPromise;
      throw new Error('另一个节点正在启动，请等待启动完成或关闭后再切换。');
    }
    if (this.stopPromise) await this.stopPromise;
    // Recover a previous failed/stale session before creating another child process.
    if (this.session) await this.disconnect();
    this.startNodeId = node.id;
    this.lastStatus = {
      status: 'starting', connected: false, nodeId: node.id,
      nodeName: node.name, server: node.server, serverPort: node.server_port,
      lastError: null,
    };
    this._emit();
    this.startPromise = this._connect(node)
      .catch((error) => {
        if (!this.session) {
          this.lastStatus = {
            status: 'error', connected: false, nodeId: node.id,
            nodeName: node.name, server: node.server, serverPort: node.server_port,
            lastError: String(error.message || error),
          };
          this._emit();
        }
        throw error;
      })
      .finally(() => { this.startPromise = null; this.startNodeId = null; });
    return this.startPromise;
  }

  async _connect(node) {
    if (!node || typeof node.id !== 'string') throw new Error('请先选择一个有效节点');
    const core = await this.checkCore();
    if (!core.installed) throw new Error(core.error || 'sing-box 核心不可用');

    const port = await findAvailablePort('127.0.0.1');
    const trafficEndpoint = await createClashApiEndpoint();
    const config = buildProxyConfig(node, { listen: '127.0.0.1', listenPort: port, clashApi: trafficEndpoint });
    const configDir = path.join(this.getUserDataPath(), 'runtime');
    await fs.mkdir(configDir, { recursive: true });
    const configPath = path.join(configDir, `session-${crypto.randomUUID()}.json`);
    // sing-box requires a file; it is kept only for the lifetime of the child process.
    // The containing Electron userData directory is user-scoped on Windows.
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

    let check;
    try {
      check = await runCapture(core.executable, ['check', '-c', configPath], { timeoutMs: 20000, spawnImpl: this.spawnImpl });
      if (check.exitCode !== 0) {
        const detail = (check.stderr || check.stdout || `退出代码 ${check.exitCode}`).trim();
        throw new Error(`sing-box 配置检查未通过：${detail.slice(-1200)}`);
      }
    } catch (error) {
      await fs.rm(configPath, { force: true }).catch(() => {});
      throw error;
    }

    let child;
    try {
      child = this.spawnImpl(core.executable, ['run', '-c', configPath], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: path.dirname(core.executable),
      });
    } catch (error) {
      await fs.rm(configPath, { force: true }).catch(() => {});
      throw new Error(`无法启动 sing-box：${error.message || error}`);
    }
    const session = {
      sessionId: crypto.randomUUID(),
      trafficEndpoint,
      trafficMonitor: null,
      node: structuredClone(node),
      proxyPort: port,
      configPath,
      child,
      coreVersion: core.version,
      status: 'starting',
      startedAt: null,
      stopping: false,
      exitCode: null,
      lastError: null,
      logs: [],
      exitPromise: null,
    };
    this.session = session;
    this._emit();

    const appendLog = (source, chunk) => {
      const lines = chunk.toString('utf8').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        session.logs.push(`[${source}] ${line.slice(0, 500)}`);
        if (session.logs.length > 120) session.logs.splice(0, session.logs.length - 120);
      }
      this._emit();
    };
    child.stdout?.on('data', (chunk) => appendLog('out', chunk));
    child.stderr?.on('data', (chunk) => appendLog('err', chunk));
    session.exitPromise = new Promise((resolve) => {
      let completed = false;
      const finishExit = (code, signal) => {
        if (completed) return;
        completed = true;
        session.exitCode = Number.isInteger(code) ? code : -1;
        session.exitSignal = signal || null;
        resolve({ code: session.exitCode, signal: session.exitSignal });
      };
      child.once('exit', finishExit);
      // `close` also fires for spawn failures where `exit` may not fire.
      child.once('close', finishExit);
    });
    child.once('error', (error) => {
      session.lastError = `无法启动 sing-box：${error.message}`;
      session.status = 'error';
      this._emit();
    });
    child.once('close', async (code, signal) => {
      if (!session.stopping && session.status !== 'error') {
        session.status = 'error';
        session.lastError = `sing-box 意外退出（代码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）`;
      } else if (session.stopping) {
        session.status = 'disconnected';
      }
      await this._stopTrafficMonitor(session).catch(() => {});
      await fs.rm(configPath, { force: true }).catch(() => {});
      if (this.session === session) this._emit();
    });

    try {
      const ready = await this._waitForProxy(session, 15000);
      if (!ready) throw new Error(`sing-box 已启动，但本地代理端口 ${port} 未能在 15 秒内监听。${session.logs.slice(-8).join('\n')}`);
      session.status = 'connected';
      session.startedAt = new Date().toISOString();
      this._startTrafficMonitor(session);
      this._emit();
      return this.getStatus();
    } catch (error) {
      session.lastError = String(error.message || error);
      await this._stopTrafficMonitor(session).catch(() => {});
      session.stopping = true;
      try { child.kill('SIGTERM'); } catch { /* Process may have exited. */ }
      await Promise.race([session.exitPromise, delay(4000)]);
      if (session.exitCode === null) {
        try { child.kill('SIGKILL'); } catch { /* Process may have exited. */ }
      }
      await fs.rm(configPath, { force: true }).catch(() => {});
      if (this.session === session) this.session = null;
      this.lastStatus = { status: 'error', connected: false, nodeId: node.id, nodeName: node.name, lastError: session.lastError, logs: [...session.logs] };
      this._emit();
      throw error;
    }
  }

  _startTrafficMonitor(session) {
    if (!session || session.trafficMonitor) return;
    try {
      session.trafficMonitor = new TrafficMonitor({
        endpoint: session.trafficEndpoint,
        sessionId: session.sessionId,
        mode: 'proxy',
        nodeId: session.node.id,
        nodeName: session.node.name,
        startedAt: session.startedAt,
        onSample: this.onTraffic,
      });
      session.trafficMonitor.start();
    } catch (error) {
      // Telemetry is best-effort; it must never tear down a healthy proxy.
      try { this.onTraffic({ sessionId: session.sessionId, mode: 'proxy', nodeId: session.node.id, status: 'unavailable', error: String(error.message || error), uploadBytes: 0, downloadBytes: 0, totalBytes: 0, uploadBps: 0, downloadBps: 0, final: false }); } catch { /* Ignore renderer delivery failures. */ }
    }
  }

  async _stopTrafficMonitor(session) {
    const monitor = session?.trafficMonitor;
    if (!monitor) return;
    session.trafficMonitor = null;
    await monitor.stop({ pollFinal: true });
  }

  async _waitForProxy(session, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (session.exitCode !== null || session.status === 'error') return false;
      if (await probeSocks5('127.0.0.1', session.proxyPort, 900)) {
        // Confirm a real SOCKS5 greeting instead of trusting an unrelated process
        // that could have won the small ephemeral-port race.
        if (session.exitCode === null && session.status !== 'error') return true;
      }
      await delay(180);
    }
    return false;
  }

  async disconnect() {
    if (this.stopPromise) return this.stopPromise;
    // If the UI/app closes during the async preflight or sing-box startup window,
    // wait for that start attempt and then stop it. This prevents a late child leak.
    this.stopPromise = (async () => {
      if (this.startPromise) await this.startPromise.catch(() => {});
      return this._disconnect();
    })().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  async _disconnect() {
    const session = this.session;
    if (!session) return this.getStatus();
    session.stopping = true;
    session.status = 'stopping';
    await this._stopTrafficMonitor(session).catch(() => {});
    this._emit();
    if (session.exitCode === null) {
      try { session.child.kill('SIGTERM'); } catch { /* Process may already have exited. */ }
      const exited = await Promise.race([session.exitPromise.then(() => true), delay(5000).then(() => false)]);
      if (!exited && session.exitCode === null) {
        try { session.child.kill('SIGKILL'); } catch { /* Process may already have exited. */ }
        await Promise.race([session.exitPromise, delay(2000)]);
      }
    }
    await fs.rm(session.configPath, { force: true }).catch(() => {});
    if (this.session === session) this.session = null;
    this.lastStatus = { status: 'disconnected', connected: false, lastError: null, logs: [...session.logs] };
    this._emit();
    return this.getStatus();
  }
}

module.exports = { CoreController, findAvailablePort, runCapture };
