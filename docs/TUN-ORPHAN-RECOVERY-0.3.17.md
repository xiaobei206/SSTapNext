# v0.3.17 设计：恢复已死亡进程留下的 TUN 会话

日期：2026-11-08
基线：v0.3.16；开发线仅 main。

## 现象与证据

用户 Windows 实机启动时，界面报“遗留 TUN 会话在 30 秒内没有完成安全断开”。目标会话 `7a46c8be00be23d639ad360db87e4759` 的 `status.json` 仍是 `running`、`corePid=4968`，但 Agent 与 sing-box 进程均不存在。sing-box 日志和桌面心跳在 2026-11-08 02:30 左右停止，恢复流程于 09:16 写入 `stop.signal`。用户提供的 Agent 只读检查确认 PID 4968 已不存在，四个 SSTap Next `sing-tun Tunnel` 对象均为 `NotPresent`、无 IP 地址、无检查错误；PowerShell 与 .NET 检查完成且没有 sing-box 进程。

旧版 SSTap 的 `SSTAP 1 / TAP-Windows Adapter V9` 与本次故障无关。所有实现和验收必须仅针对 SSTap Next 的 `Name=SSTap Next` 或 `InterfaceDescription=sing-tun Tunnel*`，不得修改、删除或重置旧版 SSTap 网卡。

## 根因

`recoverStaleSessions()` 对所有非终态旧状态一律写 `stop.signal`，然后等待 Agent 最多 30 秒。Agent 若已被系统关机/休眠恢复/异常退出带走，便不会读取信号或更新状态。Agent 正常清理预算本身为停止核心 18 秒 + 等待接口释放 18 秒，也高于桌面端的 30 秒截止时间。

## 设计目标

1. 旧 Agent/核心仍运行时继续请求安全停止，不因超时直接解除锁。
2. 状态仍为 `running` 但旧核心 PID 已消失时，使用现有 Agent 的双重只读接口枚举能力，检查历史 PID 和所有 SSTap Next sing-tun 接口。
3. 只有两种核验都完整成功、历史核心 PID 确认不存在、所有相关接口均为 `Down/Disconnected/NotPresent` 且无 IP、无检查错误、无活动接口时，才归档原状态并将该孤儿会话转换为 `stopped_with_warning`。
4. 任何活动/未知接口、检查失败、PID 检查不完整、接口状态/地址异常、sessionId 不匹配或核心 PID 缺失，都必须 fail-closed，禁止启动新 TUN。
5. 归档原始 `status.json`，保留 `sing-box.log` 和诊断证据；不删除网卡、驱动、路由、DNS，也不触碰旧版 SSTap 的 TAP 网卡。
6. 将桌面端等待时间提升到至少 45 秒（覆盖 Agent 18+18 秒预算并留有余量）；超时仍不等于资源安全，之后必须保留锁。
7. 只针对状态文件已有 `corePid` 且 `interfaceName === 'SSTap Next'` 的 `running` 孤儿状态做自动恢复；其他未知状态继续保持现有安全策略。

## 实现范围

- `src/shared/tun-controller.cjs`：新增针对运行中孤儿会话的双重核验与状态归档；修正 30 秒等待窗口。
- `src/shared/tun-controller.test.mjs`：覆盖已死亡核心 + 所有相关接口 NotPresent 时安全恢复；活动接口、仍运行的核心、检查不完整、接口有 IP 等负向情况必须保持锁；验证不清理网卡或日志。
- 版本同步：`package.json`、`package-lock.json`、Agent 项目版本、CHANGELOG、`docs/RELEASE-0.3.17.md`。
- 更新接手入口、HANDOVER 和开发日志，记录自动化与实机验收边界。

## 验收

- `npm test` 全部通过；`npm run verify:lock` 全部通过。
- GitHub Actions Node CI 与 Windows workflow 结果按真实 run 记录；Windows build 必须执行 Agent、TypeScript/Vite、NSIS、installer hash。
- 不把 CI 当作真实 Windows 网络验收。用户安装 v0.3.17 后验证：启动不再对已死亡且无活动 SSTap Next TUN 的孤儿会话卡 30 秒；正常 TUN 连接/断开和至少 10 次重连；有活动 TUN 时恢复仍 fail-closed。
- 若出现任意核验歧义，保留启动锁，不自动删资源。

## 回滚

使用 GitHub Revert 回滚本次聚焦提交；不重写历史、不强推、不覆盖 v0.3.16 Release 资产。正式修复版本必须递增至 0.3.17。
