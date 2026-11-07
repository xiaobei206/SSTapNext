# SSTap Next 0.3.15 — Release 记录

<badge>已发布</badge>

- Release：<https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.15>
- 发布时间：2026-11-07 09:54:41 UTC
- Release / Windows build source commit：`09f5e023cc8eed598d0e4cd5632b8d94310a5005`
- 当前 main 已验证 HEAD（发布后补充的排序 TypeScript 安全处理）：`3840b5767e42e5c833272c99fffe25dfffd18d9c`
- 当前 main HEAD 的 Node CI：run [42361569553](https://github.com/xiaobei206/SSTapNext/actions/runs/42361569553)，success。
- Windows Release 构建：run [42361504899](https://github.com/xiaobei206/SSTapNext/actions/runs/42361504899)，job `128370690350`，success。此为实际执行 Build-Windows 的 run；后续 run 因 Release 已存在而按工作流规则跳过重复构建。

## 功能

- 连接中心显示本次实时下载速度、实时上传速度，以及分开的本次下载累计、本次上传累计和会话时长。
- 使用 sing-box 1.14.4 Clash API `/connections` 的 `uploadTotal` / `downloadTotal`；每秒采样、三样本速率平滑、会话独立归零、断开 final sample。
- 节点管理显示每节点历史累计上传、累计下载和合计。统计按 nodeId 保存于加密应用状态，最多每 10 秒批量写入，断开/退出 flush。
- PING、TCPING、代理延迟、下载速度、上传累计、下载累计、总流量、最近检测支持表头点击排序；同一表头再次点击切换升/降序；无结果置底、稳定排序。
- 左下角版本号弱化为 14px 普通辅助文字；全局 HTML `small` 明确为 14px。CSS 字号审计 98 条显式字号规则，最小 14px；未发现 Renderer inline 小字号覆盖。
- 本地代理流量按节点归属计入节点累计；TUN 会话总量明确含直连，只展示在首页，不错误计入某个代理节点。

## 安全与范围

- Clash API 每会话随机端口，只绑定 `127.0.0.1`，并使用随机 Bearer secret。
- 端点与 secret 只存在于主进程内存及受权限保护的临时运行配置文件（TUN runtime dir mode 0700、config mode 0600）；不写入加密用户状态、不经 IPC、不进日志，停止时清理会话目录。
- 未升级 sing-box 1.14.4；未改变 Windows 系统代理；未放松 TUN Agent fail-closed 清理逻辑。
- 单节点测速若流量实际经过当前本地代理，会计入当前会话和节点累计；独立批量测速使用自己的 sing-box 进程，不计入主连接流量。

## 自动化和构建验证

- Node CI：run `42361569553`，SHA `3840b5767e42e5c833272c99fffe25dfffd18d9c`，success。
- Node regression tests：**107/107 PASS，0 failures**。
- `npm run verify:lock`：**704/704 依赖引用 PASS**。
- Windows Release run `42361504899`：实际执行 Windows 构建，成功。
- sing-box 1.14.4：**58/58 配置检查 PASS**（54 基础协议/模式/DNS 组合 + SSTap 规则配置 + 批量节点测试配置 + Proxy/TUN 两份流量 API 配置）。
- .NET 10 Agent 发布成功；Agent SHA-256：`f33945d4a6c4f783240b86b2d9d01eaaa9e23f130c6dca242d313bb58881816b`。
- TypeScript `tsc --noEmit`、Vite production build、Electron packaging、NSIS 安装包、blockmap、installer SHA 检查均成功。
- Windows workflow artifact：`SSTapNext-main-Windows-x64`，ID `13569852641`，175,090,550 bytes。

## Release 资产

| 文件 | 大小 | SHA-256 |
|---|---:|---|
| [SSTap.Next-0.3.15-x64.exe](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.15/SSTap.Next-0.3.15-x64.exe) | 174,897,992 bytes | `754776cab4b79c6c8ba701086a46e7d3ac74a096b93163cf51d2cb2dfca8333c` |
| [SSTap.Next-0.3.15-x64.exe.blockmap](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.15/SSTap.Next-0.3.15-x64.exe.blockmap) | 182,655 bytes | `8425abe5eb9ec7891f53b85e846573748c3011b4a8b0bb57634c803448990c24` |
| [SSTap.Next-0.3.15-x64.exe.sha256](https://github.com/xiaobei206/SSTapNext/releases/download/v0.3.15/SSTap.Next-0.3.15-x64.exe.sha256) | 93 bytes | `0eed8e7bec626f3dcf37c5004f64213757c3b6b36efa77a0c7cf3aaaf2b5dfbc` |

## Windows 实机验收（尚未完成）

以下项目 CI 不能替代，必须在用户 Windows 10/11 机器安装后确认：

- 本地代理上下行速度动态变化、分开累计、断开 final 值、重连归零。
- 节点累计跨重连、跨应用重启保留；换节点不串账；删除节点后移除统计。
- TUN 显示系统流量含直连；TUN 直连和代理流量都不被错误加入节点个人累计。
- API 不可用时提示准确；断开后监听器和临时配置清理。
- 全页面字号、侧栏版本号、节点管理表格横向滚动及窗口缩放。

自动化和安装包通过不等同于上述实机验收完成。
