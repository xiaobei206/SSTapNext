import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('0.3.7 release UI, DNS and manual core-update contracts remain present', () => {
  const css = read('apps/desktop/src/renderer/src/style.css');
  const main = read('apps/desktop/src/renderer/src/main.tsx');
  const electronMain = read('apps/desktop/src/main/index.cjs');
  const build = read('scripts/Build-Windows.ps1');
  const coreDocs = read('docs/CORE-UPGRADE.md');

  const fontSizes = [...css.matchAll(/font-size\s*:\s*([0-9.]+)px/g)].map((match) => Number(match[1]));
  assert.ok(fontSizes.length >= 80, 'global stylesheet should retain broad typography coverage');
  assert.ok(Math.min(...fontSizes) >= 14, 'small UI fonts should be at least 14px');
  assert.match(css, /\.connect-button\.ready:hover:not\(:disabled\)/);
  assert.match(css, /\.connect-button\.ready:active:not\(:disabled\)/);
  assert.match(css, /\.connect-button:focus-visible/);
  assert.match(main, /value="prefer_ipv6"/);
  assert.match(main, /connect-disabled-reason/);
  assert.match(electronMain, /SPEED_TEST_FALLBACK_URLS/);
  assert.match(electronMain, /bom\.proof\.ovh\.net/);
  assert.match(electronMain, /speedtest\.tele2\.net/);
  assert.match(electronMain, /sstap:core-open-folder/);
  assert.match(electronMain, /请先断开系统 TUN，再修改 DNS 地址族策略/);
  assert.match(build, /当前核心（\$coreVersionLine）/);
  assert.match(coreDocs, /sing-box\.exe/);
  assert.match(coreDocs, /SHA-256/);
});

test('SSTap rule updates and routing-setting mutations are mutually exclusive with TUN lifecycle', () => {
  const electronMain = read('apps/desktop/src/main/index.cjs');
  const tunController = read('src/shared/tun-controller.cjs');
  const renderer = read('apps/desktop/src/renderer/src/main.tsx');

  assert.match(tunController, /isRuleLibraryMutationLocked\(\)/);
  assert.match(tunController, /this\.session \|\| this\.startPromise \|\| this\.stopPromise \|\| this\.recoveryPromise/);
  assert.match(electronMain, /let ruleLibraryUpdating = false/);
  assert.match(electronMain, /tun\.isRuleLibraryMutationLocked\(\)/);
  assert.match(electronMain, /ruleLibraryUpdating = true/);
  assert.match(electronMain, /finally \{\s*ruleLibraryUpdating = false/);
  assert.match(electronMain, /SSTap 规则库正在下载和转换，请完成后再启动系统 TUN/);
  assert.match(renderer, /'cleanup_error'\]\.includes\(tunStatus\.status/);
  assert.match(renderer, /ruleLibraryBusy=\{ruleLibraryBusy\}/);
});
