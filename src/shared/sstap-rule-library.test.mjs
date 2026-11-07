import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { makeZip } from './zip-test-fixture.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getSstapRuleLibrary, updateSstapRuleLibrary, getEnabledSstapRuleSets } = require('./sstap-rule-library.cjs');

function makeArchive() {
  const rules = {
    'SSTap-Rule-master/rules/BypassCNandLan.rules': '#BypassCNandLan,CN直连,1,1,1,0,0,0\n1.0.1.0/24\n10.0.0.0/8',
  };
  for (let i = 0; i < 12; i += 1) rules[`SSTap-Rule-master/rules/Game-${i}.rules`] = `#Game-${i},游戏${i},0,0,1,0,1,0,Tester\n${20 + i}.0.0.0/8`;
  rules['SSTap-Rule-master/LICENSE'] = 'Apache License 2.0';
  return makeZip(rules);
}

test('downloads, converts, atomically installs and selects SSTap legacy rules', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sstap-rule-library-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const installed = await updateSstapRuleLibrary(root, { sourceCommit: { sha }, archiveBuffer: makeArchive() });
  assert.equal(installed.installed, true);
  assert.equal(installed.revision, sha);
  assert.equal(installed.ruleCount, 13);
  assert.equal(installed.rules.find((x) => x.fileName === 'BypassCNandLan.rules').routeAction, 'direct');
  const current = await getSstapRuleLibrary(root);
  assert.equal(current.ruleCount, 13);
  const selected = await getEnabledSstapRuleSets(root, [current.rules.find((x) => x.fileName === 'Game-0.rules').id], 'bypass-cn');
  assert.equal(selected.length, 2);
  assert.ok(selected.some((x) => x.fileName === 'BypassCNandLan.rules'));
  assert.ok(selected.some((x) => x.fileName === 'Game-0.rules'));
  assert.equal(selected[0].fileName, 'Game-0.rules', 'explicit game rules must be evaluated before the broad automatic CN bypass');
  assert.equal(selected[1].fileName, 'BypassCNandLan.rules', 'automatic CN bypass must remain the final imported SSTap rule');
  const parsed = JSON.parse(await fs.readFile(selected.find((x) => x.fileName === 'Game-0.rules').path, 'utf8'));
  assert.deepEqual(parsed.rules[0].ip_cidr, ['20.0.0.0/8']);
  const unchanged = await updateSstapRuleLibrary(root, { sourceCommit: { sha }, archiveBuffer: Buffer.from('ignored') });
  assert.equal(unchanged.unchanged, true);
});

test('failed conversion leaves the previous active rule library untouched', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sstap-rule-atomic-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const oldSha = 'b'.repeat(40);
  await updateSstapRuleLibrary(root, { sourceCommit: { sha: oldSha }, archiveBuffer: makeArchive() });
  await assert.rejects(updateSstapRuleLibrary(root, { sourceCommit: { sha: 'c'.repeat(40) }, archiveBuffer: makeZip({ 'SSTap-Rule-master/LICENSE': 'Apache License 2.0' }) }), /缺少核心规则/);
  const current = await getSstapRuleLibrary(root);
  assert.equal(current.revision, oldSha);
});
