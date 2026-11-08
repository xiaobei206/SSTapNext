# SSTap Next 0.3.18 — TUN 孤儿会话安全恢复（待发布）

状态：**已正式发布（2026-11-08）**。v0.3.17 已自动发布，但早于最终 Agent 存活检查补丁；保留其资产，不覆盖。完整修复版本 v0.3.18 已完成构建和发布。

## 问题

Windows 实机启动时，旧 TUN 会话状态仍为 running，但 Agent 与 sing-box 已退出。旧恢复逻辑只写 stop.signal 并等待 30 秒，已死亡 Agent 不会处理信号。正常 Agent 停止预算 18 秒 + 18 秒也超过 30 秒窗口。

## 修复

- 仅对运行中且属于 SSTap Next 的旧会话尝试孤儿恢复。
- PowerShell 与 .NET 双重检查历史 sing-box PID 和其他 Agent 进程；必须确认两种检查完整、核心已退出、没有其他 SSTap Next Agent 实例。
- 必须至少发现一个 SSTap Next `SSTap Next` / `sing-tun Tunnel*` 对象，且所有对象均 Down/Disconnected/NotPresent、无 IP、无检查错误。
- 成功时归档原状态，原子更新为 `stopped_with_warning`，保留日志与恢复标记。检查失败、Agent/核心仍运行或接口活动时保持 fail-closed。
- 正常停止等待改为 45 秒；超时本身仍不解除锁。
- 不删除网卡、驱动、路由或 DNS；不操作旧版 SSTap 的 `SSTAP 1 / TAP-Windows Adapter V9`。

## 验证状态

- Node CI run [42435813089](https://github.com/xiaobei206/SSTapNext/actions/runs/42435813089)：`npm test` **110/110 PASS，0 fail**；`npm run verify:lock` 成功。
- 完整 Windows Release workflow run [42435813071](https://github.com/xiaobei206/SSTapNext/actions/runs/42435813071)，job `128594386324`：package-lock 校验、Node 自动化、sing-box **58/58** 配置矩阵、.NET 10 Agent 编译、TypeScript/Vite、NSIS、安装包 SHA 校验、Release 发布和 artifact 上传均成功。
- Release target commit：`5d20a622a9f55a66d9cc2801ab699bb4aaecc20e`。
- 安装包 `SSTap.Next-0.3.18-x64.exe`：174,901,866 bytes；SHA-256 `a2d0769e60e963ac7ea3fb271b771e15795e90bb4a0de250ab27fc2153e0e826`。
- Blockmap `SSTap.Next-0.3.18-x64.exe.blockmap`：182,804 bytes；SHA-256 `3a60768b7bbb709d5a020f51e06c08fce0660c1a3745075b850d822c25188c95`。
- SHA-256 sidecar `SSTap.Next-0.3.18-x64.exe.sha256`：93 bytes；asset digest `b7b73fc939eacc99b42e47b37b23f5c7fbfb4ca169e6e18c798c32922cd3112b`。
- Workflow artifact ID `13599562949`，artifact ZIP SHA-256 `218fc8aba2ced1ff0e43b233aba3f88bfe554c56ca727c9ed458d88796aa09bc`。
- 真实 Windows TUN 启停和至少 10 轮重连：NOT RUN，必须由用户安装 v0.3.18 后验收。

## 回滚

使用 GitHub Revert；不重写历史、不强推、不覆盖 v0.3.16 或 v0.3.17 的已发布资产。
