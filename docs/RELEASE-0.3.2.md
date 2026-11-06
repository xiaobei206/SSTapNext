# SSTap Next 0.3.2 — TUN 优雅停止修正版

- 日期：2026-11-04
- 基线：用户已在 Windows 11 上成功构建并运行的 SSTap Next 0.3.1
- 目标版本：0.3.2（Windows x64）
- 本轮范围：修复 Agent 对 sing-box 的 Windows 控制台停止信号，强化退出确认和清理失败诊断。

## 1. 故障证据与根因

用户提供的 0.3.1 Agent 日志显示：

```text
[3/4] TUN 已启动：SSTap Next / Up / PID 38852
Agent 正在监视停止信号和桌面端心跳。
[4/4] 正在停止 sing-box 并等待 TUN 网卡移除…
```

随后会话状态变为 `cleanup_error`，核心 PID 变空，错误为 `TUN 接口 SSTap Next 仍然存在`。sing-box 日志中存在大量 `inbound/tun` 到 `outbound/vless[selected-proxy]` 的真实转发记录，说明故障集中在退出/清理阶段，而非启动阶段。

代码审查发现 `NativeConsoleProcess.StopGracefullyAsync()` 原先调用：

```csharp
GenerateConsoleCtrlEvent(CTRL_C_EVENT, _processId)
```

但 Windows API 文档明确规定，`CTRL_C_EVENT` 不能限制到指定进程组；当 `dwProcessGroupId` 非零时，调用可以成功返回，但指定组内进程不会收到 CTRL+C。项目又使用 `CREATE_NEW_PROCESS_GROUP`，因此原本的“定向 CTRL+C”逻辑实际上没有把退出信号送达 sing-box。随后等待 18 秒超时并执行 `TerminateProcess`，可能绕过 sing-box 正常关闭 Wintun 的清理路径。

Windows 下 Go 程序会将 CTRL+C 和 CTRL+BREAK 都转换为 `os.Interrupt`；`CTRL_BREAK_EVENT` 才是可以按进程组定向发送的控制事件。

## 2. 本轮修复

1. **修正停止信号**：将事件从 `CTRL_C_EVENT (0)` 改为 `CTRL_BREAK_EVENT (1)`，继续使用 `CREATE_NEW_PROCESS_GROUP` 和 sing-box PID 作为进程组 ID。不会向同一控制台中的其他进程广播 Ctrl+C。
2. **增加停止阶段日志**：明确记录是否成功发送 CTRL+BREAK、sing-box PID 是否响应退出，以及是否进入强制终止兜底。
3. **强制终止后验证进程退出**：不再忽略 `TerminateProcess` 与 `WaitForSingleObject` 结果。若不能确认核心退出，停止流程抛出错误，不允许报告清理成功。
4. **TUN 清理失败输出完整网卡信息**：加入网卡 Name、Description、Id、OperationalStatus、类型和地址，保存在 Agent 日志和 `status.json.lastError` 中。
5. **异常分支加强安全性**：核心可能仍在运行时写入 `cleanup_error` 并保留 PID，不再把它归类成普通 `error`，防止桌面端删除会话目录后启动第二个核心。
6. **兼容本次 0.3.1 遗留锁**：只对 `corePid=null`、接口名为 `SSTap Next` 且 `lastError` 命中 0.3.1 已知“接口仍然存在”错误文本的 `cleanup_error` 会话写入 `.legacy-cleanup-review-0.3.2` 标记；保留原 status、sing-box 日志和 session 文件，不删除或清理网卡。下次连接仍由 0.3.2 Agent 检查同名接口；如果接口仍为 Up，继续阻止接管。其他 `cleanup_error` 完全保持原有阻断行为。
7. **增加回归测试**：新增 3 项 Agent 停止信号/清理状态源码契约测试和 1 项已知 0.3.1 遗留锁迁移测试；原有测试不移除、不放宽。
8. **全项目版本号升级到 0.3.2**，包括 Electron、UI、Agent、构建脚本、doctor 和 User-Agent。

官方依据： [Microsoft GenerateConsoleCtrlEvent 文档](https://learn.microsoft.com/en-us/windows/console/generateconsolectrlevent) 说明 CTRL_C_EVENT 不能按进程组定向，而 CTRL_BREAK_EVENT 可以；[Go Windows 信号说明](https://go.dev/src/os/signal/doc.go) 说明 CTRL+C/CTRL+BREAK 都会映射为 `os.Interrupt`；[Wintun API 说明](https://github.com/WireGuard/wintun/blob/master/README.md) 说明 `WintunCloseAdapter` 会释放适配器资源，并在适配器由 `WintunCreateAdapter` 创建时移除设备。

## 3. 本轮未做的改动

- 没有放宽 `cleanup_error` 对真实活动残留接口的保护。
- 没有自动删除、禁用或重置任何 Windows 网络适配器。
- 没有改动路由/DNS 接管策略、节点配置、sing-box 版本或 Wintun 驱动版本。
- 没有把接口 Down 就等同于所有路由/DNS 均已恢复；只有核心正常退出且 TUN 接口符合原有会话资源清理判断，才会报告停止完成。

## 4. 验证结果与限制

| 检查 | 结果 | 说明 |
|---|---|---|
| Node 自动化测试 | PASS | 53/53；原有 49 项 + 3 项停止协议源码契约测试 + 1 项遗留锁迁移测试，0 失败 |
| JavaScript 语法 | PASS | 全部 `.cjs/.mjs` 执行 `node --check` |
| 版本一致性 | PASS | package/lock、Electron、UI、Agent、doctor、构建脚本同步为 0.3.2 |
| .NET 10 Agent 编译 | 当前环境未执行 | 当前容器未安装 .NET SDK |
| sing-box 18 项配置检查 | 未重新执行 | 本轮未改动配置生成；Windows Build-Windows.ps1 会在打包时重跑 |
| TypeScript/Vite 与 NSIS | 当前容器未执行 | 需要用户 Windows 构建环境 |
| 实际 CTRL+BREAK / Wintun 清理 | 必须 Windows 实机验证 | 当前开发容器不能创建 Windows 控制台进程组或真实 Wintun 接口 |

## 5. Windows 构建与验收

在 Windows 11 解压目录执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

预期安装包：

`release\SSTap Next-0.3.2-x64.exe`

安装 0.3.2 后，使用原有有效节点进行一次系统 TUN 连接，然后从应用内正常断开。正常情况下 Agent 日志应出现：

```text
[STOP] 已向 sing-box 进程组 <PID> 发送 CTRL+BREAK
[STOP] sing-box PID <PID> 已响应退出信号并结束。
[STOP] sing-box PID <PID> 已退出（graceful=True）。等待 Wintun 接口释放…
[OK] 本次 TUN 会话已断开，适配器已移除。
```

之后再进行第二次 TUN 连接，以验证同名接口可重新创建。不要手动删除网卡，也不要重置网络。

若仍发生 `cleanup_error`，新版日志会直接包含残留网卡 ID、状态和 IP 地址；保留现场，不要反复连接。
