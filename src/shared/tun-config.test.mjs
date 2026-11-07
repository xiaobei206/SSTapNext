import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseCustomRuleText, buildTunConfig, CHINA_RULESETS } = require('./tun-config.cjs');

const node = {
  id: 'node-1', type: 'vless', name: 'test node', server: 'edge.example.com', server_port: 443,
  uuid: '00000000-0000-4000-8000-000000000000', tls: { enabled: true, server_name: 'edge.example.com' },
};

test('parses custom domain, IP, process, port and network rules to sing-box routes', () => {
  const parsed = parseCustomRuleText([
    '# comments are ignored',
    'DOMAIN-SUFFIX,example.com,proxy',
    'DOMAIN,internal.example,direct',
    'IP-CIDR,10.0.0.0/8,direct,no-resolve',
    'PROCESS-NAME,game.exe,proxy',
    'DST-PORT,5000-6000,block',
    'NETWORK,udp,proxy',
  ].join('\n'));
  assert.equal(parsed.errors.length, 0);
  assert.equal(parsed.rules.length, 6);
  assert.deepEqual(parsed.rules[0].domain_suffix, ['example.com']);
  assert.equal(parsed.rules[0].outbound, 'selected-proxy');
  assert.deepEqual(parsed.rules[2].ip_cidr, ['10.0.0.0/8']);
  assert.deepEqual(parsed.rules[3].process_name, ['game.exe']);
  assert.deepEqual(parsed.rules[4].port_range, ['5000:6000']);
  assert.deepEqual(parsed.rules[5].network, ['udp']);
  assert.equal(parseCustomRuleText('NETWORK,icmp,proxy').errors[0].line, 1);
});

test('reports invalid custom rules with source line numbers without silently dropping them', () => {
  const parsed = parseCustomRuleText('# heading\nDOMAIN-SUFFIX, bad domain,proxy\nUNKNOWN,x,direct\nDST-PORT,0,proxy');
  assert.deepEqual(parsed.errors.map((item) => item.line), [2, 3, 4]);
});

test('builds a dual-stack Windows TUN config with IPv4-only DNS, DNS hijack and anti-loop routing', () => {
  const config = buildTunConfig(node, { mode: 'global' }, { logPath: 'C:/logs/tun.log', cachePath: 'C:/cache/tun.db' });
  assert.equal(config.inbounds[0].auto_route, true);
  assert.equal(config.inbounds[0].strict_route, true);
  assert.equal(config.inbounds[0].dns_mode, 'hijack');
  assert.equal(config.route.auto_detect_interface, true);
  assert.equal(config.route.final, 'selected-proxy');
  assert.deepEqual(config.route.rules[0], { protocol: ['dns'], action: 'hijack-dns' });
  assert.deepEqual(config.route.rules.at(-1), { ip_is_private: true, action: 'route', outbound: 'direct' });
  assert.equal(config.dns.final, 'dns-remote');
  assert.equal(config.dns.strategy, 'ipv4_only', 'DNS must not return unusable IPv6 choices for the selected node');
  assert.deepEqual(config.inbounds[0].address, ['172.19.0.1/30', 'fdfe:dcba:9876::1/126'], 'keep IPv6 inside TUN; do not leak IPv6 outside the tunnel');
  assert.equal(config.dns.servers.find((server) => server.tag === 'dns-remote').detour, 'selected-proxy');
  // sing-box 1.14 rejects `detour: "direct"` to an "empty" direct outbound at runtime;
  // the bootstrap DNS is direct-by-default via route.auto_detect_interface.
  assert.equal(config.dns.servers.find((server) => server.tag === 'dns-bootstrap').detour, undefined);
  assert.equal(config.outbounds[0].domain_resolver, 'dns-bootstrap');
  assert.equal(config.experimental.cache_file.enabled, true);
});

test('bypass-China mode uses remote binary geosite and geoip rule sets with direct DNS for CN', () => {
  const config = buildTunConfig(node, { mode: 'bypass-cn' });
  assert.deepEqual(config.route.rule_set.map((item) => item.tag), ['geosite-cn', 'geoip-cn']);
  assert.deepEqual(config.http_clients, [{ tag: 'ruleset-download' }]);
  assert.deepEqual(config.route.rules.slice(-2).map((item) => item.rule_set[0]), ['geosite-cn', 'geoip-cn']);
  assert.equal(config.dns.rules[0].server, 'dns-cn');
  assert.equal(Object.hasOwn(config.dns.rules[0], 'action'), false, 'sing-box 1.14 DNS route options no longer carry legacy action:route');
  assert.equal(config.dns.servers.find((server) => server.tag === 'dns-remote').detour, 'selected-proxy');
  assert.equal(config.dns.strategy, 'ipv4_only');
  assert.equal(config.outbounds[0].domain_resolver, 'dns-bootstrap');
  assert.ok(CHINA_RULESETS.every((item) => item.url.startsWith('https://')));
});

