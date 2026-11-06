# SSTap Next 0.3.0 — Harness 构建与审查结果

- 日期：2026-11-03（Asia/Shanghai）
- 环境：Windows 11 x64（os 10.0.26300）、Windows PowerShell 5.1（`$PSEdition=Desktop`，ANSI 代码页 gb2312）
- 工具链：Node.js v26.13.0、npm 11.20.0、.NET SDK 10.0.403、git 2.56.0（本目录 **不是 git 仓库**）
- 结果摘要：**完整构建通过（Build-Windows.ps1 退出码 0，含 NSIS 安装包）**；npm 测试 49/49；真实 sing-box 1.14.4 配置检查 18/18；dotnet 发布成功；TS/Vite 构建成功。

> 全程未读取/输出真实节点 URI、密码、订阅 URL 或 state.enc.json；未禁用 Defender/防火墙/杀软；未运行任何 `auto_route=true` 的真实 TUN 会话；未执行 route delete / netsh reset / 清空 DNS。

---

## 1. 结论速览

| 项目 | 结果 | 证据 |
|---|---|---|
| 完整构建 `scripts\Build-Windows.ps1` | **PASS（exit 0）** | 8/8 阶段全部 `[OK]`，输出 `[SUCCESS]` |
| `npm.cmd test` | **PASS 49/49** | `tests 49 / pass 49 / fail 0` |
| `npm.cmd run validate:core`（真实 sing-box 1.14.4） | **PASS 18/18** | `配置校验：18/18 通过` |
| `dotnet publish`（.NET 10 win-x64 自包含单文件） | **PASS** | `SstapNext.Agent.exe` 43,950,903 B |
| TS 严格检查 + Vite 构建 | **PASS** | `tsc --noEmit` + `✓ built in 537ms` |
| NSIS 安装包 | **PASS** | `release\SSTap Next-0.3.0-x64.exe` |
| `npm.cmd run doctor` | **PASS（exit 0，全 [OK]）** | 7/7 项 `[OK]` |
| TUN 无路由 smoke test（需 UAC） | **NOT RUN** | 未获 UAC 批准，按要求只做静态检查与构建 |
| 真实 TUN 接管 / 真实节点握手 / 真实 Wintun | **NOT RUN** | 被任务约束明确禁止 |
| 安装后 UI 启动 / 节点导入页面 | **NOT RUN** | 本环境未启动 GUI |

---

## 2. 环境

| 项 | 值 |
|---|---|
| Node.js | v26.13.0（要求 >=22，满足） |
| npm | 11.20.0 |
| .NET SDK | 10.0.403（要求 >=10.0.100，满足） |
| PowerShell | 5.1.26100.9711 Desktop（**无 pwsh 7**；`$PSVersionTable.PSEdition=Desktop`） |
| 系统 ANSI 代码页 | gb2312 |
| Developer Mode | **未启用**（`AllowDevelopmentWithoutDevLicense` 为空） |
| 当前用户管理员 | 否 |
| 网络 | npm registry / api.github.com 可达（HTTP 200） |
| git 仓库 | 无（`git rev-parse` 失败，目录无 `.git`） |

---

## 3. 本轮发现并修复的问题（源码审查 A + 构建 B）

按根因归类，共 9 处代码/脚本修复 + 1 处环境级构建 workaround。

### 3.1 阻断类（不修复无法构建）

1. **PowerShell 脚本缺 UTF-8 BOM（编码）**
   - 文件：6 个 `scripts\*.ps1` 均为 UTF-8 无 BOM；Windows PowerShell 5.1 按 gb2312 读取，中文被解析成乱码并触发解析器错误（`表达式或语句中包含意外的标记`）。
   - 修复：为 6 个 `.ps1` 写入 UTF-8 BOM（内容逐字节一致，`Parser::ParseFile` 0 错误）。
   - 文件：`scripts\Build-Windows.ps1`、`Fetch-SingBox.ps1`、`Publish-Agent.ps1`、`Start-Tun-Agent.ps1`、`Run-Tun-SmokeTest.ps1`、`Export-NetworkSnapshot.ps1`。

