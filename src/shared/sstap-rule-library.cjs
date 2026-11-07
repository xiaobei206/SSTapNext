'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { parseSstapRule } = require('./sstap-rule-parser.cjs');

const UPSTREAM = 'FQrabbit/SSTap-Rule';
const API_BASE = 'https://api.github.com';
const MAX_ARCHIVE_BYTES = 24 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 40 * 1024 * 1024;
const MAX_RULE_FILES = 240;
let updatePromise = null;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function extractSstapZip(archive) {
  const data = Buffer.isBuffer(archive) ? archive : Buffer.from(archive);
  if (data.length < 22 || data.length > MAX_ARCHIVE_BYTES) throw new Error('SSTap 规则压缩包大小异常');
  let eocd = -1;
  const searchFrom = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= searchFrom; i -= 1) {
    if (data.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('规则压缩包缺少 ZIP 目录结束标记');
  const disk = data.readUInt16LE(eocd + 4);
  const centralDisk = data.readUInt16LE(eocd + 6);
  const diskEntries = data.readUInt16LE(eocd + 8);
  const entryCount = data.readUInt16LE(eocd + 10);
  const centralSize = data.readUInt32LE(eocd + 12);
  const centralOffset = data.readUInt32LE(eocd + 16);
  if (disk || centralDisk || diskEntries !== entryCount || entryCount === 0xffff
    || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('不支持分卷或 ZIP64 规则压缩包');
  }
  if (entryCount > 2000 || centralOffset + centralSize > eocd) throw new Error('ZIP 中央目录超出安全范围');
  const extracted = new Map();
  let cursor = centralOffset;
  let totalSize = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > data.length || data.readUInt32LE(cursor) !== 0x02014b50) throw new Error('ZIP 中央目录结构损坏');
    const flags = data.readUInt16LE(cursor + 8);
    const method = data.readUInt16LE(cursor + 10);
    const expectedCrc = data.readUInt32LE(cursor + 16);
    const compressedSize = data.readUInt32LE(cursor + 20);
    const uncompressedSize = data.readUInt32LE(cursor + 24);
    const nameLength = data.readUInt16LE(cursor + 28);
    const extraLength = data.readUInt16LE(cursor + 30);
    const commentLength = data.readUInt16LE(cursor + 32);
    const localOffset = data.readUInt32LE(cursor + 42);
    const nameEnd = cursor + 46 + nameLength;
    const next = nameEnd + extraLength + commentLength;
    if (next > data.length) throw new Error('ZIP 文件名或扩展字段越界');
    const rawName = data.subarray(cursor + 46, nameEnd).toString('utf8');
    cursor = next;
    const normalized = rawName.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error('ZIP 包含不安全路径');
    }
    const ruleMatch = normalized.match(/^[^/]+\/rules\/(.+\.rules)$/i);
    const isLicense = /^[^/]+\/LICENSE$/i.test(normalized);
    if (!ruleMatch && !isLicense) continue;
    if (flags & 1) throw new Error(`ZIP 条目加密，不支持：${rawName}`);
    if (![0, 8].includes(method)) throw new Error(`ZIP 压缩算法不支持：${rawName}`);
    if (uncompressedSize > 16 * 1024 * 1024 || compressedSize > data.length) throw new Error(`ZIP 条目大小异常：${rawName}`);
    if (localOffset + 30 > data.length || data.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`ZIP 本地文件头损坏：${rawName}`);
    const localNameLength = data.readUInt16LE(localOffset + 26);
    const localExtraLength = data.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const end = start + compressedSize;
    if (end > data.length) throw new Error(`ZIP 数据越界：${rawName}`);
    const compressed = data.subarray(start, end);
    let output;
    try {
      output = method === 0 ? Buffer.from(compressed) : zlib.inflateRawSync(compressed, { maxOutputLength: uncompressedSize + 1 });
    } catch (error) {
      throw new Error(`ZIP 解压失败：${rawName}：${error.message}`);
    }
    if (output.length !== uncompressedSize || crc32(output) !== expectedCrc) throw new Error(`ZIP 校验失败：${rawName}`);
    totalSize += output.length;
    if (totalSize > MAX_EXTRACTED_BYTES) throw new Error('规则压缩包解压后超过 40 MB 安全上限');
    if (ruleMatch) {
      const relative = ruleMatch[1];
      if (relative.includes('\\') || relative.split('/').some((part) => !part || part === '..')) throw new Error('规则文件路径异常');
      extracted.set(`rules/${relative}`, output);
    } else if (isLicense) extracted.set('LICENSE', output);
  }
  if (!extracted.has('LICENSE')) throw new Error('上游压缩包缺少 Apache LICENSE 文件');
  if (!extracted.has('rules/BypassCNandLan.rules')) throw new Error('上游压缩包缺少核心规则 BypassCNandLan.rules');
  if ([...extracted.keys()].filter((name) => name.endsWith('.rules')).length > MAX_RULE_FILES) throw new Error('上游规则文件数量超过安全上限');
  return extracted;
}

