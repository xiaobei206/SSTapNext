# Harness 一次性构建与审查任务（整段复制）

以下任务针对当前 SSTap Next 0.3.0 仓库。目标是一轮完成全部本机可自动化工作，不要把它拆成多轮“先做一点、等用户反馈再做一点”。请在同一个 Harness 会话里检查、修复、构建、验收并给出一份完整报告。

```text
你正在审查并交付 SSTap Next 0.3.0。请直接在当前仓库工作，不要重写架构，不要删除已有 UI，不要把功能降级为假按钮或 mock。

目标：一次性完成 Windows x64 的完整构建、依赖校验、测试、安装包核查与代码审查。请把所有可自动化的工作在本轮连续完成；若遇到可修复错误，先归类后批量修复，再跑完整回归。不要每完成一个小项就停下来询问用户，也不要分成多个后续对话。

必须遵守：
1. 不要读取、输出、上传或复制用户真实节点 URI、密码、订阅 URL、state.enc.json。测试只用仓库内 dummy fixture。
2. 不要禁用 Defender、防火墙、杀毒软件、Windows 安全功能。
3. 不要运行任何会启用 auto_route=true 的真实 TUN 会话；不要接管默认路由、修改 DNS、清理 route table、执行 route delete 或 netsh reset。
4. 允许运行无路由 smoke test（Run-Tun-SmokeTest.ps1），但只有先向用户明确说明它需要 UAC 且仅创建临时适配器、不接管默认路由/DNS，获得明确批准后才运行。未获得批准就只完成静态检查和构建。
5. 不能把模拟测试报告成真实 sing-box/真实节点/真实 Wintun 通过；每个结果必须标明 PASS / FAIL / NOT RUN 和证据。
6. 不要无故升级 sing-box、Electron、Node、.NET 或依赖版本；如发现安全/兼容问题，先论证最小改动。

执行：
A. 环境与源码审查
- 检查 package.json、electron-builder files/extraResources、preload IPC、main process IPC 权限、safeStorage、节点解析、订阅刷新、测速代码、TUN session controller、C# Agent、PowerShell 脚本。
- 检查版本字符串、README、CHANGELOG、Agent 版本、installer 名称一致。
- 检查高权限边界：Agent 核心路径固定、session/config SHA-256、文件路径和 reparse point、outbound allowlist、DNS detour、日志/cache 写入范围、UAC 参数引用安全、心跳/停止信号。
- 特别检查网络失败、UAC 取消、核心崩溃、桌面端崩溃、重复启动、退出竞态、清理失败与 stale session。

B. 执行一次完整构建
- 在 PowerShell 中运行：Set-ExecutionPolicy -Scope Process Bypass
- 执行 .\scripts\Build-Windows.ps1
- 该脚本应安装依赖、执行 npm tests、下载固定哈希 sing-box v1.14.4、对 6 种协议 × 3 种策略的 18 份配置执行真实 sing-box check、发布 .NET 10 win-x64 self-contained Agent、运行 TS/Vite 构建并生成 NSIS 安装包。
- 如果默认流程失败，找出根因并修复，完整重跑必要环节；不要只改脚本让它跳过失败项。
- 不能通过跳过校验、把错误吞掉、降低测试断言或把 exit code 强制改成 0 来制造绿色结果。

C. 安装包审查
- 检查 release 中的安装包是否存在、大小合理、文件名版本正确。
- 检查安装包资源中有 renderer、main/preload、shared 模块、sing-box.exe 及依赖 DLL、SstapNext.Agent.exe、Start-Tun-Agent.ps1。
- 检查开发模式和已安装模式下 CoreLocator / main process 的资源路径是否一致。
- 如果能在本机启动安装包，验证 UI 可启动、节点导入页面可用；不要连接用户的真实节点。

D. 测试和报告
- 运行 npm.cmd test、npm.cmd run doctor、npm.cmd run validate:core（完整构建流程已执行的可复用结果可以引用，但要列明命令与退出码）。
- 报告 Node 测试数、真实 sing-box check 通过数量、dotnet publish 结果、TS/Vite build 结果、NSIS 产物路径/大小/SHA-256。
- 如有未完成项，明确说明原因、影响面和最短复现方式；不得写“全部完成”掩盖 NOT RUN。
- 输出一份 docs/HARNESS-RESULT-0.3.0.md，包含问题列表、修复文件、命令、退出码、证据、未验证项目。

E. 最终提交
- 不要开始 live TUN 接管测试。
- 不要让用户再做多轮开发决策。只在本轮确实无法自动完成且必须用户批准的 UAC smoke test 时，简短说明阻塞。
- 保留完整源码、构建产物和修订记录；不要只交截图。
```

## 一次性运行建议

Harness 使用仓库根目录，直接粘贴上面完整任务。只允许它进行静态审查、自动化回归、sing-box 配置 check、Agent 构建和打包。系统级 TUN 真实接管必须由用户按 `WINDOWS-ACCEPTANCE.md` 逐项批准，不应作为自动化构建步骤。
