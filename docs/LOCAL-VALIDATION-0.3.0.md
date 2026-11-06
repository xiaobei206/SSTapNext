# 0.3.0 本轮本地验证报告

执行环境：Linux 容器，Node.js v22.16.0。不是 Windows；没有 .NET 10 SDK、Wintun 驱动或 sing-box Windows x64 核心。

| 命令/检查 | 结果 | 证据/备注 |
|---|---|---|
| `node --test src/shared/*.test.mjs` | PASS 49/49 | 本轮完整输出 49 tests、0 fail |
| `node --check apps/desktop/src/main/index.cjs` | PASS | 主进程语法 |
| `node --check src/shared/tun-controller.cjs` | PASS | TUN 会话控制语法 |
| `node --check src/shared/tun-config.cjs` | PASS | TUN 配置生成语法 |
| `node --check scripts/doctor.mjs` | PASS | 诊断脚本语法 |
| `node scripts/doctor.mjs` | PASS with expected WARN | Node 与项目版本通过；npm 依赖、核心、Agent、安装包未在此容器构建 |
| `node --check scripts/validate-singbox-configs.mjs` | PASS | 批量配置检查脚本语法 |
| 6 协议 fixture 解析 | PASS 6/6 | VLESS Reality、VLESS WS、Hysteria2、SS、VMess WS、Trojan gRPC |
| `sing-box check` 18 组真实配置 | NOT RUN | 当前容器未安装固定 Windows 核心；由 Windows Build 脚本执行 |
| .NET 10 Agent 编译 | NOT RUN | 当前容器无 dotnet SDK |
| TypeScript/Vite 正式构建 | NOT RUN | npm dependencies 未安装；需要 Windows Harness 执行完整流水线 |
| NSIS 安装包 | NOT RUN | 需要 Windows x64 + electron-builder |
| Wintun smoke / real TUN | NOT RUN | 需要目标 Windows 机器与 UAC；真实 TUN 还会接管路由/DNS |

额外源码审查修正：

- 修复 `doctor.mjs` 在 ESM 中调用 `require` 导致诊断命令崩溃的问题，改用 ESM imports。
- TUN Agent 启动前若发现同名 `SSTap Next` 网卡已存在，则拒绝接管/删除，避免覆盖其他会话残留接口。
- VLESS Reality 配置验证 fixture 使用 32-byte Base64URL 格式占位公钥，避免 `sing-box check` 因明显格式错误而无意义失败。
- README、架构、测试计划、安全门槛与 Harness 一次性任务已统一到 0.3.0 状态。

**结论**：本轮通过的 49 项是 Node 自动化回归，不代表真实 Windows 网络验收通过。Windows 实机验收报告必须由 Harness 构建与用户按 `WINDOWS-ACCEPTANCE.md` 测试后补充。
