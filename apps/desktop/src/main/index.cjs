'use strict';

const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { parseShareText } = require('../../../../src/shared/node-parser.cjs');
const { mergeNodes, removeSource, replaceSourceNodes } = require('../../../../src/shared/node-registry.cjs');
const { CoreController } = require('../../../../src/shared/core-controller.cjs');
const { downloadSpeedTest } = require('../../../../src/shared/socks-speed-test.cjs');
const { parseCustomRuleText } = require('../../../../src/shared/tun-config.cjs');
const { TunController } = require('../../../../src/shared/tun-controller.cjs');
const { getSstapRuleLibrary, updateSstapRuleLibrary } = require('../../../../src/shared/sstap-rule-library.cjs');
const { version: APP_VERSION } = require('../../../../package.json');

const MAX_SUBSCRIPTION_BYTES = 4 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;
const USER_AGENT = `SSTapNext/${APP_VERSION}`;
const NODE_TYPES = new Set(['vless', 'hysteria2', 'shadowsocks', 'vmess', 'trojan']);
const DEFAULT_SPEED_TEST_URL = 'https://fsn1-speed.hetzner.com/1GB.bin';
const LEGACY_CLOUDFLARE_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=100000000';
const SPEED_TEST_FALLBACK_URLS = [
  'https://ash-speed.hetzner.com/1GB.bin',
  'https://bom.proof.ovh.net/files/1Gb.dat',
  'https://speedtest.tele2.net/1GB.zip',
  'https://nbg1-speed.hetzner.com/1GB.bin',
];

let mainWindow;
let stateCache;
let saveQueue = Promise.resolve();
let mutationQueue = Promise.resolve();
let coreController;
let tunController;
let speedTestRunning = false;
let speedTestAbortController = null;
let quitAfterCoreStop = false;
let appIsQuitting = false;

function serializeMutation(operation) {
  const result = mutationQueue.catch(() => {}).then(async () => {
    const snapshot = structuredClone(await loadState());
    try {
      return await operation();
    } catch (error) {
      // A failed disk write or validation must not leave uncommitted state in memory.
      stateCache = snapshot;
      throw error;
    }
  });
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function defaultState() {
  return {
    schemaVersion: 1,
    nodes: [],
    subscriptions: [],
    speedResults: [],
    settings: {
      mode: 'global',
      speedTestUrl: DEFAULT_SPEED_TEST_URL,
      speedTestBytes: 100000000,
      speedTestThreads: 1,
      dnsStrategy: 'ipv4_only',
      autoRefreshHours: 12,
      customRulesText: '',
      enabledRuleIds: [],
    },
    updatedAt: new Date().toISOString(),
  };
}

function statePath() {
  return path.join(app.getPath('userData'), 'state.enc.json');
}

async function loadState() {
  if (stateCache) return stateCache;
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储不可用；为保护节点凭据，暂不读取已保存数据。');
  }
  try {
    const raw = await fs.readFile(statePath(), 'utf8');
    const envelope = JSON.parse(raw);
    if (envelope.schemaVersion !== 1 || typeof envelope.payload !== 'string') {
      throw new Error('无法识别的数据文件版本');
    }
    const plain = safeStorage.decryptString(Buffer.from(envelope.payload, 'base64'));
    const parsed = JSON.parse(plain);
    stateCache = validateState(parsed);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      stateCache = defaultState();
      return stateCache;
    }
    const file = statePath();
    try {
      await fs.rename(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // The original file may not exist or may be locked. Keep the app usable.
    }
    stateCache = defaultState();
    stateCache.recoveryNotice = `本地数据读取失败，已建立空白数据集：${String(error.message || error)}`;
  }
  return stateCache;
}

