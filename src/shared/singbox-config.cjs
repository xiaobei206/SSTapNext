'use strict';

const { buildSingBoxOutbound } = require('./node-parser.cjs');
const { toClashApiConfig } = require('./singbox-traffic.cjs');

const DEFAULT_PROXY_HOST = '127.0.0.1';
const DEFAULT_PROXY_PORT = 20808;

function assertPort(value, label) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label}必须是 1 至 65535 之间的整数`);
  }
  return port;
}

function buildProxyConfig(node, options = {}) {
  if (!node || typeof node !== 'object') throw new Error('没有选择有效节点');
  const listen = options.listen || DEFAULT_PROXY_HOST;
  // Never expose the local proxy on LAN interfaces. This is a deliberate security boundary.
  if (listen !== '127.0.0.1' && listen !== '::1' && listen !== 'localhost') {
    throw new Error('本地代理只允许监听回环地址');
  }
  const listenPort = assertPort(options.listenPort ?? DEFAULT_PROXY_PORT, '本地代理端口');
  const outbound = buildSingBoxOutbound(node, 'selected-proxy');

  const config = {
    log: { level: options.logLevel || 'warn', timestamp: true },
    inbounds: [
      {
        type: 'mixed',
        tag: 'local-mixed-in',
        listen,
        listen_port: listenPort,
        set_system_proxy: false,
      },
    ],
    outbounds: [
      outbound,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      auto_detect_interface: true,
      final: 'selected-proxy',
    },
  };
  if (options.clashApi) config.experimental = { clash_api: toClashApiConfig(options.clashApi) };
  return config;
}

/**
 * A TUN smoke-test configuration only. It is deliberately separate from the live TUN
 * configuration factory; auto_route remains false so smoke testing never takes over routes.
 */

function buildBatchProxyConfig(entries, options = {}) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 32) {
    throw new Error('批量代理配置必须包含 1 至 32 个节点');
  }
  const seenIds = new Set();
  const seenPorts = new Set();
  const inbounds = [];
  const outbounds = [];
  const rules = [];
  entries.forEach((entry, index) => {
    const node = entry && entry.node;
    if (!node || typeof node.id !== 'string' || !node.id) throw new Error('批量代理配置包含无效节点');
    if (seenIds.has(node.id)) throw new Error('批量代理配置不允许重复节点');
    seenIds.add(node.id);
    const listenPort = assertPort(entry.listenPort, '批量测速本地端口');
    if (seenPorts.has(listenPort)) throw new Error('批量测速本地端口不能重复');
    seenPorts.add(listenPort);
    const inboundTag = 'batch-test-in-' + index;
    const outboundTag = 'batch-test-out-' + index;
    inbounds.push({
      type: 'mixed',
      tag: inboundTag,
      listen: '127.0.0.1',
      listen_port: listenPort,
      set_system_proxy: false,
    });
    outbounds.push(buildSingBoxOutbound(node, outboundTag));
    rules.push({ inbound: [inboundTag], action: 'route', outbound: outboundTag });
  });
  return {
    log: { level: options.logLevel || 'warn', timestamp: true },
    inbounds,
    outbounds: [...outbounds, { type: 'block', tag: 'block' }],
    route: {
      rules,
      auto_detect_interface: true,
      final: 'block',
    },
  };
}

function buildTunSmokeConfig(options = {}) {
  const name = String(options.interfaceName || 'SSTap Next Test').slice(0, 64);
  const node = options.node;
  if (!node) throw new Error('TUN 配置必须指定节点');
  return {
    log: { level: 'debug', timestamp: true },
    inbounds: [
      {
        type: 'tun',
        tag: 'tun-smoke',
        interface_name: name,
        address: ['172.31.254.1/30'],
        mtu: 1400,
        auto_route: false,
        dns_mode: 'disabled',
      },
    ],
    outbounds: [
      buildSingBoxOutbound(node, 'selected-proxy'),
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: { auto_detect_interface: true, final: 'selected-proxy' },
  };
}

module.exports = {
  DEFAULT_PROXY_HOST,
  DEFAULT_PROXY_PORT,
  buildProxyConfig,
  buildBatchProxyConfig,
  buildTunSmokeConfig,
};
