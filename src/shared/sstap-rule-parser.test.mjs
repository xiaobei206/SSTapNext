import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseSstapRule } = require('./sstap-rule-parser.cjs');

test('converts original SSTap proxy/direct header actions without inversion', () => {
  const proxy = parseSstapRule('#League-of-Legends-us,英雄联盟-美服,0,0,1,0,1,0,By-FQrabbit\n8.23.24.0/24\n23.2.16.4', 'rules/League-of-Legends-us.rules');
  const direct = parseSstapRule('#BypassCNandLan,绕过大陆和局域网,1,1,1,0,0,0,\n1.0.1.0/24\n10.0.0.0/8', 'rules/BypassCNandLan.rules');
  assert.equal(proxy.routeAction, 'proxy');
  assert.equal(proxy.displayName, '英雄联盟-美服');
  assert.equal(proxy.author, 'By-FQrabbit');
  assert.deepEqual(proxy.ruleSet.rules[0].ip_cidr, ['8.23.24.0/24', '23.2.16.4/32']);
  assert.equal(direct.routeAction, 'direct');
  assert.equal(direct.cidrCount, 2);
});

test('accepts IPv6 CIDRs in SSTap files and tracks address families', () => {
  const parsed = parseSstapRule('#China,someip,1,1,1,0,1,0\n1.0.0.0/8\n2001:250::/30\n2001:254::/33\n2001:255::/32');
  assert.equal(parsed.ipv4Count, 1);
  assert.equal(parsed.ipv6Count, 3);
  assert.equal(parsed.cidrCount, 4);
});

test('deduplicates CIDRs and rejects malformed rows instead of partially importing', () => {
  const parsed = parseSstapRule('#Test,测试,0,0,1,0,1,0\n1.2.3.0/24\n1.2.3.0/24');
  assert.equal(parsed.cidrCount, 1);
  assert.equal(parsed.duplicateCount, 1);
  assert.throws(() => parseSstapRule('#Test,测试,0,0,1,0,1,0\n1.2.3.0/99'), /前缀超出范围/);
  assert.throws(() => parseSstapRule('#Test,测试,0,0,1,0,1,0\nnot-an-ip'), /拒绝部分导入/);
});

test('rejects malformed headers, unsupported actions, invalid UTF-8 and oversized files', () => {
  assert.throws(() => parseSstapRule('1.2.3.0/24'), /规则第一行/);
  assert.throws(() => parseSstapRule('#Test,测试,2,0,1,0,1,0\n1.2.3.0/24'), /默认动作/);
  assert.throws(() => parseSstapRule(Buffer.from([0xff, 0xfe])), /encoded|character/i);
  assert.throws(() => parseSstapRule(Buffer.alloc(16 * 1024 * 1024 + 1)), /16 MB/);
});
