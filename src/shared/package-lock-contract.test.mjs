import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validator = path.join(projectRoot, 'scripts', 'verify-package-lock.mjs');

function runValidator(lockfile) {
  return spawnSync(process.execPath, [validator, '--lockfile', lockfile], {
    encoding: 'utf8',
    timeout: 10_000,
  });
}

test('package manifest and lockfile dependency graph are consistent', () => {
  const result = runValidator(path.join(projectRoot, 'package-lock.json'));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /704 个依赖引用均与锁定版本兼容/);
});

test('lockfile validator rejects a dependency range newer than the locked package', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'sstap-lock-contract-'));
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));

  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package-lock.json'), 'utf8'));
  lock.packages['node_modules/@babel/generator'].dependencies['@jridgewell/trace-mapping'] = '^0.3.38';
  fs.writeFileSync(path.join(temporaryDirectory, 'package.json'), JSON.stringify(manifest));
  const testLockPath = path.join(temporaryDirectory, 'package-lock.json');
  fs.writeFileSync(testLockPath, JSON.stringify(lock));

  const result = runValidator(testLockPath);
  assert.notEqual(result.status, 0, 'expected an unsatisfied lockfile dependency range to fail');
  assert.match(result.stderr, /@jridgewell\/trace-mapping@\^0\.3\.38/);
  assert.match(result.stderr, /锁定的是 0\.3\.31/);
});