async function readResponseLimited(response, maxBytes, label) {
  if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`${label}超过大小限制`);
  if (!response.body) throw new Error(`${label}没有响应内容`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`${label}超过大小限制`);
      }
      chunks.push(Buffer.from(item.value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}

async function fetchJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SSTapNext-Rule-Updater' },
      redirect: 'follow',
      signal: controller.signal,
    });
    const data = await readResponseLimited(response, 1024 * 1024, '上游版本信息下载');
    return JSON.parse(data.toString('utf8'));
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接上游规则仓库超时');
    throw error;
  } finally { clearTimeout(timer); }
}

async function fetchBuffer(url, maxBytes, label, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'SSTapNext-Rule-Updater', Accept: 'application/zip, application/octet-stream, */*' },
      redirect: 'follow',
      signal: controller.signal,
    });
    return await readResponseLimited(response, maxBytes, label);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(`${label}超时`);
    throw error;
  } finally { clearTimeout(timer); }
}

function libraryPaths(userDataPath) {
  const root = path.join(userDataPath, 'rules', 'sstap-rule-library');
  return { root, versions: path.join(root, 'versions'), pointer: path.join(root, 'current.json') };
}

async function readCurrent(userDataPath) {
  const paths = libraryPaths(userDataPath);
  try {
    const pointer = JSON.parse(await fs.readFile(paths.pointer, 'utf8'));
    if (typeof pointer.version !== 'string' || !/^[a-f0-9]{40}$/i.test(pointer.version)) throw new Error('规则库版本指针无效');
    const directory = path.join(paths.versions, pointer.version);
    const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
    if (manifest.version !== pointer.version || !Array.isArray(manifest.rules)) throw new Error('规则库清单校验失败');
    return { paths, directory, manifest };
  } catch (error) {
    if (error.code === 'ENOENT') return { paths, directory: null, manifest: null };
    throw error;
  }
}

function publicManifest(manifest) {
  if (!manifest) return { installed: false, source: UPSTREAM, revision: null, updatedAt: null, ruleCount: 0, totalCidrs: 0, rules: [], skipped: [] };
  return {
    installed: true,
    source: UPSTREAM,
    revision: manifest.version,
    updatedAt: manifest.updatedAt,
    ruleCount: manifest.rules.length,
    totalCidrs: manifest.totalCidrs,
    skipped: manifest.skipped,
    license: manifest.license,
    rules: manifest.rules.map(({ id, fileName, displayName, routeAction, cidrCount, ipv4Count, ipv6Count, isReadOnly, author, sourceSha256 }) => ({
      id, fileName, displayName, routeAction, cidrCount, ipv4Count, ipv6Count, isReadOnly, author, sourceSha256,
    })),
  };
}

async function getSstapRuleLibrary(userDataPath) {
  const current = await readCurrent(userDataPath);
  return publicManifest(current.manifest);
}

