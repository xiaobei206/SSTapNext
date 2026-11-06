# SSTap Next 0.3.4 — npm 锁文件修正版

## 故障来源

0.3.3 构建在 `[1/8] npm install` 失败：

```text
npm error code ETARGET
npm error notarget No matching version found for @jridgewell/trace-mapping@^0.3.38
```

核对 0.3.3 的 `package-lock.json` 后确认：

- `node_modules/@babel/generator` 请求 `@jridgewell/trace-mapping@^0.3.38`，但锁定包版本为 `0.3.31`。
- `node_modules/@jridgewell/gen-mapping` 请求 `@jridgewell/trace-mapping@^0.3.34`，锁定包仍为 `0.3.31`。
- `node_modules/@babel/generator` 请求 `@jridgewell/gen-mapping@^0.3.32`，锁定包版本为 `0.3.33`；这条本身满足，但也显示锁文件依赖元数据被不一致地改写。
- 根 `package.json` 的依赖清单并未要求这些新范围；问题位于锁文件而非用户 npm registry 配置。

## 修复内容

1. 以 0.3.2 的 `package-lock.json` 为依赖图基线。该版本的 Windows 构建已成功完成 npm 依赖安装并继续进入 Agent 编译阶段。
2. 只将锁文件根级 `version` 与 `packages[""].version` 更新为 `0.3.4`；其余 704 条依赖引用和包版本保持 0.3.2 已验证状态。没有升级或替换任何第三方依赖。
3. 新增 `scripts/verify-package-lock.mjs`，无需 node_modules 即可检查 package.json / lockfile 的根版本、根依赖清单，并验证每个依赖请求范围与实际锁定版本兼容。
4. 在 `Build-Windows.ps1` 前置 `[0/8]` 检查，发生锁文件错配时在下载 sing-box、运行 npm install 之前停止。
5. 新增两项测试：当前锁文件的依赖范围通过；模拟 0.3.3 的 `^0.3.38` / `0.3.31` 冲突时必须失败。

## 验证结果

| 验证 | 结果 |
|---|---|
| Node 自动化测试 | PASS 56/56 |
| 锁文件依赖引用 | PASS 704/704 |
| 负向锁文件测试 | PASS |
| `npm install --package-lock-only --ignore-scripts --offline --no-audit --no-fund` | PASS |
| Node.js 文件语法检查 | PASS |
| PowerShell UTF-8 BOM 检查 | PASS |
| doctor 版本识别 | PASS，识别 0.3.4 |
| .NET Agent / NSIS / 真实 TUN | NOT RUN HERE |

离线 `--package-lock-only` 结果证明 npm 能解析当前锁文件，不代表已下载并安装所有依赖；完整依赖下载、.NET Agent 编译和安装包仍由 Windows 构建机验证。

## 构建

在 Windows 11 PowerShell 5.1 中，源码根目录执行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

首先应看到：

```text
[0/8] 校验 package.json 与 package-lock.json...
[OK] package.json / package-lock.json 版本与根依赖一致。
[OK] 704 个依赖引用均与锁定版本兼容。
```

锁文件检查通过后，脚本才会下载 sing-box 并安装 npm 依赖。

## 修改范围

本次未修改 .NET Agent、`CTRL_BREAK_EVENT` 停止信号、TUN 网卡清理、旧会话迁移、sing-box 配置、DNS、路由或 Wintun 行为。
