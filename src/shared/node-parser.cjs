'use strict';

const crypto = require('node:crypto');

const SUPPORTED_SCHEMES = ['vless://', 'vmess://', 'hy2://', 'hysteria2://', 'ss://', 'trojan://'];
const MAX_LINE_LENGTH = 16_384;

function decodeBase64Text(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    if (!decoded || decoded.includes('\uFFFD')) return null;
    return decoded;
  } catch {
    return null;
  }
}

function decodePart(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function getDisplayName(url, fallback) {
  const hash = url.hash ? url.hash.slice(1) : '';
  return (decodePart(hash).trim() || fallback || normalizeHostname(url.hostname) || 'Unnamed node').slice(0, 100);
}

function normalizeHostname(hostname) {
  const value = String(hostname || '').trim();
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function getServerAndPort(url, protocolName, defaultPort = null) {
  const server = normalizeHostname(url.hostname);
  const portText = url.port || (defaultPort === null ? '' : String(defaultPort));
  const serverPort = Number(portText);
  if (!server || !portText || !Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error(`${protocolName} 服务器地址或端口无效`);
  }
  return { server, server_port: serverPort };
}

function boolQuery(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function parseVless(line) {
  const url = new URL(line);
  const endpoint = getServerAndPort(url, 'VLESS');
  const q = url.searchParams;
  const security = (q.get('security') || 'none').toLowerCase();
  const serverName = q.get('sni') || q.get('servername') || q.get('peer') || endpoint.server;
  const node = {
    id: crypto.randomUUID(),
    type: 'vless',
    name: getDisplayName(url, 'VLESS'),
    ...endpoint,
    uuid: decodePart(url.username),
    flow: q.get('flow') || undefined,
    tls: { enabled: security === 'tls' || security === 'reality', server_name: serverName },
    transport: undefined,
  };
  if (!node.uuid) throw new Error('VLESS 缺少 UUID');
  if (security === 'reality') {
    const publicKey = q.get('pbk') || q.get('publicKey');
    if (!publicKey) throw new Error('VLESS Reality 缺少 public key（pbk）');
    node.tls.reality = {
      enabled: true,
      public_key: publicKey,
      ...(q.get('sid') || q.get('shortId') ? { short_id: q.get('sid') || q.get('shortId') } : {}),
    };
  } else if (security !== 'tls' && security !== 'none' && security !== '') {
    throw new Error(`暂不支持 VLESS security=${security}`);
  }
  if (security === 'reality') {
    // sing-box 1.14 要求 Reality 客户端显式启用 uTLS；未提供 fp 时默认使用最通用的 chrome 指纹。
    node.tls.utls = { enabled: true, fingerprint: q.get('fp') || 'chrome' };
  } else if (q.get('fp')) {
    node.tls.utls = { enabled: true, fingerprint: q.get('fp') };
  }
  if (q.get('alpn')) node.tls.alpn = q.get('alpn').split(',').map((item) => item.trim()).filter(Boolean);
  const network = (q.get('type') || 'tcp').toLowerCase();
  if (network === 'ws') {
    const host = q.get('host');
    node.transport = { type: 'ws', path: q.get('path') || '/', ...(host ? { headers: { Host: host } } : {}) };
  } else if (network === 'grpc') {
    node.transport = { type: 'grpc', service_name: q.get('serviceName') || q.get('service_name') || '' };
  } else if (network === 'httpupgrade') {
    node.transport = { type: 'httpupgrade', path: q.get('path') || '/', ...(q.get('host') ? { host: q.get('host') } : {}) };
  } else if (network !== 'tcp' && network !== 'raw') {
    throw new Error(`暂不支持 VLESS transport=${network}`);
  }
  return node;
}

function parseHysteria2(line) {
  const url = new URL(line.replace(/^hysteria2:/i, 'hy2:'));
  // Hysteria 2 URI scheme specifies TCP/UDP service port 443 when omitted.
  const endpoint = getServerAndPort(url, 'Hysteria2', 443);
  const q = url.searchParams;
  if (q.has('pinSHA256')) throw new Error('当前客户端尚未实现 Hysteria2 pinSHA256 证书指纹导入；为避免降低证书校验，暂不导入该节点');
  if (q.has('ech')) throw new Error('当前版本尚未实现 Hysteria2 ECH 参数导入');
  if (q.has('mport')) throw new Error('当前版本尚未实现 Hysteria2 端口跳跃参数导入');
  const password = decodePart(url.username || url.password);
  if (!password) throw new Error('Hysteria2 缺少密码');
  const node = {
    id: crypto.randomUUID(),
    type: 'hysteria2',
    name: getDisplayName(url, 'Hysteria2'),
    ...endpoint,
    password,
    tls: {
      enabled: true,
      server_name: q.get('sni') || q.get('server_name') || endpoint.server,
      alpn: q.get('alpn') ? q.get('alpn').split(',').map((item) => item.trim()).filter(Boolean) : ['h3'],
      ...(boolQuery(q.get('insecure')) ? { insecure: true } : {}),
    },
  };
  const obfs = q.get('obfs');
  const obfsPassword = q.get('obfs-password') || q.get('obfs_password');
  if (obfs) {
    const obfsType = obfs.toLowerCase();
    if (!['salamander', 'gecko'].includes(obfsType)) throw new Error(`暂不支持 Hysteria2 obfs=${obfs}`);
    if (!obfsPassword) throw new Error(`Hysteria2 ${obfsType} 混淆缺少 obfs-password`);
    node.obfs = { type: obfsType, password: obfsPassword };
  }
  return node;
}

function parseShadowsocks(line) {
  const clean = line.trim();
  const afterScheme = clean.slice(clean.indexOf('://') + 3);
  const hashIndex = afterScheme.indexOf('#');
  const queryIndex = afterScheme.indexOf('?');
  const cut = [hashIndex, queryIndex].filter((n) => n >= 0).reduce((a, b) => Math.min(a, b), afterScheme.length);
  const authorityPart = afterScheme.slice(0, cut);
  let method;
  let password;
  let host;
  let port;
  let name = '';

  // SIP002: ss://base64(method:password)@host:port#name
  if (authorityPart.includes('@')) {
    const parsed = new URL(clean);
    host = normalizeHostname(parsed.hostname);
    port = Number(parsed.port);
    name = getDisplayName(parsed, 'Shadowsocks');
    if (parsed.searchParams.has('plugin')) throw new Error('当前版本不支持带 SIP002 plugin 参数的 Shadowsocks 链接');
    if (parsed.password) {
      method = decodePart(parsed.username);
      password = decodePart(parsed.password);
    } else {
      const decoded = decodeBase64Text(parsed.username);
      if (!decoded || !decoded.includes(':')) throw new Error('Shadowsocks 用户信息不是有效的 Base64(method:password)');
      const split = decoded.indexOf(':');
      method = decoded.slice(0, split);
      password = decoded.slice(split + 1);
    }
  } else {
    // Legacy SIP002 form: ss://base64(method:password@host:port)#name
    const decoded = decodeBase64Text(authorityPart);
    if (!decoded) throw new Error('Shadowsocks 链接无法解码');
    const match = decoded.match(/^([^:]+):(.+)@((?:\[[^\]]+\])|(?:[^:]+)):(\d+)$/);
    if (!match) throw new Error('Shadowsocks 旧格式应为 method:password@host:port');
    [, method, password, host, port] = match;
    host = normalizeHostname(host);
    port = Number(port);
    name = hashIndex >= 0 ? decodePart(afterScheme.slice(hashIndex + 1)) : 'Shadowsocks';
  }

  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Shadowsocks 服务器地址或端口无效');
  if (!method || !password) throw new Error('Shadowsocks 缺少加密方法或密码');
  return {
    id: crypto.randomUUID(),
    type: 'shadowsocks',
    name: (name || 'Shadowsocks').slice(0, 100),
    server: host,
    server_port: port,
    method,
    password,
  };
}

function parseVmess(line) {
  const payload = line.slice('vmess://'.length).split('#')[0];
  const decoded = decodeBase64Text(payload);
  if (!decoded) throw new Error('VMess 分享内容不是有效 Base64');
  let value;
  try { value = JSON.parse(decoded); } catch { throw new Error('VMess Base64 内容不是有效 JSON'); }
  const host = normalizeHostname(String(value.add || value.address || '').trim());
  const port = Number(value.port);
  const uuid = String(value.id || '').trim();
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !uuid) throw new Error('VMess 缺少有效的 add、port 或 id');
  const security = String(value.tls || '').toLowerCase();
  if (security && !['tls', 'true', '1', 'none', 'false', '0'].includes(security)) {
    throw new Error(`暂不支持 VMess TLS 模式 ${security}`);
  }
  const tlsEnabled = security === 'tls' || security === 'true' || security === '1';
  const node = {
    id: crypto.randomUUID(),
    type: 'vmess',
    name: String(value.ps || 'VMess').slice(0, 100),
    server: host,
    server_port: port,
    uuid,
    alter_id: Number.isFinite(Number(value.aid)) ? Number(value.aid) : 0,
    security: String(value.scy || value.security || 'auto'),
    tls: { enabled: tlsEnabled, ...(tlsEnabled ? { server_name: String(value.sni || host) } : {}) },
  };
  if (value.fp) node.tls.utls = { enabled: true, fingerprint: String(value.fp) };
  const network = String(value.net || 'tcp').toLowerCase();
  if (network === 'ws') {
    node.transport = { type: 'ws', path: String(value.path || '/'), ...(value.host ? { headers: { Host: String(value.host) } } : {}) };
  } else if (network === 'grpc') {
    node.transport = { type: 'grpc', service_name: String(value.path || value.serviceName || '') };
  } else if (network !== 'tcp') {
    throw new Error(`暂不支持 VMess 传输方式 ${network}`);
  }
  return node;
}

function parseTrojan(line) {
  const url = new URL(line);
  const endpoint = getServerAndPort(url, 'Trojan');
  if (!url.username) throw new Error('Trojan 缺少密码');
  const q = url.searchParams;
  const serverName = q.get('sni') || q.get('peer') || endpoint.server;
  const node = {
    id: crypto.randomUUID(),
    type: 'trojan',
    name: getDisplayName(url, 'Trojan'),
    ...endpoint,
    password: decodePart(url.username),
    tls: { enabled: true, server_name: serverName, ...(boolQuery(q.get('allowInsecure') || q.get('insecure')) ? { insecure: true } : {}) },
  };
  if (q.get('fp')) node.tls.utls = { enabled: true, fingerprint: q.get('fp') };
  const network = (q.get('type') || 'tcp').toLowerCase();
  if (network === 'ws') {
    node.transport = { type: 'ws', path: q.get('path') || '/', ...(q.get('host') ? { headers: { Host: q.get('host') } } : {}) };
  } else if (network === 'grpc') {
    node.transport = { type: 'grpc', service_name: q.get('serviceName') || '' };
  } else if (network !== 'tcp') {
    throw new Error(`暂不支持 Trojan transport=${network}`);
  }
  return node;
}

function parseOne(line) {
  const value = String(line || '').trim();
  if (!value) return null;
  if (value.length > MAX_LINE_LENGTH) throw new Error('单条链接超过 16 KB');
  const scheme = value.slice(0, value.indexOf('://') + 3).toLowerCase();
  switch (scheme) {
    case 'vless://': return parseVless(value);
    case 'hysteria2://':
    case 'hy2://': return parseHysteria2(value);
    case 'ss://': return parseShadowsocks(value);
    case 'vmess://': return parseVmess(value);
    case 'trojan://': return parseTrojan(value);
    default: throw new Error('暂不支持该分享链接协议');
  }
}

function parseShareText(input) {
  if (typeof input !== 'string') throw new TypeError('导入内容必须是字符串');
  let text = input.replace(/^\uFEFF/, '').trim();
  if (!text) return { nodes: [], errors: [] };
  if (!SUPPORTED_SCHEMES.some((scheme) => text.toLowerCase().includes(scheme))) {
    const decoded = decodeBase64Text(text);
    if (decoded && SUPPORTED_SCHEMES.some((scheme) => decoded.toLowerCase().includes(scheme))) text = decoded.replace(/^\uFEFF/, '').trim();
  }

  const lines = text.split(/\r?\n/);
  const nodes = [];
  const errors = [];
  const seen = new Set();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;
    try {
      const node = parseOne(line);
      if (!node) continue;
      const fingerprint = nodeFingerprint(node);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      nodes.push(node);
    } catch (error) {
      errors.push({ line: index + 1, message: String(error.message || error).slice(0, 300), preview: line.slice(0, 120) });
    }
  }
  return { nodes, errors };
}