function validateState(value) {
  const defaults = defaultState();
  if (!value || typeof value !== 'object') return defaults;
  const settings = value.settings && typeof value.settings === 'object' ? value.settings : {};
  const modes = new Set(['global', 'bypass-cn', 'rule']);
  const mode = modes.has(settings.mode) ? settings.mode : defaults.settings.mode;
  const storedSpeedUrl = typeof settings.speedTestUrl === 'string' ? settings.speedTestUrl.slice(0, 2048) : defaults.settings.speedTestUrl;
  // Migrate the former Cloudflare default. A custom URL remains untouched.
  const url = storedSpeedUrl === LEGACY_CLOUDFLARE_SPEED_URL ? DEFAULT_SPEED_TEST_URL : storedSpeedUrl;
  const bytes = Number.isFinite(settings.speedTestBytes) ? Math.min(Math.max(Math.floor(settings.speedTestBytes), 1_000_000), 1_000_000_000) : defaults.settings.speedTestBytes;
  const requestedThreads = Number(settings.speedTestThreads);
  const threads = [1, 2, 4, 8].includes(requestedThreads) ? requestedThreads : 1;
  const refreshHours = Number.isFinite(settings.autoRefreshHours) ? Math.min(Math.max(Math.floor(settings.autoRefreshHours), 1), 168) : 12;
  const customRulesText = typeof settings.customRulesText === 'string' ? settings.customRulesText.slice(0, 32 * 1024) : '';
  const enabledRuleIds = Array.isArray(settings.enabledRuleIds)
    ? [...new Set(settings.enabledRuleIds.filter((id) => typeof id === 'string' && /^sstap-[a-f0-9]{16}$/.test(id)).slice(0, 190))]
    : [];
  const dnsStrategy = ['ipv4_only', 'prefer_ipv4', 'prefer_ipv6'].includes(settings.dnsStrategy) ? settings.dnsStrategy : defaults.settings.dnsStrategy;
  return {
    schemaVersion: 1,
    nodes: Array.isArray(value.nodes) ? value.nodes.filter(isNodeRecord) : [],
    subscriptions: Array.isArray(value.subscriptions) ? value.subscriptions.filter(isSubscriptionRecord) : [],
    speedResults: Array.isArray(value.speedResults) ? value.speedResults.filter(isSpeedResult).slice(0, 50) : [],
    settings: { mode, speedTestUrl: url, speedTestBytes: bytes, speedTestThreads: threads, dnsStrategy, autoRefreshHours: refreshHours, customRulesText, enabledRuleIds },
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
    ...(typeof value.recoveryNotice === 'string' ? { recoveryNotice: value.recoveryNotice } : {}),
  };
}

function isNodeRecord(item) {
  return Boolean(item
    && typeof item.id === 'string' && item.id.length > 0 && item.id.length <= 128
    && NODE_TYPES.has(item.type)
    && typeof item.server === 'string' && item.server.trim().length > 0 && item.server.length <= 253
    && Number.isInteger(item.server_port) && item.server_port >= 1 && item.server_port <= 65535);
}

