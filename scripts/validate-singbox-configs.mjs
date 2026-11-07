#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseShareText } = require('../src/shared/node-parser.cjs');
const { buildTunConfig } = require('../src/shared/tun-config.cjs');

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function resolveCore() {
  const candidate = argValue('--core') || process.env.SSTAP_SING_BOX || path.resolve('runtime', 'sing-box', process.platform === 'win32' ? 'sing-box.exe' : 'sing-box');
  return path.resolve(candidate);
}

const realityPublicKey = Buffer.alloc(32, 0x42).toString('base64url');
const fixtures = [
  ['VLESS Reality', `vless://123e4567-e89b-12d3-a456-426614174000@vless.example.com:443?security=reality&pbk=${realityPublicKey}&sid=1234&type=tcp&sni=cdn.example.com#VLESS-Reality`],
  ['VLESS TLS WebSocket', 'vless://123e4567-e89b-12d3-a456-426614174000@ws.example.com:443?security=tls&type=ws&host=cdn.example.com&path=%2Fedge&sni=cdn.example.com#VLESS-WS'],
  ['Hysteria2 Salamander', 'hysteria2://password@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=hidden#Hysteria2'],
  ['Shadowsocks SIP002', `ss://${Buffer.from('aes-128-gcm:secret').toString('base64')}@ss.example.com:8388#Shadowsocks`],
  ['VMess WebSocket TLS', `vmess://${Buffer.from(JSON.stringify({ v: '2', ps: 'VMess', add: 'vmess.example.com', port: '443', id: '123e4567-e89b-12d3-a456-426614174000', aid: '0', net: 'ws', tls: 'tls', sni: 'cdn.example.com', host: 'cdn.example.com', path: '/v' })).toString('base64')}`],
  ['Trojan gRPC TLS', 'trojan://password@tr.example.com:443?sni=tr.example.com&type=grpc&serviceName=proxy#Trojan'],
];
const modes = [
  ['global', { mode: 'global' }],
  ['bypass-cn', { mode: 'bypass-cn' }],
  ['custom-rules', { mode: 'rule', customRulesText: 'DOMAIN-SUFFIX,example.cn,direct\nDOMAIN-SUFFIX,blocked.example,block\nNETWORK,udp,proxy' }],
];
const dnsStrategies = [
  ['ipv4-only', 'ipv4_only'],
  ['dual-ipv4-first', 'prefer_ipv4'],
  ['dual-ipv6-first', 'prefer_ipv6'],
];