async function updateSstapRuleLibrary(userDataPath, options = {}) {
  if (updatePromise) return updatePromise;
  updatePromise = (async () => {
    const paths = libraryPaths(userDataPath);
    await fs.mkdir(paths.versions, { recursive: true });
    const commit = options.sourceCommit || await fetchJson(`${API_BASE}/repos/${UPSTREAM}/commits/master`);
    const revision = String(commit.sha || '');
    if (!/^[a-f0-9]{40}$/i.test(revision)) throw new Error('上游返回的 Git commit SHA 无效');
    const current = await readCurrent(userDataPath);
    if (current.manifest?.version === revision) return { ...publicManifest(current.manifest), unchanged: true };
    const archive = options.archiveBuffer || await fetchBuffer(
      `https://codeload.github.com/${UPSTREAM}/zip/${revision}`,
      MAX_ARCHIVE_BYTES,
      'SSTap 规则包下载',
    );
    const entries = extractSstapZip(archive);
    const stage = path.join(paths.versions, `.staging-${crypto.randomUUID()}`);
    const finalDirectory = path.join(paths.versions, revision);
    await fs.mkdir(path.join(stage, 'rules'), { recursive: true });
    const rules = [];
    const skipped = [];
    let totalCidrs = 0;
    try {
      const ruleEntries = [...entries.entries()].filter(([name]) => name.startsWith('rules/') && name.endsWith('.rules'));
      for (const [sourcePath, bytes] of ruleEntries) {
        try {
          const parsed = parseSstapRule(bytes, sourcePath);
          const outputName = `${parsed.id}.json`;
          await fs.writeFile(path.join(stage, 'rules', outputName), JSON.stringify(parsed.ruleSet), { flag: 'wx' });
          const { ruleSet, ...metadata } = parsed;
          metadata.outputFile = `rules/${outputName}`;
          rules.push(metadata);
          totalCidrs += parsed.cidrCount;
        } catch (error) {
          skipped.push({ fileName: path.basename(sourcePath), reason: String(error.message || error).slice(0, 500) });
        }
      }
      if (rules.length < 10) throw new Error(`有效 SSTap 规则数量异常，仅转换出 ${rules.length} 条`);
      const bypass = rules.find((item) => item.fileName.toLowerCase() === 'bypasscnandlan.rules');
      if (!bypass || bypass.routeAction !== 'direct') throw new Error('中国大陆直连规则缺失或默认动作不是 Direct');
      await fs.writeFile(path.join(stage, 'LICENSE'), entries.get('LICENSE'));
      const manifest = {
        schemaVersion: 1,
        source: UPSTREAM,
        license: 'Apache-2.0',
        version: revision,
        updatedAt: new Date().toISOString(),
        ruleCount: rules.length,
        totalCidrs,
        rules,
        skipped,
      };
      await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
      if (options.validateManifest) await options.validateManifest(manifest, stage);
      try { await fs.rename(stage, finalDirectory); }
      catch (error) {
        if (error.code !== 'EEXIST' && error.code !== 'ENOTEMPTY') throw error;
        await fs.rm(stage, { recursive: true, force: true });
      }
      const tempPointer = `${paths.pointer}.${crypto.randomUUID()}.tmp`;
      await fs.writeFile(tempPointer, JSON.stringify({ version: revision, updatedAt: manifest.updatedAt }));
      await fs.rename(tempPointer, paths.pointer);
      const dirs = (await fs.readdir(paths.versions, { withFileTypes: true }))
        .filter((item) => item.isDirectory() && /^[a-f0-9]{40}$/i.test(item.name))
        .map((item) => item.name).filter((name) => name !== revision);
      const previousVersions = [];
      for (const name of dirs) {
        let updatedAt = '';
        try {
          const saved = JSON.parse(await fs.readFile(path.join(paths.versions, name, 'manifest.json'), 'utf8'));
          updatedAt = typeof saved.updatedAt === 'string' ? saved.updatedAt : '';
        } catch { /* an incomplete orphan revision is ranked oldest */ }
        previousVersions.push({ name, updatedAt });
      }
      previousVersions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      for (const old of previousVersions.slice(2)) await fs.rm(path.join(paths.versions, old.name), { recursive: true, force: true });
      return publicManifest(manifest);
    } catch (error) {
      await fs.rm(stage, { recursive: true, force: true });
      throw error;
    }
  })().finally(() => { updatePromise = null; });
  return updatePromise;
}

async function getEnabledSstapRuleSets(userDataPath, enabledRuleIds = [], mode = 'global') {
  const current = await readCurrent(userDataPath);
  if (!current.manifest) {
    if (enabledRuleIds.length) throw new Error('已启用的 SSTap 规则库不存在；请先在分流模式页面更新规则库。');
    return [];
  }
  const ids = new Set(Array.isArray(enabledRuleIds) ? enabledRuleIds : []);
  if (mode === 'bypass-cn') {
    const cn = current.manifest.rules.find((item) => item.fileName.toLowerCase() === 'bypasscnandlan.rules');
    if (!cn) throw new Error('SSTap 中国大陆规则库缺失；请更新规则库。');
    ids.add(cn.id);
  }
  const selected = current.manifest.rules.filter((item) => ids.has(item.id));
  // The automatic broad China IP bypass must come after explicitly selected
  // game rules. Otherwise an overlapping CN CIDR would match Direct first and
  // silently defeat a user's game-specific Proxy rule.
  const ordered = mode === 'bypass-cn'
    ? [
      ...selected.filter((item) => item.fileName.toLowerCase() !== 'bypasscnandlan.rules'),
      ...selected.filter((item) => item.fileName.toLowerCase() === 'bypasscnandlan.rules'),
    ]
    : selected;
  const result = [];
  for (const item of ordered) {
    if (!/^sstap-[a-f0-9]{16}$/.test(item.id) || !/^rules\/sstap-[a-f0-9]{16}\.json$/.test(item.outputFile)) {
      throw new Error(`SSTap 规则清单包含不安全文件路径：${item.fileName}`);
    }
    const file = path.join(current.directory, item.outputFile);
    await fs.access(file);
    result.push({ tag: item.id.replace(/-/g, '_'), path: file, action: item.routeAction, fileName: item.fileName });
  }
  return result;
}

module.exports = {
  UPSTREAM,
  crc32,
  extractSstapZip,
  getSstapRuleLibrary,
  updateSstapRuleLibrary,
  getEnabledSstapRuleSets,
};