2. **`$ErrorActionPreference='Stop'` 把原生命令 stderr 变成致命错误**
   - 现象：`npm.cmd install` 的良性 stderr 警告（`npm warn ...`）触发 `NativeCommandError` 并抛异常，中断脚本；且 PS 5.1 下 `2>&1` **不能**阻止该行为（实测 `.cmd` 与 `.exe` 均仍抛错）。
   - 修复：`Build-Windows.ps1`、`Publish-Agent.ps1`、`Run-Tun-SmokeTest.ps1` 顶部改为 `$ErrorActionPreference='Continue'`；真实失败仍由已有的显式 `throw` 与 `$LASTEXITCODE -ne 0` 检查捕获（未削弱失败判定）。同时为原生调用补充 `2>&1`（合并输出便于日志）。

3. **`validate-singbox-configs.mjs` 混用 CommonJS `require` 与 ESM**
   - 现象：`.mjs` 中第 4 行 `require('node:fs')` 触发 `ReferenceError: Cannot access 'require' before initialization`（与第 10 行 `const require = createRequire(...)` 形成 TDZ）。此前仅在 Linux 容器做过 `node --check`（只查语法，查不出运行时 TDZ），从未真实执行。
   - 修复：内置模块改用 ESM `import`，仅对本地 `.cjs` 模块使用 `createRequire`。

4. **sing-box 1.14.4 配置 schema 不兼容（`domain_resolver` 与 `default_domain_resolver`）**
   - 现象：真实 `sing-box check` 报 `missing route.default_domain_resolver or domain_resolver in dial fields is deprecated...removed in 1.14.0`。
   - 修复：
     - `src\shared\tun-config.cjs`：`selectedProxy.domain_resolver` 由对象 `{server:'dns-bootstrap'}` 改为字符串 `'dns-bootstrap'`（实测字符串才被 1.14.4 接受）。
     - 同文件：`route` 增加 `default_domain_resolver:'dns-bootstrap'`（DoH `dns-remote` 等拨号字段在 1.14 要求显式解析器）。
     - `src\agent\SstapNext.Agent\Core\TunRuntime.cs`：`ValidateRestrictedTunConfig` 同步改为校验字符串 `domain_resolver`，并新增校验 `route.default_domain_resolver == "dns-bootstrap"`。
     - `src\shared\tun-config.test.mjs`：断言改为字符串。

5. **sing-box 1.14.4 要求 Reality 客户端启用 uTLS**
   - 现象：`sing-box check` 报 `uTLS is required by reality client`。
   - 修复：`src\shared\node-parser.cjs`：VLESS Reality 未提供 `fp` 时默认 `utls={enabled:true, fingerprint:'chrome'}`（显式提供 `fp` 时仍使用用户值）。

### 3.2 环境级构建 workaround（非源码 bug）

