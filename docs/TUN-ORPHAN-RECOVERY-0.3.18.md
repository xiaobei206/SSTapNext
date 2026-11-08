# v0.3.18 设计：完成 TUN 孤儿会话恢复安全加固

日期：2026-11-08
开发线：main。v0.3.16 是上一个完整发布基线；v0.3.17 已由 Actions 自动发布，但它在最终 Agent 存活检查加入前构建，不能作为本故障的最终修复版。不得覆盖 v0.3.17 的已发布资产。

## 实机根因证据

用户实机旧会话 status 仍为 running、corePid=4968，但 Agent/sing-box 均不存在；已安装 Agent 的只读诊断显示检查完成，四个 SSTap Next `sing-tun Tunnel` 对象均 NotPresent、无 IP、无 inspectionError。原恢复流程只写 stop.signal 并等待 30 秒，已死亡 Agent 无法消费信号。Agent 正常停止预算为 18s + 18s，桌面端 30 秒窗口也不足。

旧版 SSTap `SSTAP 1 / TAP-Windows Adapter V9` 与本故障无关，禁止对其进行任何操作。

## v0.3.17 发布边界

v0.3.17 在版本号递增后，GitHub Actions 提前创建了 Release。其构建早于后续 Agent 进程存活检查补丁，因此不作为本问题的最终交付版本；保留其资产，不覆盖。完整修复版本改为 v0.3.18。

## v0.3.18 目标行为

1. 仅针对 `status=running`、`interfaceName=SSTap Next` 且有有效历史 corePid 的孤儿状态尝试自动恢复。
2. PowerShell 检查必须完整确认旧 sing-box PID 不存在，并且没有已运行的 `SstapNext.Agent.exe` 实例。
3. .NET Agent 检查器也必须完整确认历史 sing-box PID 不存在，并排除自身 PID 后确认没有其他 Agent 实例。
4. 至少发现一个 SSTap Next `SSTap Next` / `sing-tun Tunnel*` 对象；所有对象必须是 Down/Disconnected/NotPresent、无 IP、无检查错误。任一检查不完整、Agent/核心仍在运行、接口活动或存在地址，继续 fail-closed。
5. 成功时先归档原始状态，再原子更新为 `stopped_with_warning`；保留 sing-box 日志与恢复标记，不删除网卡、驱动、路由、DNS，也不触碰旧版 SSTap TAP 网卡。
6. Agent 停止等待预算为 45 秒，覆盖 18s 核心停止 + 18s 接口释放并留有余量；单纯超时绝不解除锁。

## 验收与回滚

- 当前 Node CI、lock 校验、Windows Agent 编译、sing-box 配置矩阵、TS/Vite、NSIS、installer SHA 和 Release assets 必须以 v0.3.18 对应最新 Actions 的真实结果为准。
- 自动化测试须覆盖：安全孤儿恢复、活动接口拒绝、Agent 存活拒绝、Agent 检查不完整拒绝，以及既有 cleanup_error 回归。
- 用户 Windows 实机 TUN 启停、至少 10 轮重连和路由/DNS 恢复仍 NOT RUN；不能以 CI 代替。
- 若回归，使用 GitHub Revert；不重写历史、不强推、不覆盖旧版本 Release。
