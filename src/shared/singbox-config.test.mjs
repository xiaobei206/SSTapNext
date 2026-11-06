import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseShareText } = require('./node-parser.cjs');
const { buildProxyConfig, buildTunSmokeConfig } = require('./singbox-config.cjs');

const uuid = '00000000-0000-4000-8000-000000000001';

test('builds a loopback-only mixed proxy config and routes through the selected node', () => {
  const node = parseShareText(`vless://${uuid}@edge.example.com:443?security=reality&pbk=PUBLICKEY&sid=beef&sni=cdn.example.com#JP`).nodes[0];
  const config = buildProxyConfig(node, { listenPort: 23456 });
  assert.equal(config.inbounds[0].type, 'mixed');
  assert.equal(config.inbounds[0].listen, '127.0.0.1');
  assert.equal(config.inbounds[0].listen_port, 23456);
  assert.equal(config.inbounds[0].set_system_proxy, false);
  assert.equal(config.outbounds[0].tls.reality.public_key, 'PUBLICKEY');
  assert.equal(config.route.final, 'selected-proxy');
  assert.equal(config.route.auto_detect_interface, true);
});

test('refuses to expose the local proxy to the LAN', () => {
  const node = parseShareText(`hy2://secret@hy.example.com:443#HY2`).nodes[0];
  assert.throws(() => buildProxyConfig(node, { listen: '0.0.0.0' }), /回环地址/);
});

test('builds a TUN smoke config with route and DNS changes explicitly disabled', () => {
  const node = parseShareText(`trojan://secret@tr.example.com:443?sni=tr.example.com#TR`).nodes[0];
  const config = buildTunSmokeConfig({ node });
  assert.equal(config.inbounds[0].type, 'tun');
  assert.equal(config.inbounds[0].auto_route, false);
  assert.equal(config.inbounds[0].dns_mode, 'disabled');
  assert.equal(config.route.final, 'selected-proxy');
});
