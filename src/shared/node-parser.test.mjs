import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { parseShareText, buildSingBoxOutbound } = require('./node-parser.cjs');

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');

test('parses VLESS Reality and preserves public key, short ID and flow', () => {
  const result = parseShareText('vless://123e4567-e89b-12d3-a456-426614174000@example.com:443?security=reality&pbk=PUBKEY&sid=1234&type=tcp&flow=xtls-rprx-vision&sni=cdn.example.com#Tokyo');
  assert.equal(result.errors.length, 0);
  assert.equal(result.nodes[0].type, 'vless');
  assert.equal(result.nodes[0].tls.reality.public_key, 'PUBKEY');
  assert.equal(result.nodes[0].tls.reality.short_id, '1234');
  assert.equal(result.nodes[0].flow, 'xtls-rprx-vision');
});

test('parses VLESS WebSocket transport with Host header', () => {
  const result = parseShareText('vless://uuid@example.com:443?security=tls&type=ws&host=cdn.example.com&path=%2Fedge&sni=cdn.example.com#WS');
  assert.equal(result.nodes[0].transport.type, 'ws');
  assert.equal(result.nodes[0].transport.path, '/edge');
  assert.equal(result.nodes[0].transport.headers.Host, 'cdn.example.com');
});

test('parses Hysteria2 and Salamander obfuscation', () => {
  const result = parseShareText('hysteria2://pass%3Aword@hy.example.com:443?sni=hy.example.com&obfs=salamander&obfs-password=hidden#HY2');
  assert.equal(result.nodes[0].type, 'hysteria2');
  assert.equal(result.nodes[0].password, 'pass:word');
  assert.equal(result.nodes[0].obfs.type, 'salamander');
});

test('parses SIP002 Shadowsocks base64 credentials', () => {
  const auth = b64('aes-128-gcm:secret');
  const result = parseShareText(`ss://${auth}@ss.example.com:8388#SS`);
  assert.equal(result.nodes[0].type, 'shadowsocks');
  assert.equal(result.nodes[0].method, 'aes-128-gcm');
  assert.equal(result.nodes[0].password, 'secret');
});

test('parses VMess base64 JSON', () => {
  const config = { v: '2', ps: 'VMess JP', add: 'vmess.example.com', port: '443', id: 'uuid', aid: '0', net: 'ws', tls: 'tls', sni: 'cdn.example.com', path: '/v' };
  const result = parseShareText(`vmess://${b64(JSON.stringify(config))}`);
  assert.equal(result.nodes[0].type, 'vmess');
  assert.equal(result.nodes[0].transport.path, '/v');
  assert.equal(result.nodes[0].tls.server_name, 'cdn.example.com');
});


test('keeps VMess WebSocket Host header separate from TLS SNI', () => {
  const config = { ps: 'VMess CDN', add: 'origin.example.com', port: '443', id: 'uuid', net: 'ws', tls: 'tls', host: 'cdn.example.com', sni: 'tls.example.com', path: '/ws' };
  const result = parseShareText(`vmess://${b64(JSON.stringify(config))}`);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].tls.server_name, 'tls.example.com');
  assert.equal(result.nodes[0].transport.headers.Host, 'cdn.example.com');
});

test('parses Trojan TLS links', () => {
  const result = parseShareText('trojan://secret@example.com:443?sni=example.com&type=grpc&serviceName=proxy#TR');
  assert.equal(result.nodes[0].type, 'trojan');
  assert.equal(result.nodes[0].transport.type, 'grpc');
  assert.equal(result.nodes[0].transport.service_name, 'proxy');
});

test('decodes a Base64 subscription containing multiple share links', () => {
  const plain = 'vless://uuid@example.com:443?security=tls#A\nhy2://secret@hy.example.com:443#B';
  const result = parseShareText(b64(plain));
  assert.equal(result.nodes.length, 2);
  assert.equal(result.errors.length, 0);
});

test('deduplicates repeated links and reports malformed lines without aborting import', () => {
  const line = 'hy2://secret@hy.example.com:443#B';
  const result = parseShareText(`${line}\nnot-a-node://bad\n${line}`);
  assert.equal(result.nodes.length, 1);
  assert.equal(result.errors.length, 1);
});