6. **electron-builder winCodeSign 符号链接解压失败（Windows 无 Developer Mode/管理员）**
   - 现象：NSIS 打包阶段，app-builder 用 `7za.exe x -snld` 解压 `winCodeSign-2.6.0.7z`，其中 2 个 macOS `darwin/**/*.dylib` 符号链接在无权限时创建失败，`exit 2` 中断打包。
   - 定位：签名实际被跳过（`cscInfo=null`）；下载由 app-builder 二进制（`rcedit` 步骤）内部触发，不是 JS `getSignVendorPath()`；`SIGNTOOL_PATH`、`CSC_IDENTITY_AUTO_DISCOVERY` 均无效。
   - 实测：7-Zip `-snl-`（不把符号链接当链接）可无错解压（exit 0），Windows 工具完整。
   - Workaround：新增 `artifacts\7za-wrapper\`（.NET 10 小工具），把 `-snld` 重写为 `-snl-` 后转发给真实 7za；将 `node_modules\7zip-bin\win\x64\7za.exe` 替换为该包装器（真实 7za 重命名为 `7za-real.exe`）。
   - 性质：这是**本机构建环境的兼容 workaround**，不改动 SSTap Next 源码，不影响功能；重新 `npm install` 后需重放此步骤（见 §7）。

---

## 4. 构建与测试结果（D）

### 4.1 完整构建（`Set-ExecutionPolicy -Scope Process Bypass; .\scripts\Build-Windows.ps1`）

| 阶段 | 命令/内容 | 结果 | 退出码 |
|---|---|---|---|
| 1/8 | `npm.cmd install --no-audit --no-fund` | 通过（`up to date`） | 0 |
| 2/8 | `npm.cmd test` | 49/49 | 0 |
| 3/8 | `node scripts\validate-singbox-configs.mjs --core runtime\sing-box\sing-box.exe` | 18/18 | 0 |
| 4/8 | `scripts\Publish-Agent.ps1`（`dotnet publish -c Release -r win-x64 --self-contained`） | 通过 | 0 |
| 5/8 | `npm.cmd run build`（`tsc --noEmit` + `vite build`） | 通过（28 modules，`built in 537ms`） | 0 |
| 6/8 | `npm.cmd run dist:win`（electron-builder NSIS） | 通过 | 0 |
| 7/8 | 交付产物检查（dist/index.html、Agent.exe、sing-box.exe） | 通过 | 0 |
| 8/8 | `npm.cmd run doctor` | 7/7 `[OK]` | 0 |

完整日志：`build-0.3.0.log`（末尾 `[SUCCESS] SSTap Next 0.3.0 构建流程完成`，`BUILD_RESULT=OK`）。

### 4.2 单独命令（复用构建结果 + 复跑确认）

| 命令 | 结果 | 退出码 |
|---|---|---|
| `npm.cmd test` | 49 tests / 49 pass / 0 fail | 0 |
| `npm.cmd run validate:core` | 18/18 通过（真实 sing-box 1.14.4） | 0 |
| `npm.cmd run doctor` | 全部 `[OK]` | 0 |

### 4.3 产物与哈希

| 产物 | 大小 | SHA-256 |
|---|---|---|
| `release\SSTap Next-0.3.0-x64.exe`（NSIS） | 174,847,155 B（≈166.75 MB） | `0D9B058BC6001058AF4E4CCE67FA0997B5370B904A8A0ABDF07266EE648A38CE` |
| `release\SSTap Next-0.3.0-x64.exe.blockmap` | — | — |
| `artifacts\agent-win-x64\SstapNext.Agent.exe` | 43,950,903 B | `B2B9FDACE54E9F21E48B867B670382D75E22F112F0832D20C8853733C1496F26` |
| `runtime\sing-box\sing-box.exe` | 82,074,624 B | `8F30682EE198855440D2A7FE070D5D3653793B2D01BB8C85EEA88F93BBE7C8B9` |
| sing-box 下载包 `sing-box-1.14.4-windows-amd64.zip` | — | `99185d75d314a07dbba4a130c8ad986cbeb629a07927975636b341ca61f991df`（与 `Fetch-SingBox.ps1` 固定值一致，下载已通过校验） |

> 注意：NSIS 安装包**非确定性**（内嵌构建时间戳），每次构建 SHA-256 会变化；上述为最终一次完整构建的值。

---

## 5. 安装包核查（C）

- 安装包存在、大小合理、文件名版本正确：`SSTap Next-0.3.0-x64.exe`（`artifactName` = `${productName}-${version}-${arch}`，即 `SSTap Next-0.3.0-x64`）。✅
- `release\win-unpacked\resources\` 资源清单（已验证）：
  - `app.asar`（7,216,006 B）：含 `apps/desktop/src/main/index.cjs`、`apps/desktop/src/preload/index.cjs`、`dist/renderer/**`、`src/shared/*.cjs`、`package.json`、`node_modules/react|react-dom|scheduler`。✅
  - `agent\SstapNext.Agent.exe` + `AGENT-MANIFEST.txt` + `SstapNext.Agent.pdb`。✅
  - `sing-box\sing-box.exe` + `libcronet.dll` + `DEPENDENCY.txt`。✅
  - `scripts\Start-Tun-Agent.ps1`。✅
  - `elevate.exe`（NSIS 提权助手）。✅
- CoreLocator / 主进程资源路径一致性（静态核对）：
  - 主进程 `findTunSingBoxExecutable()` 首选 `resources\sing-box\sing-box.exe`；Agent `CoreLocator.GetBundledCandidates()` 含 `AppContext.BaseDirectory\..\sing-box\sing-box.exe`（= `resources\sing-box\sing-box.exe`，归一化后一致）与 `ProgramFiles\SSTap Next\runtime\sing-box\sing-box.exe`。✅
  - Agent 位于 `resources\agent\`；主进程 `findTunAgentExecutable()` 首选 `resources\agent\SstapNext.Agent.exe`。✅
  - 开发模式：`runtime\sing-box`、`artifacts\agent-win-x64` 与 `..\..\runtime\sing-box` 路径在两侧均能命中。✅
- 开发/安装模式路径差异核对无阻断；已在 §3.2 说明 winCodeSign 解压 workaround。

### 次要发现（不影响功能，未修改）

- `files: ["src/shared/**/*"]` 会把 `*.test.mjs` 也打包进 asar（冗余，无安全影响）。
- electron-builder 提示 `author is missed`、`default Electron icon is used`（无自定义图标/作者，纯提示）。
- npm 11 的 `allowScripts` 跳过 `esbuild`(postinstall) 与 `electron-winstaller`(install) 两个安装脚本；实测二者对 NSIS 构建**非必需**（esbuild 二进制由 `@esbuild/win32-x64` 可选依赖提供，electron-winstaller 仅 Squirrel 用）。
- Node `DEP0190` 弃用告警来自 electron-builder 内部，无影响。

