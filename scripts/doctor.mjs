#!/usr/bin/env node
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const checks = [];

function add(name, status, detail) { checks.push({ name, status, detail }); }
function exists(relative) { return fs.existsSync(path.join(root, relative)); }

const nodeMajor = Number(process.versions.node.split('.')[0]);
add('Node.js', nodeMajor >= 22 ? 'PASS' : 'FAIL', `v${process.versions.node}（要求 >=22）`);
add('项目版本', pkg.version === '0.3.7' ? 'PASS' : 'WARN', `${pkg.productName || pkg.name} ${pkg.version}`);
add('npm 依赖', exists('node_modules') ? 'PASS' : 'WARN', exists('node_modules') ? 'node_modules 已存在' : '尚未安装；运行 npm.cmd install');
add('sing-box 核心', exists('runtime/sing-box/sing-box.exe') ? 'PASS' : 'WARN', exists('runtime/sing-box/sing-box.exe') ? 'runtime/sing-box/sing-box.exe' : '尚未下载；运行 scripts\\Fetch-SingBox.ps1');
add('.NET Agent', exists('artifacts/agent-win-x64/SstapNext.Agent.exe') ? 'PASS' : 'WARN', exists('artifacts/agent-win-x64/SstapNext.Agent.exe') ? '已发布' : '尚未发布；运行 scripts\\Publish-Agent.ps1');
add('前端构建产物', exists('dist/renderer/index.html') ? 'PASS' : 'WARN', exists('dist/renderer/index.html') ? '已构建' : '尚未构建；运行 npm.cmd run build');
add('Windows 安装包', fs.existsSync(path.join(root, 'release')) && fs.readdirSync(path.join(root, 'release')).some((name) => name.endsWith('.exe')) ? 'PASS' : 'WARN', '运行 scripts\\Build-Windows.ps1 生成');

let failed = false;
console.log(`SSTap Next ${pkg.version} 环境诊断\n${'='.repeat(36)}`);
for (const item of checks) {
  const mark = item.status === 'PASS' ? '[OK]' : item.status === 'FAIL' ? '[FAIL]' : '[待办]';
  console.log(`${mark.padEnd(8)} ${item.name.padEnd(18)} ${item.detail}`);
  if (item.status === 'FAIL') failed = true;
}
console.log('\n说明：此诊断只读取文件和版本信息，不启动代理、不创建虚拟网卡、不修改路由或 DNS。');
if (failed) process.exitCode = 1;