function isSubscriptionRecord(item) {
  if (!item || typeof item.id !== 'string' || !item.id || typeof item.url !== 'string' || item.url.length > 2048 || typeof item.name !== 'string') return false;
  try {
    const url = new URL(item.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isSpeedResult(item) {
  return Boolean(item && typeof item.testedAt === 'string'
    && Number.isFinite(item.averageMbps) && Number.isFinite(item.peakMbps)
    && Number.isFinite(item.latencyMs) && Number.isFinite(item.bytes)
    && Number.isInteger(item.threads) && typeof item.nodeId === 'string'
    && typeof item.nodeName === 'string');
}

function findSingBoxExecutable() {
  const candidates = [
    process.env.SSTAP_SING_BOX,
    path.join(process.resourcesPath || '', 'sing-box', 'sing-box.exe'),
    path.join(process.resourcesPath || '', 'runtime', 'sing-box', 'sing-box.exe'),
    path.join(app.getAppPath(), 'runtime', 'sing-box', 'sing-box.exe'),
    path.join(__dirname, '../../../../runtime/sing-box/sing-box.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SSTap Next', 'runtime', 'sing-box', 'sing-box.exe'),
  ].filter((value) => typeof value === 'string' && value.trim());
  return candidates.map((value) => path.resolve(value)).find((value) => fsSync.existsSync(value)) || null;
}

function findTunSingBoxExecutable() {
  const candidates = [
    path.join(process.resourcesPath || '', 'sing-box', 'sing-box.exe'),
    path.join(process.resourcesPath || '', 'runtime', 'sing-box', 'sing-box.exe'),
    path.join(app.getAppPath(), 'runtime', 'sing-box', 'sing-box.exe'),
    path.join(__dirname, '../../../../runtime/sing-box/sing-box.exe'),
    path.join(process.env.ProgramFiles || 'C:\\Program Files', 'SSTap Next', 'runtime', 'sing-box', 'sing-box.exe'),
  ];
  return candidates.map((value) => path.resolve(value)).find((value) => fsSync.existsSync(value)) || null;
}

function findTunAgentExecutable() {
  const candidates = [
    path.join(process.resourcesPath || '', 'agent', 'SstapNext.Agent.exe'),
    path.join(app.getAppPath(), 'artifacts', 'agent-win-x64', 'SstapNext.Agent.exe'),
    path.join(__dirname, '../../../../artifacts/agent-win-x64/SstapNext.Agent.exe'),
  ];
  return candidates.map((value) => path.resolve(value)).find((value) => fsSync.existsSync(value)) || null;
}

function findTunLauncherScript() {
  const candidates = [
    path.join(process.resourcesPath || '', 'scripts', 'Start-Tun-Agent.ps1'),
    path.join(app.getAppPath(), 'scripts', 'Start-Tun-Agent.ps1'),
    path.join(__dirname, '../../../../scripts/Start-Tun-Agent.ps1'),
  ];
  return candidates.map((value) => path.resolve(value)).find((value) => fsSync.existsSync(value)) || null;
}

function getTunController() {
  if (!tunController) {
    tunController = new TunController({
      getAgentPath: findTunAgentExecutable,
      getCorePath: findTunSingBoxExecutable,
      getLauncherPath: findTunLauncherScript,
      getUserDataPath: () => app.getPath('userData'),
      onEvent: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sstap:tun-event', status);
      },
    });
  }
  return tunController;
}

function isTunNetworkStateUnsafe(status) {
  return Boolean(status && !['disconnected', 'stopped', 'stopped_with_warning', 'error'].includes(status.status));
}

function getCoreController() {
  if (!coreController) {
    coreController = new CoreController({
      getCorePath: findSingBoxExecutable,
      getUserDataPath: () => app.getPath('userData'),
      onEvent: (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sstap:core-event', status);
      },
    });
  }
  return coreController;
}

function sendSpeedProgress(progress) {
  const payload = { status: 'running', ...progress };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('sstap:speed-progress', payload);
}

async function persistState() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    const state = await loadState();
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows 安全存储不可用；为保护节点密码，本程序不会降级为明文保存。');
    }
    const payload = safeStorage.encryptString(JSON.stringify({ ...state, updatedAt: new Date().toISOString() })).toString('base64');
    const envelope = JSON.stringify({ schemaVersion: 1, payload });
    const file = statePath();
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.writeFile(temp, envelope, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temp, file);
    } finally {
      try { await fs.unlink(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
  return saveQueue;
}

function parseBoundedText(raw) {
  if (typeof raw !== 'string') throw new Error('导入内容必须是文本');
  if (Buffer.byteLength(raw, 'utf8') > MAX_SUBSCRIPTION_BYTES) throw new Error('导入内容超过 4 MB 上限');
  const result = parseShareText(raw);
  if (!result.nodes.length && !result.errors.length) throw new Error('没有识别到可导入的节点链接');
  return result;
}

async function readResponseBodyLimited(response, maximumBytes) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        throw new Error(`订阅内容超过 ${Math.round(maximumBytes / 1024 / 1024)} MB 上限`);
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, total));
}