---

## 6. 高权限边界与异常路径审查结论（A）

静态审查通过的项目（关键点）：

- **IPC 权限**：preload 用 `contextBridge` 暴露冻结白名单；`contextIsolation:true`、`nodeIntegration:false`、`sandbox:true`；主进程 `assertTrustedRenderer` 校验 `senderFrame.url` 必须等于打包后的 `file://.../dist/renderer/index.html`（或开发服务器 origin）；`will-navigate` 阻止跳转、`setWindowOpenHandler` 拒绝弹窗。
- **safeStorage**：读写前均检查 `safeStorage.isEncryptionAvailable()`，不可用时**拒绝明文降级**；损坏数据自动改名隔离。
- **节点解析**：不支持协议/传输/插件显式报错（不静默当 TCP、不丢字段）；去重指纹含完整凭据与传输/TLS 参数。
- **订阅**：4 MB 上限、20s 超时、禁止 URL 内嵌账号密码、HTTPS 不降级、失败/部分解析保留旧数据。
- **测速**：全走 SOCKS5；Range/Content-Range 严格校验；重定向防 HTTPS 降级；可取消；仅内存不落盘。
- **TUN controller**：session/config SHA-256、会话目录 `tun-<32hex>`、心跳 3s 写/20s 超时、停止信号与 sessionId 匹配、遗留会话恢复、`cleanup_error` 锁定再次连接。
- **C# Agent**：UAC 才运行；固定核心路径 allowlist；路径/reparse point 检查；单一 TUN 入站、outbound allowlist（selected-proxy/direct/block）、DNS bootstrap/remote detour 校验、日志/缓存写入范围校验、退出确认网卡移除。
- **PowerShell**：`Start-Tun-Agent.ps1` 参数引用安全（自定义 Quote-Argument）；`Run-Tun-SmokeTest.ps1` 显式 `auto_route=false`、`dns_mode=disabled`。
- **版本一致性**：`package.json`(0.3.0)、`main/index.cjs` APP_VERSION、`SstapNext.Agent.csproj` `<Version>`、`Program.cs` 输出、README/CHANGELOG/docs、渲染层侧栏，均一致。