function nodeFingerprint(node) {
  const identity = {
    type: node.type,
    server: String(node.server || '').toLowerCase(),
    port: Number(node.server_port || 0),
    uuid: node.uuid || '',
    password: node.password || '',
    method: node.method || '',
    flow: node.flow || '',
    alter_id: node.alter_id ?? null,
    security: node.security || '',
    obfs: node.obfs || null,
    transport: node.transport || null,
    tls: node.tls || null,
  };
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

function buildSingBoxOutbound(node, tag = `node-${node.id || 'selected'}`) {
  const base = { type: node.type, tag, server: node.server, server_port: node.server_port };
  if (node.type === 'vless') {
    base.uuid = node.uuid;
    if (node.flow) base.flow = node.flow;
    if (node.tls?.enabled) base.tls = structuredClone(node.tls);
    if (node.transport) base.transport = structuredClone(node.transport);
  } else if (node.type === 'hysteria2') {
    base.password = node.password;
    base.tls = structuredClone(node.tls || { enabled: true, server_name: node.server });
    if (node.obfs) base.obfs = structuredClone(node.obfs);
  } else if (node.type === 'shadowsocks') {
    base.method = node.method;
    base.password = node.password;
  } else if (node.type === 'vmess') {
    base.uuid = node.uuid;
    base.alter_id = node.alter_id || 0;
    base.security = node.security || 'auto';
    if (node.tls?.enabled) base.tls = structuredClone(node.tls);
    if (node.transport) base.transport = structuredClone(node.transport);
  } else if (node.type === 'trojan') {
    base.password = node.password;
    base.tls = structuredClone(node.tls || { enabled: true, server_name: node.server });
    if (node.transport) base.transport = structuredClone(node.transport);
  } else {
    throw new Error(`当前构建器不支持 ${node.type}`);
  }
  return base;
}

module.exports = { parseShareText, parseOne, nodeFingerprint, buildSingBoxOutbound, decodeBase64Text };