test('custom-rule mode rejects invalid rows and compiles valid rows ahead of the catch-all proxy route', () => {
  assert.throws(() => buildTunConfig(node, { mode: 'rule', customRulesText: 'BAD,x,proxy' }), /第 1 行/);
  const config = buildTunConfig(node, { mode: 'rule', customRulesText: 'DOMAIN-SUFFIX,example.com,direct' });
  assert.equal(config.route.rules[2].domain_suffix[0], 'example.com');
  assert.equal(config.route.find_process, false);
  assert.equal(config.route.rule_set, undefined);
});

test('rejects oversized custom rule inputs', () => {
  assert.throws(() => parseCustomRuleText('a'.repeat(32769)), /32 KB/);
});


test('applies IPv4-only DNS strategy consistently to global, bypass-cn and custom-rule modes', () => {
  for (const settings of [{ mode: 'global' }, { mode: 'bypass-cn' }, { mode: 'rule', customRulesText: 'DOMAIN-SUFFIX,example.com,proxy' }]) {
    const config = buildTunConfig(node, settings);
    assert.equal(config.dns.strategy, 'ipv4_only', `${settings.mode} must use IPv4-only DNS`);
    assert.equal(config.inbounds[0].address.length, 2, 'TUN remains dual-stack to prevent IPv6 bypass');
  }
});

test('allows dual-stack DNS when the user opts in while keeping the dual-stack TUN routes', () => {
  for (const settings of [
    { mode: 'global', dnsStrategy: 'prefer_ipv4' },
    { mode: 'bypass-cn', dnsStrategy: 'prefer_ipv4' },
    { mode: 'rule', dnsStrategy: 'prefer_ipv4', customRulesText: 'DOMAIN-SUFFIX,example.com,proxy' },
  ]) {
    const config = buildTunConfig(node, settings);
    assert.equal(config.dns.strategy, 'prefer_ipv4', `${settings.mode} should allow A and AAAA records`);
    assert.equal(config.inbounds[0].address.length, 2, 'TUN must remain dual-stack');
  }
});

test('allows IPv6-first dual-stack DNS when the user opts in', () => {
  const config = buildTunConfig(node, { mode: 'global', dnsStrategy: 'prefer_ipv6' });
  assert.equal(config.dns.strategy, 'prefer_ipv6');
  assert.equal(config.inbounds[0].address.length, 2);
});

test('rejects unknown DNS address-family settings by safely falling back to IPv4-only', () => {
  const config = buildTunConfig(node, { mode: 'global', dnsStrategy: 'ipv6_only' });
  assert.equal(config.dns.strategy, 'ipv4_only');
});

test('loads installed SSTap converted rule sets locally and keeps them ahead of China GEO routes', () => {
  const importedRuleSets = [
    { tag: 'sstap_0123456789abcdef', path: 'C:\\\\Users\\\\Test\\\\AppData\\\\SSTap Next\\\\rules\\\\game.json', action: 'proxy' },
  ];
  const config = buildTunConfig(node, { mode: 'bypass-cn' }, { importedRuleSets });
  const local = config.route.rule_set.find((item) => item.tag === 'sstap_0123456789abcdef');
  assert.deepEqual(local, { type: 'local', tag: 'sstap_0123456789abcdef', format: 'source', path: importedRuleSets[0].path });
  const customRoute = config.route.rules.findIndex((item) => item.rule_set?.[0] === 'sstap_0123456789abcdef');
  const chinaRoute = config.route.rules.findIndex((item) => item.rule_set?.[0] === 'geosite-cn');
  assert.ok(customRoute >= 0 && customRoute < chinaRoute, 'legacy game proxy rules must be able to override broad China direct routes');
  assert.equal(config.route.rules[customRoute].outbound, 'selected-proxy');
  assert.deepEqual(config.http_clients, [{ tag: 'ruleset-download' }]);
});

test('does not add HTTP clients when only local SSTap rule sets are enabled', () => {
  const config = buildTunConfig(node, { mode: 'global' }, {
    importedRuleSets: [{ tag: 'sstap_0123456789abcdef', path: 'C:\\\\rules\\\\game.json', action: 'direct' }],
  });
  assert.equal(config.http_clients, undefined);
  assert.equal(config.route.rule_set[0].type, 'local');
});

test('rejects unsafe imported SSTap rule-set descriptors', () => {
  assert.throws(() => buildTunConfig(node, { mode: 'global' }, {
    importedRuleSets: [{ tag: 'sstap_bad', path: 'C:\\\\rules\\\\x.json', action: 'proxy' }],
  }), /无效/);
});
