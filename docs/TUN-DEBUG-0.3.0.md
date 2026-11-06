# SSTap Next 0.3.0 — TUN 端到端故障排查记录

- 时间：2026-11-03（Asia/Shanghai）
- 环境：Windows 11 x64、PowerShell 5.1、.NET SDK 10.0.403、Node 26.13.0
- 用户报告错误：`sstap:tun-connect: InvalidOperationException: TUN 网卡在 35 秒内没有进入 Up 状态。`

---

## 1. 权限与驱动核实（有证据）

| 项 | 结论 | 证据 |
|---|---|---|
| 当前用户 | `homethree\edison`，非管理员，token 未提权 | `whoami` + `IsInRole(Administrator)=False` |
| UAC | 已启用，consent level 5 | 注册表 `ConsentPromptBehaviorAdmin=5`、`EnableLUA=1` |
| Agent 是否成功提权 | **是** | `C:\Windows\System32\drivers\wintun.sys`（29592 B）于 18:12 被写入——安装内核驱动必须管理员权限，证明 UAC 提权链路正常 |
| Wintun 驱动 | 已安装（内核服务 `wintun`，STATE=STOPPED 属按需加载） | `sc.exe query wintun` |
| sing-box 是否自带 Wintun | **是** | `findstr /i "wintun" sing-box.exe` 命中 `WintunCreateAdapter` / `sing-tun` |
| 非管理员复现 | `sing-box run`（no-route TUN）→ `configure tun interface: Access is denied` | 直接运行 sing-box（非提权） |

## 2. 无路由 smoke test 实测（UAC 已获批准，跑 3 次）

**关键结论：Wintun 网卡创建、命名、Up 状态全部正常。**

适配器报告（`%LOCALAPPDATA%\SSTapNext\Logs\tun-smoke-adapter-*.txt`）：

```
Name: SSTap Next Test
Description: sing-tun Tunnel #2
OperationalStatus: Up (1)
NetworkInterfaceType: 53
Addresses: fe80::.../64, 172.31.254.1/30
```

sing-box 日志：`inbound/tun[tun-smoke]: started at SSTap Next Test`、`sing-box started (0.72s)`。

即：**网卡不是“没 Up”**，网卡 Up、名字正确、地址正确。原 Agent 的按 `Name + OperationalStatus.Up` 检测在这台机器上其实是能命中网卡的；真正暴露出来的是**退出/清理阶段的 bug**。

## 3. 本轮发现并修复的真实 bug（有证据）

1. **`NativeConsoleProcess.StopGracefullyAsync` 用 `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)` 自杀**
   - 现象：smoke test 走到 `[5/5]` 后 Agent 自身退出码 `-1073741510`（`0xC000013A` = STATUS_CONTROL_C_EXIT）。
   - 根因：group id `0` = 广播给“本进程所在控制台上的所有进程”，`AttachConsole(子进程)` 后 Agent 也在这个控制台上，于是 Agent 被自己发的 Ctrl+C 杀掉（`SetConsoleCtrlHandler(NULL, TRUE)` 未能保护 .NET 进程）。
   - 修复：`GenerateConsoleCtrlEvent(CTRL_C_EVENT, 子进程PID)` 只发给子进程自己的进程组；并用 `CREATE_NEW_PROCESS_GROUP`（**单独**，不能与 `CREATE_NEW_CONSOLE` 并用，否则被忽略）让子进程成为组长。

2. **`Run-Tun-SmokeTest.ps1` 在 UAC 被取消时误报成功（exit 0）**
   - 根因：`$ErrorActionPreference='Continue'` + UAC 取消后 `$process` 为 null，`exit $process.ExitCode` 走空导致 exit 0。
   - 修复：`-ErrorAction SilentlyContinue` + 显式 `if (-not $process) { exit 1223 }`（1223=ERROR_CANCELLED）。

3. **smoke test `[5/5]` 把“非优雅退出”当作 FAIL（exit 24）**
   - 根因：硬杀也能移除网卡（实测无残留），优雅退出只是加分项；与 TunRuntime 的 `stopped_with_warning` 语义不一致。
   - 修复：非优雅退出降级为 `[WARN]`，仍以“网卡是否移除”为真正通过条件。

