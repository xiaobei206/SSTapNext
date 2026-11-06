# SSTap Next 0.3.1 — 本轮迭代与审查报告

- 日期：2026-11-04
- 基线：用户上传的 `SSTapNext-0.3.0-src.zip`
- 目标版本：0.3.1（Windows x64）
- 变更类型：TUN 启动保护、资源归属判断、版本同步；未重写架构或更换 sing-box 版本。

## 1. 本轮修复

1. `TunRuntime.cs`：原逻辑对任何同名接口（包括 `Down`）一律阻止启动。现在仅对启动前已存在且处于 `Up` 的同名 TUN 接口阻止；对已存在的 `Down` 接口写入日志并继续尝试，Agent 不主动删除它；若该旧接口原本已经带有 TUN 地址且状态、地址均未变化，不会仅凭旧地址提前宣布本次 TUN 已就绪。
2. `TunRuntime.cs`：原异常处理仅根据同名适配器是否存在来决定 `error` / `cleanup_error`。现在同时记录核心是否由本次会话启动，以及启动前适配器的 ID、状态和预期 TUN 地址状态。只有核心已启动且检测到本次会话新增或改变的适配器资源，才归类为 `cleanup_error`；启动前已存在且保持原状的接口不会被误报为本次清理失败。
3. `TunRuntime.cs`：适配器名称无法匹配时，原地址兜底会将任意具有 `172.19.0.1` 的接口当作 SSTap TUN。现在地址兜底同时要求描述以 `sing-tun Tunnel` 开头，减少误识别其他网卡的可能；对启动前已存在且地址未变化的 Down 接口，也不再将旧地址当作本次启动成功的证据。
4. 首页连接提示明确标注 TUN 已启动不等于节点公网连通已验证；Agent 停止时也区分“本次创建并移除的接口”和“启动前已有且保持原状的接口”。
5. Electron、Agent、诊断程序、UI、构建诊断与 User-Agent 的版本信息同步到 `0.3.1`；`doctor.mjs` 的版本检查也改为 0.3.1。
6. Node 自动化测试命令改为串行执行（`--test-concurrency=1`），测试用例和断言不变；复测时隔离 TUN 测试 5/5、完整串行测试 49/49 通过。
7. 新增本报告并更新 SHA-256 源码清单。

## 2. 变更文件

- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`
- `apps/desktop/src/main/index.cjs`
- `apps/desktop/src/renderer/src/main.tsx`
- `src/agent/SstapNext.Agent/Program.cs`
- `src/agent/SstapNext.Agent/SstapNext.Agent.csproj`
- `src/shared/socks-speed-test.cjs`
- `scripts/doctor.mjs`
- `scripts/Fetch-SingBox.ps1`
- `scripts/Build-Windows.ps1`
- `package.json`、`package-lock.json`
- `README.md`、`HANDOVER.md`、`CHANGELOG.md`、`docs/WINDOWS-ACCEPTANCE.md`
- `docs/RELEASE-0.3.1.md`、`SOURCE-MANIFEST.sha256`

## 3. 本环境验证

| 检查 | 结果 | 证据 / 限制 |
|---|---|---|
| `npm test`（串行） | PASS | 49/49，0 失败；TUN 测试文件单独复测 5/5。一次重复的默认并行运行曾超时但没有断言失败，因此本版将测试运行顺序固定为串行。 |
| JavaScript `.cjs` / `.mjs` 语法 | PASS | 对 `apps`、`src`、`scripts`、`build-tools` 下脚本执行 `node --check` |
| `node scripts/doctor.mjs` | PASS（exit 0，含预期待办） | 项目版本检查通过；核心、Agent、依赖、前端构建与安装包需在 Windows 环境补齐 |
| 版本一致性 | PASS | package、lockfile、Electron APP_VERSION、UI、Agent、doctor 与构建输出已更新为 0.3.1 |
| SHA-256 清单 | PASS | 本报告生成后重新计算所有源文件哈希 |
| TypeScript / Vite 构建 | BLOCKED / NOT COMPLETED | `npm ci` 访问 npm registry 时 DNS 不可达；全局 `tsc` 也因项目依赖类型包（`@types/node`、`vite/client`）缺失而无法完成项目构建 |
| .NET 10 Agent 编译 | NOT RUN | 当前环境未安装 .NET SDK（`dotnet` 命令不存在） |
| sing-box 1.14.4 真实配置检查 18/18 | NOT RUN | 当前环境无 Windows `sing-box.exe`，且无法访问 GitHub 下载核心 |
| NSIS 安装包 | NOT RUN | 当前环境非 Windows，且缺少已构建的前端、Agent 和 sing-box 运行文件 |
| Wintun / 节点握手 / 实际公网流量 | NOT RUN | 只能在用户 Windows 11 目标机及真实节点上验证；本轮没有启动真实 TUN |

## 4. 静态审查范围与结论

- Agent：复核 `TunRuntime.cs` 的会话输入验证、核心启动/退出、适配器匹配、状态写入与异常清理分支；本轮变更局限在 TUN 适配器归属与状态判断。
- Electron 主进程：复核窗口安全选项、导航/新窗口策略、IPC 来源校验，以及连接/断开/测速互斥检查。当前 `contextIsolation=true`、`nodeIntegration=false`、`sandbox=true`；业务 IPC handler 均调用 `assertTrustedRenderer`。
- 共享模块与构建：检查 `.cjs/.mjs` 语法、版本定义、测试脚本、锁文件版本、构建脚本与输出版本。
- 未完成项：本环境无法执行 Roslyn/.NET 编译、TypeScript 完整类型检查、Windows 打包及动态网络验收，因此静态审查不等同于完整编译审计或安全认证。

## 5. 未解决 / 未宣称通过

- 本次修改解决的是交接文档指出的 Agent 网卡启动拦截与清理状态误判，并收紧了接口识别；这不能单独证明当前节点握手或全局代理流量已恢复。
- `status=running` 仍表示 Agent 核心进程运行且 TUN 适配器达到已配置条件，不表示远端代理握手和真实公网出口已经验证。实际节点连通需在目标机连接后测试。
- 由于构建环境缺少网络、.NET SDK 和 Windows NSIS 环境，本轮没有生成可安装的 `SSTap Next-0.3.1-x64.exe`。未伪造安装包或将未运行项目标记为 PASS。

## 6. Windows 构建与安装

在 Windows 11 的项目目录中，使用 Node.js 22+、.NET 10 SDK 与 PowerShell 执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

预期安装包：`release\SSTap Next-0.3.1-x64.exe`。脚本将执行测试、下载并校验 sing-box 1.14.4、校验 18 份配置、发布 Agent、构建前端并打包 NSIS。构建通过后先安装 0.3.1，再按 `docs/WINDOWS-ACCEPTANCE.md` 的顺序验证本地代理、TUN smoke 和实际节点连接。不要把本报告中的未运行项目视为已验收。