async function main() {
  const core = resolveCore();
  if (!fs.existsSync(core)) {
    console.error(`[FAIL] 找不到 sing-box 核心：${core}`);
    process.exitCode = 2;
    return;
  }

  const version = spawnSync(core, ['version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
  if (version.error || version.status !== 0) {
    console.error(`[FAIL] sing-box version 无法运行：${version.error?.message || version.stderr || version.status}`);
    process.exitCode = 3;
    return;
  }
  const versionText = `${version.stdout || ''}${version.stderr || ''}`.trim();
  if (!/sing-box version\s+\d+\.\d+\.\d+/i.test(versionText)) {
    console.error(`[FAIL] 无法识别 sing-box 版本输出：${versionText || 'unknown'}`);
    process.exitCode = 4;
    return;
  }
  console.log('[INFO] 使用当前 runtime/sing-box 中的实际核心版本；不强制锁定 1.14.4。');
  console.log(`[INFO] ${versionText}`);

  const nodes = [];
  for (const [name, share] of fixtures) {
    const parsed = parseShareText(share);
    if (parsed.errors.length !== 0 || parsed.nodes.length !== 1) {
      throw new Error(`${name} 测试 fixture 解析失败：${JSON.stringify(parsed.errors)}`);
    }
    nodes.push([name, parsed.nodes[0]]);
  }

  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'sstap-next-config-audit-'));
  const failures = [];
  let passed = 0;
  try {
    for (const [modeName, modeSettings] of modes) {
      for (const [dnsName, dnsStrategy] of dnsStrategies) {
        for (const [nodeName, node] of nodes) {
        const settings = { ...modeSettings, dnsStrategy };
        const caseName = `${modeName} / ${dnsName} / ${nodeName}`;
        const caseDir = path.join(work, `${modeName}-${dnsName}-${nodeName.replace(/[^a-z0-9]+/gi, '-')}`);
        await fsp.mkdir(caseDir, { recursive: true });
        const configPath = path.join(caseDir, 'config.json');
        const config = buildTunConfig(node, settings, {
          interfaceName: 'SSTap Next Audit',
          logPath: path.join(caseDir, 'sing-box.log'),
          cachePath: path.join(caseDir, 'cache.db'),
        });
        await fsp.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
        const checked = spawnSync(core, ['check', '-c', configPath], { encoding: 'utf8', timeout: 30000, windowsHide: true });
        if (checked.error || checked.status !== 0) {
          const detail = [checked.error?.message, checked.stderr, checked.stdout].filter(Boolean).join('\n').trim();
          failures.push({ caseName, detail: detail || `exit=${checked.status}` });
          console.error(`[FAIL] ${caseName}`);
          if (detail) console.error(detail);
        } else {
          passed++;
          console.log(`[PASS] ${caseName}`);
        }
        }
      }
    }

    // Validate the actual SSTap legacy-rule integration with the real sing-box
    // binary. The fixture files use the exact source JSON shape produced by the
    // converter, and the config places proxy/direct game rules before China GEO.
    const legacyDir = path.join(work, 'sstap-legacy-rules');
    await fsp.mkdir(legacyDir, { recursive: true });
    const proxyRulePath = path.join(legacyDir, 'game-proxy.json');
    const directRulePath = path.join(legacyDir, 'game-direct.json');
    await fsp.writeFile(proxyRulePath, JSON.stringify({
      version: 1,
      rules: [{ ip_cidr: ['8.8.8.0/24'] }],
    }), 'utf8');
    await fsp.writeFile(directRulePath, JSON.stringify({
      version: 1,
      rules: [{ ip_cidr: ['1.0.1.0/24'] }],
    }), 'utf8');
    const importedRuleSets = [
      { tag: 'sstap_aaaaaaaaaaaaaaaa', path: proxyRulePath, action: 'proxy' },
      { tag: 'sstap_bbbbbbbbbbbbbbbb', path: directRulePath, action: 'direct' },
    ];
    const legacyConfig = buildTunConfig(nodes[0][1], { mode: 'bypass-cn', dnsStrategy: 'ipv4_only' }, {
      interfaceName: 'SSTap Next Audit',
      logPath: path.join(legacyDir, 'sing-box.log'),
      cachePath: path.join(legacyDir, 'cache.db'),
      importedRuleSets,
    });
    const proxyRoute = legacyConfig.route.rules.findIndex((rule) => rule.rule_set?.[0] === importedRuleSets[0].tag);
    const directRoute = legacyConfig.route.rules.findIndex((rule) => rule.rule_set?.[0] === importedRuleSets[1].tag);
    const chinaRoute = legacyConfig.route.rules.findIndex((rule) => rule.rule_set?.[0] === 'geosite-cn');
    if (!(proxyRoute >= 0 && directRoute > proxyRoute && chinaRoute > directRoute)
      || legacyConfig.route.rules[proxyRoute].outbound !== 'selected-proxy'
      || legacyConfig.route.rules[directRoute].outbound !== 'direct') {
      throw new Error('SSTap legacy rules are not ordered or mapped ahead of China GEO routes');
    }
    const legacyConfigPath = path.join(legacyDir, 'config.json');
    await fsp.writeFile(legacyConfigPath, JSON.stringify(legacyConfig, null, 2), 'utf8');
    const legacyChecked = spawnSync(core, ['check', '-c', legacyConfigPath], {
      encoding: 'utf8', timeout: 30000, windowsHide: true,
    });
    if (legacyChecked.error || legacyChecked.status !== 0) {
      const detail = [legacyChecked.error?.message, legacyChecked.stderr, legacyChecked.stdout].filter(Boolean).join('\\n').trim();
      failures.push({ caseName: 'SSTap legacy local source rule sets', detail: detail || `exit=${legacyChecked.status}` });
      console.error('[FAIL] SSTap legacy local source rule sets');
      if (detail) console.error(detail);
    } else {
      passed++;
      console.log('[PASS] SSTap legacy local source rule sets (proxy/direct, before China GEO)');
    }
  } finally {
    await fsp.rm(work, { recursive: true, force: true });
  }

  const expected = modes.length * dnsStrategies.length * fixtures.length + 1;
  console.log(`\\n配置校验：${passed}/${expected} 通过`);
  if (failures.length) {
    console.error(`失败项：${failures.map((item) => item.caseName).join('；')}`);
    process.exitCode = 5;
  }
}

main().catch((error) => {
  console.error(`[FATAL] ${error.stack || error.message || error}`);
  process.exitCode = 1;
});
