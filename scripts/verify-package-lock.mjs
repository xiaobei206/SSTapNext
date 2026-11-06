#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function parseVersion(input) {
  const match = String(input).trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function compareVersions(a, b) {
  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] < b[field] ? -1 : 1;
  }
  if (!a.prerelease.length && !b.prerelease.length) return 0;
  if (!a.prerelease.length) return 1;
  if (!b.prerelease.length) return -1;
  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < length; i += 1) {
    const left = a.prerelease[i];
    const right = b.prerelease[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;
    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);
    if (leftNumeric && rightNumeric) return Number(left) < Number(right) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left < right ? -1 : 1;
  }
  return 0;
}

function makeVersion(major, minor = 0, patch = 0) {
  return { major, minor, patch, prerelease: [] };
}

function partialBounds(raw) {
  const exactVersion = parseVersion(raw);
  if (exactVersion) return { lower: exactVersion, upper: exactVersion, exact: true };
  const parts = raw.split('.');
  if (parts.length > 3 || parts.length === 0) return null;
  const values = [0, 0, 0];
  let wildcardAt = -1;
  for (let i = 0; i < parts.length; i += 1) {
    if (/^(?:x|X|\*)$/.test(parts[i])) { wildcardAt = i; break; }
    if (!/^\d+$/.test(parts[i])) return null;
    values[i] = Number(parts[i]);
  }
  if (wildcardAt === -1 && parts.length === 3) {
    const exact = parseVersion(raw);
    return exact ? { lower: exact, upper: exact, exact: true } : null;
  }
  const width = wildcardAt === -1 ? parts.length : wildcardAt;
  const lower = makeVersion(values[0], values[1], values[2]);
  let upper;
  if (width <= 1) upper = makeVersion(values[0] + 1, 0, 0);
  else if (width === 2) upper = makeVersion(values[0], values[1] + 1, 0);
  else upper = makeVersion(values[0], values[1], values[2] + 1);
  return { lower, upper, exact: false };
}

function comparatorMatches(version, token) {
  if (!token || token === '*' || /^(?:x|X)$/.test(token)) return true;
  const operator = token.match(/^(\^|~|>=|<=|>|<|=)?(.*)$/);
  if (!operator) return false;
  const op = operator[1] || '';
  const raw = operator[2];

  if (op === '^' || op === '~') {
    const base = parseVersion(raw);
    if (!base || compareVersions(version, base) < 0) return false;
    let upper;
    if (op === '~') upper = makeVersion(base.major, base.minor + 1, 0);
    else if (base.major > 0) upper = makeVersion(base.major + 1, 0, 0);
    else if (base.minor > 0) upper = makeVersion(0, base.minor + 1, 0);
    else upper = makeVersion(0, 0, base.patch + 1);
    return compareVersions(version, upper) < 0;
  }

  if (op === '>=' || op === '>' || op === '<=' || op === '<' || op === '=') {
    const target = parseVersion(raw);
    if (!target) return false;
    const comparison = compareVersions(version, target);
    if (op === '>=') return comparison >= 0;
    if (op === '>') return comparison > 0;
    if (op === '<=') return comparison <= 0;
    if (op === '<') return comparison < 0;
    return comparison === 0;
  }

  const bounds = partialBounds(raw);
  if (!bounds) return false;
  if (bounds.exact) return compareVersions(version, bounds.lower) === 0;
  return compareVersions(version, bounds.lower) >= 0 && compareVersions(version, bounds.upper) < 0;
}

function satisfies(versionText, spec) {
  const version = parseVersion(versionText);
  if (!version) return false;
  if (/^(?:file:|git\+|https?:|ssh:|workspace:|npm:)/i.test(spec)) return true;
  return String(spec).split('||').some((alternative) => {
    const normalized = alternative.trim().replace(/(>=|<=|>|<|=)\s+/g, '$1');
    const tokens = normalized.split(/\s+/).filter(Boolean);
    return tokens.every((token) => comparatorMatches(version, token));
  });
}

function resolvePackageEntry(packages, ownerKey, dependencyName) {
  let current = ownerKey;
  while (true) {
    const candidate = current
      ? `${current}/node_modules/${dependencyName}`
      : `node_modules/${dependencyName}`;
    if (packages[candidate]) return { key: candidate, entry: packages[candidate] };
    if (!current) return null;
    const marker = current.lastIndexOf('/node_modules/');
    if (marker >= 0) current = current.slice(0, marker);
    else current = '';
  }
}

function main() {
  const args = process.argv.slice(2);
  const lockArgIndex = args.indexOf('--lockfile');
  const lockPath = lockArgIndex >= 0 && args[lockArgIndex + 1]
    ? path.resolve(args[lockArgIndex + 1])
    : path.resolve(process.cwd(), 'package-lock.json');
  const packagePath = path.join(path.dirname(lockPath), 'package.json');

  let manifest;
  let lock;
  try {
    manifest = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  } catch (error) {
    console.error(`[FAIL] 无法读取 package.json / package-lock.json：${error.message}`);
    process.exitCode = 1;
    return;
  }

  const rootLock = lock.packages?.[''];
  const errors = [];
  if (!rootLock) errors.push('package-lock.json 缺少 packages[""] 根项目记录。');
  if (manifest.version !== lock.version || manifest.version !== rootLock?.version) {
    errors.push(`版本不一致：package.json=${manifest.version}，lock.version=${lock.version}，lock.packages[""]=${rootLock?.version}`);
  }

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const expected = manifest[field] || {};
    const actual = rootLock?.[field] || {};
    if (JSON.stringify(Object.fromEntries(Object.entries(expected).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(actual).sort()))) {
      errors.push(`根项目 ${field} 与 package.json 不一致。`);
    }
  }

  let checked = 0;
  const packages = lock.packages || {};
  for (const [ownerKey, ownerEntry] of Object.entries(packages)) {
    for (const field of ['dependencies', 'optionalDependencies']) {
      for (const [dependencyName, spec] of Object.entries(ownerEntry[field] || {})) {
        const target = resolvePackageEntry(packages, ownerKey, dependencyName);
        if (!target) {
          if (/^(?:file:|git\+|https?:|ssh:|workspace:|npm:)/i.test(spec)) continue;
          errors.push(`${ownerKey || '<root>'} 请求 ${dependencyName}@${spec}，但锁文件中找不到对应包。`);
          continue;
        }
        checked += 1;
        if (!satisfies(target.entry.version, spec)) {
          errors.push(`${ownerKey || '<root>'} 请求 ${dependencyName}@${spec}，但锁定的是 ${target.entry.version}（${target.key}）。`);
        }
      }
    }
  }

  if (errors.length) {
    for (const error of errors) console.error(`[FAIL] ${error}`);
    console.error(`[FAIL] package-lock 校验失败：${errors.length} 个问题，已检查 ${checked} 个依赖引用。`);
    process.exitCode = 1;
    return;
  }

  console.log(`[OK] package.json / package-lock.json 版本与根依赖一致。`);
  console.log(`[OK] ${checked} 个依赖引用均与锁定版本兼容。`);
}

main();
