'use strict';

const net = require('node:net');
const crypto = require('node:crypto');

const MAX_RULE_BYTES = 16 * 1024 * 1024;
const MAX_CIDRS = 1_000_000;

function validateCidr(value, line) {
  const input = String(value || '').trim();
  if (!input || input.length > 80 || /[\s,]/.test(input)) throw new Error(`第 ${line} 行：CIDR 格式无效`);
  const parts = input.split('/');
  if (parts.length > 2) throw new Error(`第 ${line} 行：CIDR 前缀格式无效`);
  const address = parts[0];
  const family = net.isIP(address);
  if (!family) throw new Error(`第 ${line} 行：不是有效的 IPv4/IPv6 地址：${input}`);
  const prefixText = parts[1];
  if (prefixText !== undefined && !/^\d+$/.test(prefixText)) throw new Error(`第 ${line} 行：CIDR 前缀格式无效：${input}`);
  const prefix = prefixText === undefined ? (family === 4 ? 32 : 128) : Number(prefixText);
  const max = family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max) throw new Error(`第 ${line} 行：CIDR 前缀超出范围：${input}`);
  return { cidr: `${address}/${prefix}`, family };
}

function parseSstapRule(input, sourcePath = 'import.rules') {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ''), 'utf8');
  if (!buffer.length || buffer.length > MAX_RULE_BYTES) throw new Error('SSTap 规则文件为空或超过 16 MB');
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\uFEFF/, '');
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex < 0) throw new Error('规则文件没有内容');
  const header = lines[headerIndex].trim();
  if (!header.startsWith('#')) throw new Error('SSTap 规则第一行必须是 # 开头的规则头');
  const fields = header.slice(1).split(',').map((item) => item.trim());
  if (fields.length < 3 || !fields[0]) throw new Error('SSTap 规则头字段不足：至少需要英文标识、显示名称和动作类型');
  const actionCode = fields[2];
  if (actionCode !== '0' && actionCode !== '1') throw new Error(`不支持的 SSTap 默认动作：${actionCode}（0=代理，1=直连）`);
  const routeAction = actionCode === '0' ? 'proxy' : 'direct';
  const displayName = fields[1] || fields[0];
  const cidrs = [];
  const seen = new Set();
  let duplicates = 0;
  let ipv4Count = 0;
  let ipv6Count = 0;
  const errors = [];
  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('//')) continue;
    try {
      const parsed = validateCidr(raw, i + 1);
      if (seen.has(parsed.cidr)) { duplicates += 1; continue; }
      seen.add(parsed.cidr);
      cidrs.push(parsed.cidr);
      if (parsed.family === 4) ipv4Count += 1;
      else ipv6Count += 1;
      if (cidrs.length > MAX_CIDRS) throw new Error('单个规则文件超过 100 万条 CIDR 上限');
    } catch (error) {
      errors.push(error.message);
      if (errors.length >= 20) break;
    }
  }
  if (errors.length) throw new Error(`规则文件包含无效行，拒绝部分导入：${errors.slice(0, 8).join('；')}`);
  if (!cidrs.length) throw new Error('规则文件没有任何有效 CIDR');
  const normalizedPath = String(sourcePath).replace(/\\/g, '/').replace(/^.*?rules\//i, '').replace(/^\/+/, '');
  const fileName = normalizedPath.split('/').pop() || 'import.rules';
  const id = `sstap-${crypto.createHash('sha256').update(normalizedPath.toLowerCase()).digest('hex').slice(0, 16)}`;
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    id,
    tag: id.replace(/-/g, '_'),
    sourcePath: normalizedPath,
    fileName,
    englishName: fields[0],
    displayName,
    routeAction,
    actionCode,
    dnsProxyType: fields[7] || '0',
    isReadOnly: fields[6] === '1',
    author: fields.slice(8).join(','),
    cidrCount: cidrs.length,
    ipv4Count,
    ipv6Count,
    duplicateCount: duplicates,
    sourceSha256: digest,
    sourceBytes: buffer.length,
    ruleSet: { version: 1, rules: [{ ip_cidr: cidrs }] },
  };
}

module.exports = { MAX_RULE_BYTES, MAX_CIDRS, validateCidr, parseSstapRule };