async function fetchSubscription(urlString) {
  if (typeof urlString !== 'string' || urlString.length > 2048) throw new Error('订阅地址不能为空且不能超过 2048 个字符');
  let url;
  try { url = new URL(urlString.trim()); } catch { throw new Error('订阅地址不是有效 URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('订阅地址仅允许 HTTP 或 HTTPS');
  if (url.username || url.password) throw new Error('请勿把账号密码嵌入订阅 URL');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/plain, application/json, */*' },
    });
    if (!response.ok) throw new Error(`订阅服务器返回 HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (!['http:', 'https:'].includes(finalUrl.protocol) || (url.protocol === 'https:' && finalUrl.protocol !== 'https:')) {
      throw new Error('订阅重定向目标不安全（不允许 HTTPS 降级）');
    }
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_SUBSCRIPTION_BYTES) throw new Error('订阅内容超过 4 MB 上限');
    return await readResponseBodyLimited(response, MAX_SUBSCRIPTION_BYTES);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('订阅下载超时（20 秒）');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function addSubscription(url, name) {
  const normalizedUrl = new URL(String(url).trim()).toString();
  const state = await loadState();
  if (state.subscriptions.some((item) => item.url === normalizedUrl)) throw new Error('这个订阅地址已经存在');
  const body = await fetchSubscription(normalizedUrl);
  const parsed = parseBoundedText(body);
  if (parsed.nodes.length === 0) {
    const detail = parsed.errors.slice(0, 3).map((item) => item.message).join('；');
    throw new Error(`订阅下载成功，但没有解析出节点。${detail}`);
  }
  const id = crypto.randomUUID();
  const merged = mergeNodes(state.nodes, parsed.nodes, `subscription:${id}`);
  state.nodes = merged.nodes;
  state.subscriptions.push({
    id,
    name: (name || new URL(normalizedUrl).hostname).trim().slice(0, 80),
    url: normalizedUrl,
    nodeCount: parsed.nodes.length,
    updatedAt: new Date().toISOString(),
    lastError: null,
  });
  await persistState();
  return { ...state, importSummary: { added: merged.added, updated: merged.updated, failed: parsed.errors.length }, errors: parsed.errors };
}

async function refreshSubscription(id) {
  const state = await loadState();
  const subscription = state.subscriptions.find((item) => item.id === id);
  if (!subscription) throw new Error('找不到该订阅');
  try {
    const body = await fetchSubscription(subscription.url);
    const parsed = parseBoundedText(body);
    // Atomic sync: a partially understood subscription must not delete old nodes.
    const source = `subscription:${subscription.id}`;
    const merged = replaceSourceNodes(state.nodes, parsed.nodes, source, parsed.errors);
    if (merged.preserved) {
      subscription.lastError = `本次有 ${parsed.errors.length} 条内容未能识别；为避免丢失节点，整批更新未应用`;
      await persistState();
      return {
        ...state,
        refreshPreserved: true,
        refreshError: subscription.lastError,
        importSummary: { added: 0, updated: 0, failed: parsed.errors.length },
        errors: parsed.errors,
      };
    }
    state.nodes = merged.nodes;
    subscription.nodeCount = parsed.nodes.length;
    subscription.updatedAt = new Date().toISOString();
    subscription.lastError = null;
    await persistState();
    return { ...state, importSummary: { added: merged.added, updated: merged.updated, failed: parsed.errors.length }, errors: parsed.errors };
  } catch (error) {
    subscription.lastError = String(error.message || error).slice(0, 500);
    await persistState();
    return { ...state, refreshPreserved: true, refreshError: subscription.lastError };
  }
}

async function removeSubscription(id) {
  const state = await loadState();
  const index = state.subscriptions.findIndex((item) => item.id === id);
  if (index < 0) throw new Error('找不到该订阅');
  state.nodes = removeSource(state.nodes, `subscription:${id}`);
  state.subscriptions.splice(index, 1);
  await persistState();
  return state;
}

function expectedRendererUrl() {
  if (app.isPackaged) return pathToFileURL(path.join(__dirname, '../../../../dist/renderer/index.html')).href;
  return new URL(process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173').origin;
}

function assertTrustedRenderer(event) {
  const frameUrl = event.senderFrame?.url;
  if (!frameUrl) throw new Error('拒绝来自未知 renderer 的 IPC 请求');
  if (app.isPackaged) {
    if (frameUrl !== expectedRendererUrl()) throw new Error('拒绝来自非本地页面的 IPC 请求');
    return;
  }
  let origin;
  try { origin = new URL(frameUrl).origin; } catch { throw new Error('拒绝来自无效页面的 IPC 请求'); }
  if (origin !== expectedRendererUrl()) throw new Error('拒绝来自非开发服务器页面的 IPC 请求');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    backgroundColor: '#0c111b',
    title: 'SSTap Next',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://127.0.0.1:5173';
    mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../../../dist/renderer/index.html'));
  }

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const expected = expectedRendererUrl();
    const allowed = app.isPackaged ? url === expected : (() => { try { return new URL(url).origin === expected; } catch { return false; } })();
    if (!allowed) event.preventDefault();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}


ipcMain.handle('sstap:rule-library-get', async (event) => {
  assertTrustedRenderer(event);
  return getSstapRuleLibrary(app.getPath('userData'));
});
ipcMain.handle('sstap:rule-library-update', async (event) => {
  assertTrustedRenderer(event);
  const tunStatus = getTunController().getStatus();
  if (['requested', 'awaiting_uac', 'starting', 'running', 'stopping'].includes(tunStatus.status)) {
    throw new Error('请先断开系统 TUN，再更新 SSTap 规则库；避免运行中的路由读取到版本切换。');
  }
  return serializeMutation(async () => {
    const result = await updateSstapRuleLibrary(app.getPath('userData'));
    const state = await loadState();
    const installed = new Set(result.rules.map((item) => item.id));
    const selected = state.settings.enabledRuleIds || [];
    const kept = selected.filter((id) => installed.has(id));
    if (kept.length !== selected.length) {
      state.settings.enabledRuleIds = kept;
      await persistState();
    }
    return result;
  });
});

ipcMain.handle('sstap:get-state', async (event) => {
  assertTrustedRenderer(event);
  await mutationQueue.catch(() => {});
  return structuredClone(await loadState());
});
ipcMain.handle('sstap:import-text', async (event, text) => {
  assertTrustedRenderer(event);
  return serializeMutation(async () => {
    const parsed = parseBoundedText(text);
    const state = await loadState();
    const merged = mergeNodes(state.nodes, parsed.nodes, 'clipboard');
    state.nodes = merged.nodes;
    await persistState();
    return { ...state, importSummary: { added: merged.added, updated: merged.updated, failed: parsed.errors.length }, errors: parsed.errors };
  });
});
ipcMain.handle('sstap:subscription-add', async (event, url, name) => {
  assertTrustedRenderer(event);
  return serializeMutation(() => addSubscription(String(url || ''), String(name || '')));
});
ipcMain.handle('sstap:subscription-refresh', async (event, id) => {
  assertTrustedRenderer(event);
  return serializeMutation(() => refreshSubscription(String(id || '')));
});
ipcMain.handle('sstap:subscription-delete', async (event, id) => {
  assertTrustedRenderer(event);
  return serializeMutation(() => removeSubscription(String(id || '')));
});
ipcMain.handle('sstap:settings-save', async (event, patch) => {
  assertTrustedRenderer(event);
  return serializeMutation(async () => {
  if (!patch || typeof patch !== 'object') throw new Error('设置数据无效');
  const state = await loadState();
  const modes = new Set(['global', 'bypass-cn', 'rule']);
  if (patch.mode !== undefined && !modes.has(patch.mode)) throw new Error('代理模式无效');
  if (patch.speedTestUrl !== undefined) {
    const rawUrl = String(patch.speedTestUrl).trim();
    if (!rawUrl || rawUrl.length > 2048) throw new Error('测速地址不能为空且不能超过 2048 个字符');
    const testUrl = new URL(rawUrl);
    if (!['https:', 'http:'].includes(testUrl.protocol) || testUrl.username || testUrl.password) throw new Error('测速地址必须是无账号密码的 HTTP/HTTPS URL');
    state.settings.speedTestUrl = testUrl.toString();
  }
  if (patch.speedTestBytes !== undefined) {
    const bytes = Number(patch.speedTestBytes);
    if (!Number.isSafeInteger(bytes) || bytes < 1_000_000 || bytes > 1_000_000_000) throw new Error('测速字节数必须在 1 MB 至 1 GB 之间');
    state.settings.speedTestBytes = bytes;
  }
  if (patch.dnsStrategy !== undefined) {
    if (!['ipv4_only', 'prefer_ipv4', 'prefer_ipv6'].includes(patch.dnsStrategy)) throw new Error('DNS 地址族策略无效');
    const tunStatus = tunController?.getStatus();
    if (tunStatus && ['awaiting_uac', 'starting', 'running', 'stopping'].includes(tunStatus.status)) {
      throw new Error('请先断开系统 TUN，再修改 DNS 地址族策略。');
    }
    state.settings.dnsStrategy = patch.dnsStrategy;
  }
  if (patch.speedTestThreads !== undefined) {
    const threads = Number(patch.speedTestThreads);
    if (!Number.isInteger(threads) || ![1, 2, 4, 8].includes(threads)) throw new Error('线程数只允许 1、2、4 或 8');
    state.settings.speedTestThreads = threads;
  }
  if (patch.autoRefreshHours !== undefined) {
    const hours = Number(patch.autoRefreshHours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('订阅刷新间隔必须在 1 至 168 小时之间');
    state.settings.autoRefreshHours = hours;
  }
  if (patch.customRulesText !== undefined) {
    const text = String(patch.customRulesText);
    const parsed = parseCustomRuleText(text);
    if (parsed.errors.length) throw new Error(`自定义规则格式错误：${parsed.errors.slice(0, 8).map((item) => `第 ${item.line} 行 ${item.message}`).join('；')}`);
    state.settings.customRulesText = text;
  }

  if (patch.enabledRuleIds !== undefined) {
    const tunStatus = getTunController().getStatus();
    if (['requested', 'awaiting_uac', 'starting', 'running', 'stopping'].includes(tunStatus.status)) {
      throw new Error('请先断开系统 TUN，再修改已启用的 SSTap 游戏规则。');
    }
    if (!Array.isArray(patch.enabledRuleIds) || patch.enabledRuleIds.length > 190
      || patch.enabledRuleIds.some((id) => typeof id !== 'string' || !/^sstap-[a-f0-9]{16}$/.test(id))) {
      throw new Error('SSTap 规则选择数据无效');
    }
    const library = await getSstapRuleLibrary(app.getPath('userData'));
    const installed = new Set(library.rules.map((item) => item.id));
    const unique = [...new Set(patch.enabledRuleIds)];
    const missing = unique.filter((id) => !installed.has(id));
    if (missing.length) throw new Error('部分选择的 SSTap 规则不在当前规则库中；请先刷新规则列表。');
    state.settings.enabledRuleIds = unique;
  }

  if (patch.mode !== undefined) state.settings.mode = patch.mode;
  await persistState();
  return state;
  });
});
ipcMain.handle('sstap:node-delete', async (event, id) => {
  assertTrustedRenderer(event);
  const tunStatus = tunController?.getStatus();
  if (tunStatus?.nodeId === String(id || '') && ['requested', 'awaiting_uac', 'starting', 'running', 'stopping', 'cleanup_error'].includes(tunStatus.status)) {
    throw new Error('该节点正在被系统 TUN 使用，请先断开系统代理，再删除节点。');
  }
  const coreStatus = coreController?.getStatus();
  if (coreStatus?.nodeId === String(id || '') && ['starting', 'connected', 'stopping'].includes(coreStatus.status)) {
    throw new Error('该节点正在启动或连接中，请先断开代理，再删除节点。');
  }
  return serializeMutation(async () => {
    const state = await loadState();
    state.nodes = state.nodes.filter((node) => node.id !== id);
    await persistState();
    return state;
  });
});

ipcMain.handle('sstap:core-check', async (event) => {
  assertTrustedRenderer(event);
  return getCoreController().checkCore();
});
ipcMain.handle('sstap:core-status', async (event) => {
  assertTrustedRenderer(event);
  return getCoreController().getStatus();
});
ipcMain.handle('sstap:core-open-folder', async (event) => {
  assertTrustedRenderer(event);
  const executable = findSingBoxExecutable();
  if (!executable) throw new Error('尚未找到 sing-box.exe，无法打开内核目录。');
  const directory = path.dirname(executable);
  const openError = await shell.openPath(directory);
  if (openError) throw new Error(`无法打开内核目录：${openError}`);
  return directory;
});
ipcMain.handle('sstap:core-connect', async (event, nodeId) => {
  assertTrustedRenderer(event);
  if (appIsQuitting) throw new Error('软件正在退出，已阻止新的连接请求。');
  const tunStatus = getTunController().getStatus();
  if (isTunNetworkStateUnsafe(tunStatus)) throw new Error('系统 TUN 正在运行或尚未完成清理。请先安全断开系统代理，再连接本地代理。');
  if (speedTestRunning) throw new Error('测速正在运行，请等测速结束后再切换连接。');
  const state = await loadState();
  const node = state.nodes.find((item) => item.id === String(nodeId || ''));
  if (!node) throw new Error('找不到所选节点，请重新选择。');
  return getCoreController().connect(node);
});
ipcMain.handle('sstap:core-disconnect', async (event) => {
  assertTrustedRenderer(event);
  if (speedTestRunning) throw new Error('测速正在运行，不能中途断开核心。');
  return getCoreController().disconnect();
});
ipcMain.handle('sstap:tun-status', async (event) => {
  assertTrustedRenderer(event);
  return getTunController().getStatus();
});
ipcMain.handle('sstap:tun-connect', async (event, nodeId) => {
  assertTrustedRenderer(event);
  if (appIsQuitting) throw new Error('软件正在退出，已阻止新的系统代理连接。');
  if (speedTestRunning) throw new Error('测速正在运行，请等测速结束后再启动系统代理。');
  const localStatus = getCoreController().getStatus();
  if (['connected', 'starting', 'stopping'].includes(localStatus.status)) throw new Error('本地代理核心正在运行。请先断开本地代理，再启动系统 TUN，避免两个会话同时争用网络。');
  const state = await loadState();
  const node = state.nodes.find((item) => item.id === String(nodeId || ''));
  if (!node) throw new Error('找不到所选节点，请重新选择。');
  return getTunController().connect(node, state.settings);
});
ipcMain.handle('sstap:tun-disconnect', async (event) => {
  assertTrustedRenderer(event);
  if (speedTestRunning) throw new Error('测速正在运行，请等测速结束后再断开系统代理。');
  return getTunController().disconnect();
});

ipcMain.handle('sstap:speed-cancel', async (event) => {
  assertTrustedRenderer(event);
  if (!speedTestRunning || !speedTestAbortController) return false;
  speedTestAbortController.abort();
  return true;
});
ipcMain.handle('sstap:speed-test', async (event, nodeId) => {
  assertTrustedRenderer(event);
  if (appIsQuitting) throw new Error('软件正在退出，已阻止新的测速请求。');
  const tunStatus = getTunController().getStatus();
  if (isTunNetworkStateUnsafe(tunStatus)) throw new Error('系统 TUN 正在接管流量或尚未完成清理；请先安全断开系统代理，再执行独立节点测速。');
  if (speedTestRunning) throw new Error('当前已有测速任务正在运行。');
  speedTestRunning = true;
  speedTestAbortController = new AbortController();
  sendSpeedProgress({ status: 'starting', receivedBytes: 0, totalBytes: 0, ratio: 0 });
  let temporaryConnection = false;
  try {
    const state = await loadState();
    const node = state.nodes.find((item) => item.id === String(nodeId || ''));
    if (!node) throw new Error('找不到所选节点，请重新选择。');
    if (appIsQuitting || speedTestAbortController.signal.aborted) throw new Error('测速已取消');

    let status = getCoreController().getStatus();
    if (status.status === 'connected' && status.nodeId !== node.id) {
      throw new Error('当前已连接其他节点。请先断开连接，再测试所选节点。');
    }
    if (status.status !== 'connected') {
      status = await getCoreController().connect(node);
      temporaryConnection = true;
    }

    sendSpeedProgress({ status: 'running', receivedBytes: 0, totalBytes: state.settings.speedTestBytes, ratio: 0 });
    const result = await downloadSpeedTest({
      url: state.settings.speedTestUrl,
      fallbackUrls: SPEED_TEST_FALLBACK_URLS,
      totalBytes: state.settings.speedTestBytes,
      threads: state.settings.speedTestThreads,
      proxyHost: status.proxyHost || '127.0.0.1',
      proxyPort: status.proxyPort,
      timeoutMs: 90000,
      signal: speedTestAbortController.signal,
      onProgress: sendSpeedProgress,
    });
    const saved = await serializeMutation(async () => {
      const latest = await loadState();
      const record = { ...result, nodeId: node.id, nodeName: node.name, server: node.server, serverPort: node.server_port };
      latest.speedResults = [record, ...(latest.speedResults || [])].slice(0, 50);
      await persistState();
      return { state: structuredClone(latest), result: record };
    });
    sendSpeedProgress({ status: 'completed', receivedBytes: result.bytes, totalBytes: result.bytes, ratio: 1 });
    return saved;
  } catch (error) {
    const cancelled = Boolean(speedTestAbortController?.signal.aborted);
    sendSpeedProgress({ status: cancelled ? 'cancelled' : 'error', message: cancelled ? '测速已取消' : String(error.message || error) });
    if (cancelled) throw new Error('测速已取消');
    throw error;
  } finally {
    if (temporaryConnection) {
      try { await getCoreController().disconnect(); } catch { /* Keep the primary speed-test result/error. */ }
    }
    speedTestRunning = false;
    speedTestAbortController = null;
  }
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });
  app.whenReady().then(async () => {
    try { await loadState(); } catch (error) { console.error('[SSTap Next] 本地状态初始化失败：', error); }
    try { await getTunController().recoverStaleSessions(); } catch (error) { console.error('[SSTap Next] 遗留 TUN 恢复检查失败：', error); }
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}

app.on('before-quit', (event) => {
  if (quitAfterCoreStop) return;
  appIsQuitting = true;
  // A running speed test must not keep opening new proxy requests while the app exits.
  if (speedTestAbortController) speedTestAbortController.abort();
  const localStatus = coreController?.getStatus();
  const tunStatus = tunController?.getStatus();
  const localNeedsStop = localStatus && ['connected', 'starting', 'stopping'].includes(localStatus.status);
  const tunNeedsStop = tunStatus && !['disconnected', 'stopped', 'stopped_with_warning'].includes(tunStatus.status);
  if (localNeedsStop || tunNeedsStop) {
    event.preventDefault();
    quitAfterCoreStop = true;
    Promise.allSettled([
      localNeedsStop ? coreController.disconnect() : Promise.resolve(),
      tunNeedsStop ? tunController.disconnect() : Promise.resolve(),
    ]).then((results) => {
      for (const result of results) if (result.status === 'rejected') console.error('[SSTap Next] 网络会话退出清理失败：', result.reason);
    }).finally(() => app.quit());
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