未发现越权执行 route/netsh/清空 DNS/关闭防火墙的代码（grep 无 `route delete`/`netsh`/`Set-NetFirewall`/`Disable-NetAdapter` 等，仅文档中作为“禁止”说明出现）。

---

## 7. NOT RUN / 未验证项与原因

| 项目 | 状态 | 原因 / 最短复现 |
|---|---|---|
| `scripts\Run-Tun-SmokeTest.ps1`（无路由 Wintun smoke） | **NOT RUN** | 需 UAC；未获用户明确批准，按约束只做静态检查与构建。获批后：`Set-ExecutionPolicy -Scope Process Bypass; .\scripts\Run-Tun-SmokeTest.ps1`。 |
| 真实 TUN（`auto_route=true`）/ 默认路由接管 / DNS 修改 | **NOT RUN** | 被任务约束禁止。 |
| 真实节点握手 / 真实 sing-box 代理流量 / 真实 Wintun | **NOT RUN** | 禁止连接真实节点；仅用仓库内 dummy fixture。 |
| 安装后 UI 启动 / 节点导入页面 | **NOT RUN** | 本会话未启动 GUI；`release\win-unpacked\SSTap Next.exe` 已生成但未运行验证。 |
| 模拟测试 ≠ 真实通过 | 已区分 | 49 项 Node 测试含模拟进程/SOCKS5 中继；18 项是**真实 sing-box 1.14.4 `check`**；二者在报告已分别标注。 |

---

## 8. 修改文件清单与修订记录

### 源码/脚本修复（本会话）

- `scripts/Build-Windows.ps1`、`scripts/Publish-Agent.ps1`、`scripts/Run-Tun-SmokeTest.ps1`：加 UTF-8 BOM；`ErrorActionPreference` `Stop→Continue`；原生调用加 `2>&1`。
- `scripts/Fetch-SingBox.ps1`、`scripts/Start-Tun-Agent.ps1`、`scripts/Export-NetworkSnapshot.ps1`：加 UTF-8 BOM。
- `scripts/validate-singbox-configs.mjs`：`require`→ESM `import`。
- `src/shared/tun-config.cjs`：`domain_resolver` 改字符串；新增 `route.default_domain_resolver`。
- `src/shared/node-parser.cjs`：Reality 默认 uTLS 指纹 chrome。
- `src/shared/tun-config.test.mjs`：`domain_resolver` 断言改字符串。
- `src/agent/SstapNext.Agent/Core/TunRuntime.cs`：`domain_resolver` 字符串校验 + `default_domain_resolver` 校验。

### 构建环境 workaround（非源码）

- `artifacts/7za-wrapper/{7za-wrapper.csproj,Program.cs}`：`-snld`→`-snl-` 转发工具。
- `node_modules/7zip-bin/win/x64/7za.exe` → 包装器；真实 7za 存为 `7za-real.exe`。重新 `npm install` 后需重放：重新 `dotnet publish artifacts\7za-wrapper` 并把产物覆盖回 `node_modules\7zip-bin\win\x64\7za.exe`（或改用管理员/Developer Mode 构建，则可移除该 workaround）。

### 版本控制

本目录**不是 git 仓库**，未执行 git commit。保留内容：完整源码、`release\`（安装包+blockmap+win-unpacked）、`artifacts\agent-win-x64`、`artifacts\7za-wrapper`、`dist\`、`runtime\sing-box`（含 DEPENDENCY.txt）、`build-0.3.0.log`、本报告。
