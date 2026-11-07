import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { makeZip } from './zip-test-fixture.mjs';
const require = createRequire(import.meta.url);
const { extractSstapZip } = require('./sstap-rule-library.cjs');

test('extracts only SSTap rules and root LICENSE from the GitHub source ZIP', () => {
  const archive = makeZip({
    'SSTap-Rule-master/LICENSE': 'Apache License 2.0',
    'SSTap-Rule-master/README.md': 'ignored',
    'SSTap-Rule-master/rules/BypassCNandLan.rules': '#BypassCNandLan,CN,1,1,1,0,0,0\n1.0.1.0/24',
    'SSTap-Rule-master/rules/Game.rules': '#Game,Game,0,0,1,0,1,0\n2.0.0.0/8',
    'SSTap-Rule-master/../escape.rules': 'bad',
  });
  assert.throws(() => extractSstapZip(archive), /不安全路径/);
  const safe = makeZip({
    'SSTap-Rule-master/LICENSE': 'Apache License 2.0',
    'SSTap-Rule-master/README.md': 'ignored',
    'SSTap-Rule-master/rules/BypassCNandLan.rules': '#BypassCNandLan,CN,1,1,1,0,0,0\n1.0.1.0/24',
    'SSTap-Rule-master/rules/Game.rules': '#Game,Game,0,0,1,0,1,0\n2.0.0.0/8',
  });
  const extracted = extractSstapZip(safe);
  assert.deepEqual([...extracted.keys()].sort(), ['LICENSE', 'rules/BypassCNandLan.rules', 'rules/Game.rules']);
});

test('rejects non-ZIP/corrupt archives and archives missing mandatory metadata', () => {
  assert.throws(() => extractSstapZip(Buffer.from('not a zip')), /大小异常|结束标记/);
  const missing = makeZip({ 'SSTap-Rule-master/LICENSE': 'Apache License 2.0' });
  assert.throws(() => extractSstapZip(missing), /缺少核心规则/);
});
