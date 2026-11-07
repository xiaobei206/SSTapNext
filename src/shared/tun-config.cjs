'use strict';

const net = require('node:net');
const { buildSingBoxOutbound } = require('./node-parser.cjs');

const DEFAULT_TUN_NAME = 'SSTap Next';
const DEFAULT_TUN_ADDRESS = ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'];
const RULESET_BASE = 'https://cdn.jsdelivr.net/gh/MetaCubeX/meta-rules-dat@sing';
const CHINA_RULESETS = [
  { tag: 'geosite-cn', url: `${RULESET_BASE}/geo/geosite/cn.srs` },
  { tag: 'geoip-cn', url: `${RULESET_BASE}/geo/geoip/cn.srs` },
];

function fail(message, line) {
  throw new Error(line ? `第 ${line} 行：${message}` : message);
}

function validateDomain(value, line) {
  const domain = String(value || '').trim().toLowerCase().replace(/^\*\./, '');
  if (!domain || domain.length > 253 || domain.includes('://') || domain.includes('/') || domain.includes(':')) {
    fail(`域名无效：${value}`, line);
  }
  const labels = domain.split('.');
  if (labels.some((part) => !part || part.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part))) {
    fail(`域名格式无效：${value}`, line);
  }
  return domain;
}

function validateCidr(value, line) {
  const [address, prefixText, extra] = String(value || '').split('/');
  if (extra !== undefined || !address || net.isIP(address) === 0) fail(`IP 网段无效：${value}`, line);
  if (prefixText === undefined) return `${address}/${net.isIP(address) === 4 ? 32 : 128}`;
  if (!/^\d+$/.test(prefixText)) fail(`CIDR 前缀无效：${value}`, line);
  const prefix = Number(prefixText);
  const max = net.isIP(address) === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) fail(`CIDR 前缀超出范围：${value}`, line);
  return `${address}/${prefix}`;
}

