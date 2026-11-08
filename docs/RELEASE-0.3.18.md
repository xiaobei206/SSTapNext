# SSTap Next 0.3.18 — TUN 孤儿会话安全恢复（待发布）

状态：开发中。v0.3.17 已自动发布，但早于最终 Agent 存活检查补丁；保留其资产，不覆盖。完整修复交付目标为 v0.3.18。

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

- Node CI / `npm test`：等待 v0.3.18 对应最终 SHA 的 Actions。
- `npm run verify:lock`：等待最终 SHA 的 Actions。
- Windows Agent、sing-box 配置检查、TS/Vite、NSIS、安装包 SHA：等待 v0.3.18 完整构建 workflow。
- 真实 Windows TUN 启停和至少 10 轮重连：NOT RUN，必须由用户安装 v0.3.18 后验收。
- EXE、blockmap、SHA-256 资产：发布成功后再核验，不预填猜测值。

## 回滚

使用 GitHub Revert；不重写历史、不强推、不覆盖 v0.3.16 或 v0.3.17 的已发布资产。