4. **TUN 网卡检测健壮性 + 诊断（`TunRuntime.cs` / `TunSmokeTest.cs`）**
   - `TunRuntime.WaitForAdapterAsync`：按 名称/描述 **或** 已分配 TUN 地址 `172.19.0.1` 匹配；有地址即视为“已配置就绪”并打印真实 `OperationalStatus`；超时把**所有网络接口** dump 进错误信息。
   - `TunSmokeTest`：新增适配器报告文件 + 接口 dump + 失败信息带真实状态。
   - `Program.cs`：`--tun-smoke-test` / `--tun-run` / `--tun-diagnostic` 提权时把 stdout/stderr tee 到 `%LOCALAPPDATA%\SSTapNext\Logs\agent-*.log`（提权进程控制台不可见时也能诊断）。

5. **新增 `--tun-diagnostic` 双栈诊断命令**
   - 用**真实 TUN 入站特征**（`interface_name=SSTap Next`、双栈地址 `172.19.0.1/30 + fdfe:dcba:9876::1/126`）但 `auto_route=false`、`dns_mode=disabled`，只验证网卡创建，不改路由/DNS。用于隔离“IPv6 双栈地址”是否导致真实 TUN 启动失败。

## 4. 根因已定论并修复：`detour: "direct"` 指向空 direct 出站

`--tun-diagnostic`（双栈、auto_route=false）通过，证明网卡创建/双栈没问题。`--tun-diagnostic-full`（auto_route=true）复现了“35 秒未 Up”，并捕获到 sing-box 的 FATAL：

```
FATAL: start service: start dns-transport: start dns/udp[dns-direct]: detour to an empty direct outbound makes no sense
```

sing-box 1.14 的 direct 出站 `IsEmpty()` 在无 `bind_interface`/`bind_address` 等显式字段时为真，DNS server 的 `detour: "direct"` 指向该空 direct 出站时在**运行时**被拒绝（`sing-box check` 不报，`run` 才报）。真实配置里 `dns-bootstrap` / `dns-cn` 正是 `detour: "direct"`。

修复（DNS transport 在 1.14 默认走 direct + `route.auto_detect_interface`，无需显式 detour）：

- `src/shared/tun-config.cjs`：移除 `dns-bootstrap`、`dns-cn` 的 `detour: 'direct'`；同时移除 `http_clients[ruleset-download]` 的 `detour: 'direct'`（同样的运行时拒绝），并修正规则集 URL 为 `...@sing/geo/geosite/cn.srs` / `...@sing/geo/geoip/cn.srs`（原路径少了 `geo/` 前缀，404）。
- `src/agent/.../TunRuntime.cs`：`ValidateRestrictedTunConfig` 不再要求 `dns-bootstrap.detour == "direct"`。
- `src/shared/tun-config.test.mjs`：断言改为 `detour === undefined`，`http_clients` 断言改为 `[{ tag: 'ruleset-download' }]`。

验证：`--tun-diagnostic-full`（auto_route=true + strict_route=true + dns_mode=hijack）从 exit 21 → **exit 0**：

```
[OK] 找到接口：SSTap FullDiag / sing-tun Tunnel #4 / OperationalStatus=Up
[RESULT] 默认路由恢复=True 非测试网卡路由恢复=True DNS恢复=True
```

即：网卡 Up、默认路由/DNS 短暂接管后全部恢复一致。

## 5. 修改文件

- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`（检测健壮性 + 诊断 dump + StopGracefullyAsync 进程组修复 + 去掉 dns-bootstrap detour 校验）
- `src/agent/SstapNext.Agent/Core/TunSmokeTest.cs`（适配器报告、接口 dump、`StopGracefullyAsync` 进程组修复、`[5/5]` 语义、`--tun-diagnostic`、`--tun-diagnostic-full`）
- `src/agent/SstapNext.Agent/Program.cs`（提权 tee 日志 + `--tun-diagnostic` / `--tun-diagnostic-full` 派发）
- `scripts/Run-Tun-SmokeTest.ps1`（UAC 取消 → exit 1223）
- `src/shared/tun-config.cjs`（移除 `dns-bootstrap`/`dns-cn` 的 `detour: 'direct'`）
- `src/shared/tun-config.test.mjs`（断言同步）

## 6. 构建与产物

完整构建持续通过：`npm test` 49/49、`validate:core` 18/18、`dotnet publish` 成功、TS/Vite 成功、NSIS 成功。

- 安装包：`release\SSTap Next-0.3.0-x64.exe`（约 166.75 MB，哈希随每次构建变化，见 `build-0.3.0.log` 末尾）
- Agent：`artifacts\agent-win-x64\SstapNext.Agent.exe`