function parseCustomRuleText(input = '') {
  if (typeof input !== 'string') throw new Error('自定义规则必须为文本');
  if (input.length > 32 * 1024) throw new Error('自定义规则超过 32 KB 上限');
  const lines = input.split(/\r?\n/);
  if (lines.length > 500) throw new Error('自定义规则最多允许 500 行');
  const rules = [];
  const errors = [];

  lines.forEach((raw, index) => {
    const lineNo = index + 1;
    const value = raw.trim();
    if (!value || value.startsWith('#') || value.startsWith('//')) return;
    const parts = value.split(',').map((part) => part.trim());
    if (parts.length < 3 || parts.length > 4) {
      errors.push({ line: lineNo, message: '格式应为 TYPE,VALUE,proxy|direct|block' });
      return;
    }
    const [typeRaw, valueRaw, outboundRaw, optionRaw] = parts;
    const type = typeRaw.toUpperCase();
    const target = outboundRaw.toLowerCase();
    const outbound = target === 'proxy' ? 'selected-proxy' : target === 'direct' ? 'direct' : target === 'block' ? 'block' : null;
    if (!outbound) {
      errors.push({ line: lineNo, message: '目标仅允许 proxy、direct 或 block' });
      return;
    }
    if (optionRaw && optionRaw.toLowerCase() !== 'no-resolve') {
      errors.push({ line: lineNo, message: `不支持的规则选项：${optionRaw}` });
      return;
    }

    try {
      let match;
      switch (type) {
        case 'DOMAIN':
          match = { domain: [validateDomain(valueRaw, lineNo)] };
          break;
        case 'DOMAIN-SUFFIX':
          match = { domain_suffix: [validateDomain(valueRaw, lineNo)] };
          break;
        case 'DOMAIN-KEYWORD': {
          const keyword = valueRaw.toLowerCase();
          if (!keyword || keyword.length > 128 || /[\s,]/.test(keyword)) fail(`关键字无效：${valueRaw}`, lineNo);
          match = { domain_keyword: [keyword] };
          break;
        }
        case 'IP-CIDR':
        case 'IP-CIDR6': {
          const cidr = validateCidr(valueRaw, lineNo);
          const version = net.isIP(cidr.split('/')[0]);
          if ((type === 'IP-CIDR' && version !== 4) || (type === 'IP-CIDR6' && version !== 6)) fail(`${type} 与地址族不匹配`, lineNo);
          match = { ip_cidr: [cidr] };
          break;
        }
        case 'PROCESS-NAME': {
          if (!valueRaw || valueRaw.length > 260 || /[\\/:*?"<>|]/.test(valueRaw)) fail(`进程名称无效：${valueRaw}`, lineNo);
          match = { process_name: [valueRaw] };
          break;
        }
        case 'PROCESS-PATH':
          if (!valueRaw || valueRaw.length > 1024 || !/^[a-zA-Z]:\\|^\\\\/.test(valueRaw)) fail('进程路径必须是 Windows 绝对路径', lineNo);
          match = { process_path: [valueRaw] };
          break;
        case 'DST-PORT': {
          const ports = valueRaw.split('-').map(Number);
          if (ports.length > 2 || ports.some((port) => !Number.isInteger(port) || port < 1 || port > 65535) || (ports.length === 2 && ports[0] > ports[1])) fail(`端口或端口范围无效：${valueRaw}`, lineNo);
          match = ports.length === 1 ? { port: [ports[0]] } : { port_range: [`${ports[0]}:${ports[1]}`] };
          break;
        }
        case 'NETWORK': {
          const network = valueRaw.toLowerCase();
          if (!['tcp', 'udp'].includes(network)) fail(`网络类型无效：${valueRaw}`, lineNo);
          match = { network: [network] };
          break;
        }
        default:
          fail(`不支持的规则类型：${typeRaw}`, lineNo);
      }
      rules.push({ ...match, action: 'route', outbound, _sourceLine: lineNo });
    } catch (error) {
      errors.push({ line: lineNo, message: error.message.replace(/^第 \d+ 行：/, '') });
    }
  });

  return { rules: rules.map(({ _sourceLine, ...rule }) => rule), errors };
}

function buildTunConfig(node, settings = {}, options = {}) {
  if (!node || typeof node !== 'object') throw new Error('没有选择有效节点');
  const mode = ['global', 'bypass-cn', 'rule'].includes(settings.mode) ? settings.mode : 'global';
  // Keep the safe IPv4-only default for existing installations, but allow users
  // with working IPv6 on both their access network and proxy egress to opt into
  // dual-stack DNS without changing the TUN routing model.
  const dnsStrategies = new Set(['ipv4_only', 'prefer_ipv4', 'prefer_ipv6']);
  const dnsStrategy = dnsStrategies.has(settings.dnsStrategy) ? settings.dnsStrategy : 'ipv4_only';
  const parsedCustom = parseCustomRuleText(settings.customRulesText || '');
  if (mode === 'rule' && parsedCustom.errors.length) {
    throw new Error(`自定义规则有 ${parsedCustom.errors.length} 个错误：${parsedCustom.errors.slice(0, 5).map((item) => `第 ${item.line} 行 ${item.message}`).join('；')}`);
  }

  const rules = [
    { protocol: ['dns'], action: 'hijack-dns' },
    { action: 'sniff' },
  ];
  // Explicit user rules have priority over built-in safety and China routes.
  if (mode === 'rule') rules.push(...parsedCustom.rules);
  rules.push({ ip_is_private: true, action: 'route', outbound: 'direct' });

  const importedRuleSets = Array.isArray(options.importedRuleSets) ? options.importedRuleSets : [];
  for (const item of importedRuleSets) {
    if (!item || !/^sstap_[a-f0-9]{16}$/.test(String(item.tag || ''))
      || typeof item.path !== 'string' || !(/^[a-zA-Z]:\\/.test(item.path) || /^\\\\/.test(item.path) || item.path.startsWith('/'))
      || !['proxy', 'direct'].includes(item.action)) {
      throw new Error('导入的 SSTap 规则集路径、标签或路由动作无效');
    }
    rules.push({ rule_set: [item.tag], action: 'route', outbound: item.action === 'proxy' ? 'selected-proxy' : 'direct' });
  }

  const ruleSets = importedRuleSets.map((item) => ({
    type: 'local',
    tag: item.tag,
    format: 'source',
    path: item.path,
  }));
  if (mode === 'bypass-cn') {
    ruleSets.push(...CHINA_RULESETS.map((item) => ({
      type: 'remote',
      tag: item.tag,
      format: 'binary',
      url: item.url,
      http_client: 'ruleset-download',
      update_interval: '24h',
    })));
    rules.push({ rule_set: ['geosite-cn'], action: 'route', outbound: 'direct' });
    rules.push({ rule_set: ['geoip-cn'], action: 'route', outbound: 'direct' });
  }

  const tunInbound = {
    type: 'tun',
    tag: 'sstap-tun-in',
    interface_name: String(options.interfaceName || DEFAULT_TUN_NAME).slice(0, 64),
    address: DEFAULT_TUN_ADDRESS,
    mtu: 1400,
    auto_route: true,
    strict_route: true,
    dns_mode: 'hijack',
  };

  const selectedProxy = buildSingBoxOutbound(node, 'selected-proxy');
  // Resolve the proxy endpoint through a bootstrap resolver before the tunnel is available.
  // All ordinary DNS requests use DoH through the selected proxy to avoid direct DNS leakage.
  selectedProxy.domain_resolver = 'dns-bootstrap';

  const config = {
    ...(ruleSets.some((item) => item.type === 'remote') ? { http_clients: [{ tag: 'ruleset-download' }] } : {}),
    log: { level: options.logLevel || 'info', timestamp: true, ...(options.logPath ? { output: options.logPath } : {}) },
    dns: {
      servers: [
        // Bootstrap must be direct and address-based; otherwise resolving the proxy hostname
        // could recursively depend on the proxy itself. In sing-box 1.14 the DNS transport is
        // direct-by-default (auto_detect_interface), and an explicit `detour: "direct"` to an
        // "empty" direct outbound is rejected at runtime, so no detour is set here.
        { type: 'udp', tag: 'dns-bootstrap', server: '223.5.5.5', server_port: 53 },
        {
          type: 'https', tag: 'dns-remote', server: '1.1.1.1', server_port: 443,
          path: '/dns-query', tls: { enabled: true, server_name: 'cloudflare-dns.com' }, detour: 'selected-proxy',
        },
        { type: 'udp', tag: 'dns-cn', server: '223.5.5.5', server_port: 53 },
      ],
      ...(mode === 'bypass-cn' ? { rules: [{ rule_set: ['geosite-cn'], server: 'dns-cn' }] } : {}),
      final: 'dns-remote',
      // Existing installations default to IPv4-only because many proxy exits do
      // not provide IPv6. prefer_ipv4 and prefer_ipv6 both permit A + AAAA; the
      // latter is useful when the local network and selected proxy egress support IPv6.
      strategy: dnsStrategy,
      reverse_mapping: true,
    },
    inbounds: [tunInbound],
    outbounds: [
      selectedProxy,
      { type: 'direct', tag: 'direct' },
      { type: 'block', tag: 'block' },
    ],
    route: {
      rules,
      ...(ruleSets.length ? { rule_set: ruleSets } : {}),
      auto_detect_interface: true,
      default_domain_resolver: 'dns-bootstrap',
      find_process: mode === 'rule' && parsedCustom.rules.some((rule) => rule.process_name || rule.process_path),
      final: 'selected-proxy',
    },
    experimental: {
      cache_file: {
        enabled: true,
        path: options.cachePath || 'sstap-next-cache.db',
        store_dns: true,
      },
    },
  };

  return config;
}

module.exports = {
  DEFAULT_TUN_NAME,
  DEFAULT_TUN_ADDRESS,
  CHINA_RULESETS,
  parseCustomRuleText,
  buildTunConfig,
};
