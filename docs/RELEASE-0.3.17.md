# SSTap Next 0.3.17 — TUN 孤儿会话安全恢复

状态：开发中，尚未发布。正式 Release v0.3.16 保持不变，不覆盖既有资产。

## 问题与根因

用户 Windows 实机在应用启动时遇到“遗留 TUN 会话在 30 秒内没有完成安全断开”。旧会话的 status 文件仍是 `running`，但对应 Agent/sing-box 进程已退出。Agent 的只读诊断确认所有 SSTap Next `sing-tun Tunnel` 对象均为 `NotPresent`、无 IP，双重枚举完整；原逻辑仍只写 `stop.signal` 并等待不存在的 Agent，最终错误阻断启动。

旧版 SSTap 的 `SSTAP 1 / TAP-Windows Adapter V9` 与本缺陷无关，不得修改或删除。

## 修复方案

- 对运行中但疑似孤儿的旧会话，使用现有 PowerShell + .NET 双重只读核验。
- 只有历史 sing-box PID 明确不存在、两种枚举都完整成功、至少发现一个相关 SSTap Next sing-tun 对象且全部为 Down/Disconnected/NotPresent、无 IP、无检查错误时，才归档旧状态并转为 `stopped_with_warning`。
- 核验不完整、发现活动接口、仍有 IP 或核心仍在运行时，不自动解锁，保持 fail-closed。
- 将等待 Agent 正常停止的桌面端预算由 30 秒提高到 45 秒，覆盖 Agent 最多 18 秒停止核心 + 18 秒等待接口释放并留有余量。达到截止时间仍不会自动释放锁。
- 原始状态归档并保留 sing-box 日志；不删除网卡、驱动、路由、DNS，也不触碰旧版 SSTap 的 TAP 网卡。

## 验证

- Node 自动化测试：待 GitHub Actions。
- package-lock 校验：待 GitHub Actions。
- Windows Agent / TS/Vite / NSIS / 安装包构建：待 GitHub Actions。
- 用户 Windows 实机 TUN 连接、断开、至少 10 次重连：NOT RUN，必须安装候选版本后验收。
- Release EXE、blockmap、SHA-256：待发布流程完成后核实；不得在发布前填入猜测值。

## 回滚

使用 GitHub Revert 回滚引入的代码提交；不重写历史、不强推、不覆盖 v0.3.16 的资产。