test('builds a sing-box outbound without dropping VLESS Reality settings', () => {
  const parsed = parseShareText('vless://uuid@example.com:443?security=reality&pbk=PUBKEY&sid=beef&sni=example.com#reality');
  const outbound = buildSingBoxOutbound(parsed.nodes[0], 'proxy');
  assert.equal(outbound.type, 'vless');
  assert.equal(outbound.tls.reality.public_key, 'PUBKEY');
  assert.equal(outbound.tls.reality.short_id, 'beef');
});


test('rejects unsupported VMess transports instead of silently treating them as TCP', () => {
  const config = { ps: 'VMess KCP', add: 'vmess.example.com', port: '443', id: 'uuid', net: 'kcp' };
  const result = parseShareText(`vmess://${b64(JSON.stringify(config))}`);
  assert.equal(result.nodes.length, 0);
  assert.match(result.errors[0].message, /不支持 VMess 传输方式/);
});

test('rejects Shadowsocks plugin parameters until plugin support is implemented', () => {
  const auth = b64('aes-128-gcm:secret');
  const result = parseShareText(`ss://${auth}@ss.example.com:8388?plugin=obfs-local%3Bobfs%3Dhttp#SS`);
  assert.equal(result.nodes.length, 0);
  assert.match(result.errors[0].message, /不支持带 SIP002 plugin 参数/);
});


test('preserves original line numbers when blank lines and comments appear before an error', () => {
  const result = parseShareText('# header\n\nvless://not-a-valid-link\n');
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].line, 3);
});

test('normalizes bracketed IPv6 server addresses for VLESS', () => {
  const result = parseShareText('vless://00000000-0000-4000-8000-000000000001@[2001:db8::1]:443?security=tls#IPv6');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].server, '2001:db8::1');
  assert.equal(result.nodes[0].tls.server_name, '2001:db8::1');
  assert.equal(result.nodes[0].server_port, 443);
});

test('rejects port zero instead of saving an unusable VLESS node', () => {
  const result = parseShareText('vless://00000000-0000-4000-8000-000000000001@example.com:0?security=tls');
  assert.equal(result.nodes.length, 0);
  assert.match(result.errors[0].message, /端口无效/);
});

test('supports Hysteria2 default port 443 and Gecko obfuscation', () => {
  const result = parseShareText('hy2://pass@hy.example.com?obfs=gecko&obfs-password=secret#Gecko');
  assert.equal(result.nodes.length, 1);
  assert.equal(result.nodes[0].server_port, 443);
  assert.equal(result.nodes[0].obfs.type, 'gecko');
});

test('rejects Hysteria2 pinSHA256 rather than mapping it to a different pin type', () => {
  const result = parseShareText('hy2://pass@hy.example.com:443?pinSHA256=abcd');
  assert.equal(result.nodes.length, 0);
  assert.match(result.errors[0].message, /pinSHA256/);
});

test('does not deduplicate Hysteria2 nodes with different obfuscation passwords', () => {
  const one = 'hy2://pass@example.com:443?obfs=salamander&obfs-password=one#same';
  const two = 'hy2://pass@example.com:443?obfs=salamander&obfs-password=two#same';
  const result = parseShareText(`${one}\n${two}`);
  assert.equal(result.nodes.length, 2);
});

test('does not deduplicate VMess nodes with different cipher security settings', () => {
  const base = { ps: 'same', add: 'vmess.example.com', port: '443', id: '00000000-0000-4000-8000-000000000001', aid: '0', net: 'tcp', tls: 'tls' };
  const one = `vmess://${b64(JSON.stringify({ ...base, scy: 'auto' }))}`;
  const two = `vmess://${b64(JSON.stringify({ ...base, scy: 'chacha20-poly1305' }))}`;
  const result = parseShareText(`${one}\n${two}`);
  assert.equal(result.nodes.length, 2);
});

test('does not deduplicate VLESS nodes with different TLS SNI settings', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const one = `vless://${id}@example.com:443?security=tls&sni=one.example.com#same`;
  const two = `vless://${id}@example.com:443?security=tls&sni=two.example.com#same`;
  const result = parseShareText(`${one}\n${two}`);
  assert.equal(result.nodes.length, 2);
});
