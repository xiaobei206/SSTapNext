# SSTap Next 0.3.7 构建与验证报告

日期：2026-11-06  
源码基线：由已核验的 `SSTapNext-0.3.6-source.zip` 单一派生，未混用其他工作目录。

## 基线证据

- 输入源码 ZIP：`SSTapNext-0.3.6-source.zip`
- 输入 ZIP 字节数：237,323 bytes
- 输入 ZIP SHA-256：`b70b21007945704573beb8019689e52eaee7303f77741e44bad699a849df1b5d`
- ZIP 完整性：PASS，`ZipFile.testzip()` 未发现损坏成员。
- 输入源码清单：73/73 文件路径与 SHA-256 匹配。
- 修改前回归：65/65 Node tests PASS。
- 修改前 package-lock：704/704 依赖引用兼容。

## 0.3.7 修改摘要

- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`：将“会话活动残留”判据收紧为适配器 `OperationalStatus.Up` 或仍持有应用 TUN 地址 `172.19.0.1`。Windows 在 sing-box 退出后保留的 `Down`、无 TUN 地址 Wintun 设备对象不再触发 18 秒等待和 `cleanup_error`；设备对象保留，不执行删除。
- `src/shared/agent-stop-contract.test.mjs`：新增持久化 Down/无地址放行，以及 Up/仍持有地址继续保护的回归契约。
- `.github/workflows/ci.yml`：新增 Ubuntu Node 回归和 lockfile CI。
- `.github/workflows/release-windows.yml`：发布 `vX.Y.Z` Release 后在 Windows 2022 执行完整构建，并上传安装 EXE、blockmap、SHA-256。
- 增加 GitHub 发布指南和 0.3.7 验收步骤。

## 当前环境已执行检查

| 检查 | 结果 | 实际证据 |
|---|---|---|
| Node 自动化测试 | PASS 67/67 | `node --test --test-concurrency=1 src/shared/*.test.mjs`，退出码 0 |
| package-lock | PASS 704/704 | `node scripts/verify-package-lock.mjs`，退出码 0 |
| JS/CJS/MJS 语法 | PASS | 对 `apps/`、`src/`、`scripts/` 中全部 `.js/.cjs/.mjs` 执行 `node --check`，全部退出码 0 |
| 项目诊断 doctor | PASS（存在预期待办） | `node scripts/doctor.mjs`；确认版本 0.3.7，依赖/核心/Agent/Vite/安装包尚未构建 |
| GitHub Actions YAML | PASS 语法解析 | 两个 workflow 均可被 YAML parser 解析；未在 GitHub 实际运行 |
| 敏感信息扫描 | PASS（静态规则） | 未发现 GitHub token、私钥、真实节点 URI/订阅；匹配到的代理 URI 均为 `example.com` 测试 fixture |

## 当前未执行（不能标记通过）

| 检查 | 状态 | 原因 |
|---|---|---|
| .NET 10 Agent 编译/发布 | NOT RUN | 当前环境没有 Windows/.NET 10 SDK |
| sing-box 54 份配置真实 `check` | NOT RUN | 当前环境未下载 Windows sing-box 二进制；应在 Windows Build 脚本中执行 |
| TypeScript/Vite build | NOT RUN | 当前环境未安装 npm 依赖 |
| NSIS 安装包 | NOT RUN | 需要 Windows x64 和 electron-builder 运行环境 |
| 实际 Wintun 创建/停止/重连 | NOT RUN | 需要用户 Windows 机器、驱动与 UAC |
| 10 轮持续运行断开重连 | NOT RUN | 必须在目标 Windows 实机验收 |
| GitHub Actions workflow | NOT RUN | 公开仓库尚未创建；连接器没有创建仓库操作 |
| GitHub Release 与安装资产 | NOT RUN | 需要先创建 `xiaobei206/SSTapNext` 空公开仓库并提交源码，再发布 `v0.3.7` |

## Windows 验收要求

1. 在 Windows 10/11 x64、Node 22+、.NET 10 SDK 环境运行 `scripts\Build-Windows.ps1`，所有 8 步退出码为 0。
2. 构建通过后安装 0.3.7，导入已验证节点。
3. 在准备备用网络的前提下开启系统 TUN，正常断开至少 10 次并再次连接。
4. 每轮断开后，若同名 Wintun 对象仍显示 `Status=Down` 且 `Addresses=[]`，应允许下一轮启动；程序不得删除该对象。
5. 负向保护必须成立：若接口仍为 `Up` 或仍持有 `172.19.0.1`，必须继续阻止重连并保留 `cleanup_error`。
6. 对照系统默认路由、物理网卡 DNS 和应用状态，确认正常恢复。

**结论：** 0.3.7 源码层面的 67 项自动化测试、704 项锁文件检查和语法检查已经通过；不能据此宣称 .NET Agent 编译、Windows 安装包、真实 sing-box 配置检查或 Wintun 实机修复已经通过。最终根因修复仍需 Windows 10/11 上的 10 轮实际重连验收。
