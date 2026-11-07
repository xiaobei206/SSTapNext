import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const agentSourcePath = path.resolve(here, '../agent/SstapNext.Agent/Core/TunSmokeTest.cs');
const runtimeSourcePath = path.resolve(here, '../agent/SstapNext.Agent/Core/TunRuntime.cs');

const [agentSource, runtimeSource] = await Promise.all([
  fs.readFile(agentSourcePath, 'utf8'),
  fs.readFile(runtimeSourcePath, 'utf8'),
]);

test('Windows sing-box shutdown targets its process group with CTRL+BREAK', () => {
  assert.match(agentSource, /private const uint CtrlBreakEvent\s*=\s*1\s*;/);
  assert.match(agentSource, /GenerateConsoleCtrlEvent\(CtrlBreakEvent,\s*_processId\)/);
  assert.doesNotMatch(agentSource, /GenerateConsoleCtrlEvent\(CtrlCEvent,\s*_processId\)/);
});

test('forced sing-box termination must be confirmed before TUN cleanup is reported', () => {
  assert.match(agentSource, /var forcedWait\s*=\s*WaitForSingleObject\(_processHandle,\s*5000\)/);
  assert.match(runtimeSource, /if\s*\(!child\.HasExited\)/);
  assert.match(runtimeSource, /为避免在核心仍运行时重新接管 TUN/);
});

test('cleanup failure includes the remaining adapter identity and state', () => {
  assert.match(runtimeSource, /DescribeAdapter\(remainingAdapter\)/);
  assert.match(runtimeSource, /Id=\{adapter\.Id\}; Status=\{adapter\.OperationalStatus\}/);
});


test('successful TUN cleanup uses a distinct local name for the retained adapter (CS0136 regression)', () => {
  assert.match(runtimeSource, /var remainingAdapter = FindAdapter\(session\.InterfaceName\);/);
  assert.match(runtimeSource, /var retainedAdapter = FindAdapter\(session\.InterfaceName\);/);
  assert.match(runtimeSource, /retainedAdapter is null/);
  assert.match(runtimeSource, /retainedAdapter\.Name/);
});


test('Agent cache-path allowlist permits only the three DNS-strategy cache files', () => {
  for (const file of ['sing-box-cache-ipv4.db', 'sing-box-cache-dual-ipv4.db', 'sing-box-cache-dual-ipv6.db']) {
    assert.ok(runtimeSource.includes(file), `Agent must allow ${file}`);
  }
  assert.match(runtimeSource, /cacheFileName is not/);
  assert.doesNotMatch(runtimeSource, /Path\.Combine\(userDataDirectory, "cache", "sing-box-cache\.db"\)/);
});


test('a persistent Down Wintun adapter without the TUN address is treated as released', () => {
  assert.match(runtimeSource, /private static bool IsAdapterOperationallyActive\(NetworkInterface adapter\)/);
  assert.match(runtimeSource, /adapter\.OperationalStatus == OperationalStatus\.Up \|\| HasExpectedTunAddress\(adapter\)/);
  assert.match(runtimeSource, /if \(!IsAdapterOperationallyActive\(current\)\) return false;/);
  assert.match(runtimeSource, /Windows 保留了 Wintun 适配器对象/);
});

test('active or still-addressed TUN adapters remain protected as cleanup residuals', () => {
  assert.match(runtimeSource, /return adapter\.OperationalStatus == OperationalStatus\.Up \|\| HasExpectedTunAddress\(adapter\);/);
  assert.match(runtimeSource, /WaitForAdapterRemovalAsync\(session\.InterfaceName, AdapterRemovalTimeout, preExistingAdapterSnapshot\)/);
  assert.match(runtimeSource, /cleanup_error/);
});

test('legacy adapter absence requires complete interface enumeration and a stopped sing-box PID', () => {
  assert.match(runtimeSource, /inspectionComplete = true/);
  assert.match(runtimeSource, /NetworkInterface\.GetAllNetworkInterfaces\(\)/);
  assert.match(runtimeSource, /Process\.GetProcessById\(processId\)/);
  assert.match(runtimeSource, /relatedAdapters/);
  assert.match(runtimeSource, /processCheckComplete = process\.CheckComplete/);
});
