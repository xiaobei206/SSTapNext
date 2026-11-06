# SSTap Next 0.3.2 — 代码审查边界与验证限制

## 项目既有实现（0.3.0 基线）

1. 节点解析与订阅：VLESS、Hysteria2、SS、VMess、Trojan；批量/Base64/订阅导入、来源管理与原子刷新。
2. 本地代理：sing-box 版本/配置预检，loopback-only mixed inbound，生命周期管理和清理。
3. 测速：延迟、流式下载、单/多线程 Range 严格校验、取消、最近历史，所有网络请求经 SOCKS5。
4. TUN：双栈地址、自动路由、严格路由、DNS hijack、三个分流模式、远端 rule-set 与自定义规则。
5. Agent：UAC、固定核心定位、会话 SHA-256、路径/重解析点检查、出站/DNS/日志/缓存约束、心跳停止、接口移除检测。
6. 交付：sing-box 下载哈希锁定、18 组配置检查、.NET 自包含发布、Vite/TypeScript 构建、NSIS 打包和诊断脚本。

## 自动化验证（0.3.1 历史记录）

- `node --test src/shared/*.test.mjs`：0.3.1 历史状态为 49/49 PASS。
- `node --check apps/desktop/src/main/index.cjs`：PASS。
- `node --check src/shared/tun-controller.cjs`：PASS。
- `node --check scripts/doctor.mjs` 与 `scripts/validate-singbox-configs.mjs`：PASS。
- 6 个协议 fixture 均由节点解析器成功解析。

## 尚未在本环境验证

- 真实 sing-box 1.14.4 的 18 组 `sing-box check`（由 Windows 一键构建脚本运行）。
- Windows .NET 10 Agent 编译、NSIS 安装包与应用安装/卸载。
- 真实 VLESS / Hysteria2 / SS / VMess / Trojan 远端握手。
- Windows TUN/Wintun 适配器创建/移除、实际路由和 DNS 接管。
- IPv4/IPv6、TCP/UDP、QUIC、换网、休眠、崩溃及 UAC 取消后的系统恢复。

本项目自动测试有模拟进程和模拟 SOCKS5 中继，不等同于真实协议、真实节点或真实 Windows 内核验证。未执行的项目必须保持 NOT RUN/NOT VERIFIED。

## 安全放行门槛

1. Windows 构建完整通过，Agent 与核心均进入安装包且路径正确。
2. Wintun smoke test 两次连续通过，测试期间与测试后默认路由、其他路由、DNS 快照保持一致。
3. 本地代理经真实节点连接成功，实际 HTTP 请求和测速都经代理。
4. TUN 全局模式验证 TCP、UDP、DNS、IPv4、IPv6、断开恢复。
5. bypass-cn 与 custom rule 验证境内/境外、direct/proxy/block、进程匹配。
6. 异常退出、UAC 取消、断网、网络切换、休眠唤醒之后没有残留 TUN 适配器和非预期路由。

任何一项导致路由/DNS 残留或 `cleanup_error`，必须停止接管测试，保存快照与日志，不允许 Harness 自动使用猜测性 route delete / 清空 DNS 修复。


## 0.3.1 历史增量审查

- `TunRuntime.cs`：复核 Down 状态旧接口放行、启动前适配器快照、同一适配器状态/地址变化判断、异常分支 `cleanup_error` 判定。
- Electron 主进程：复核 `assertTrustedRenderer`、IPC handlers 调用点、窗口隔离和导航/外部链接约束。
- 版本与交付：复核 0.3.2 版本号同步、串行测试入口、Windows 构建脚本预检与交付路径。
- 0.3.1 当时执行 Node 测试 49/49 和 `.cjs/.mjs` 语法检查；.NET、TypeScript/Vite、sing-box Windows 配置检查、NSIS 和真实 TUN 未完成，具体原因见 `RELEASE-0.3.1.md`。


## 0.3.2 本轮增量审查

- `NativeConsoleProcess.StopGracefullyAsync`：核对 Windows API 控制事件类型与进程组定向语义；从 CTRL_C_EVENT 改为 CTRL_BREAK_EVENT。
- 强制终止路径：检查 TerminateProcess 返回值，并等待进程句柄进入 signaled 状态；不能确认退出时抛错。
- `TunRuntime`：正常/异常清理后均核对核心是否真实退出；核心未退出或本次 TUN 资源仍残留时保留 `cleanup_error`，不允许桌面端将其当作普通 error 清理会话目录。
- 诊断输出：清理失败时记录 Adapter Name、Description、Id、OperationalStatus、NetworkInterfaceType 和 Unicast IP。
- 回归测试：新增 3 项 Node 源码契约测试，覆盖 CTRL_BREAK_EVENT 定向发送、进程退出确认及残留网卡细节记录；另新增 1 项 0.3.1 已知清理锁迁移测试。
- 限制：当前容器无 .NET SDK / Windows 控制台 / Wintun，不能代替 Windows Agent 编译及真实 CTRL+BREAK 动态验收。


## 0.3.3 本轮增量审查

- `TunRuntime.RunAsync()`：复核 CS0136 的两个局部变量声明作用域；正常清理分支使用 `retainedAdapter`，清理失败分支保留 `remainingAdapter`。
- 新增 `agent-stop-contract.test.mjs` 的命名冲突回归断言。
- 本环境无 .NET SDK；C# 编译仍须由 Windows 10/11 + .NET 10 SDK 的构建脚本验证，不能将 Node 测试等同于 Agent 编译通过。


## 0.3.4 本轮增量审查

- 对照 0.3.2 与 0.3.3 的 `package-lock.json`，定位 ETARGET 根因：依赖请求范围被不一致地改写，和锁定版本不匹配。
- 0.3.4 锁文件依赖图恢复为 0.3.2 已在用户 Windows 构建中通过 npm install 的版本，仅更新根项目版本字段。
- 新增无外部依赖的锁文件一致性检查器，当前验证 704 个依赖引用；对故意注入 `@jridgewell/trace-mapping@^0.3.38` / locked `0.3.31` 的负向样本能正确报错。
- `Build-Windows.ps1` 在核心下载和 npm install 之前运行预检，避免重复下载或错误安装。
- 当前容器执行 Node 测试 56/56、Node 语法检查、npm offline package-lock-only 检查；完整联网依赖安装、.NET Agent 编译、NSIS 和真实 TUN 仍须 Windows 实机验证。


## 0.3.5 IPv4-only DNS fallback

- Production TUN DNS strategy is now `ipv4_only`, because the user's observed node egress passes IPv4 HTTPS tests but fails IPv6 TLS to both YouTube and YouTube API endpoints.
- The TUN itself remains dual-stack and `auto_route`/`strict_route` remain enabled; IPv6 is not removed from route capture, avoiding an accidental direct IPv6 leak.
- The persistent sing-box cache path is versioned to `sing-box-cache-ipv4.db`; the prior `sing-box-cache.db` is preserved and not deleted, preventing prior AAAA cache entries from contaminating the first IPv4-only verification.
- Unit tests cover all three modes and assert both IPv4-only DNS strategy and dual-stack TUN addresses. The Windows build's sing-box 1.14.4 `check` stage remains the final schema validation.


## 0.3.6 本轮增量审查

- DNS 地址族：保留 `ipv4_only` 默认；新增 `prefer_ipv4` 与 `prefer_ipv6` 双栈策略，UI 与主进程 IPC 均限制为 TUN 断开后才能修改；Electron 与 Agent 的三种独立缓存文件名白名单一致。
- 测速：默认采用 Hetzner FSN1 测试文件，配置 ASH/HIL/NBG1 备用源；对 HTTP 403/404/408/429/5xx 及受控网络/TLS错误自动回退，保留取消信号和 HTTPS 不降级约束。
- UI：检查全局显式字体声明最小值 14px、接管按钮 hover/active/focus 反馈，以及按钮禁用原因提示。
- 核心管理：启动时显示实际核心版本，设置页可打开核心目录；不自动升级，构建在已有核心时不覆盖，使用实际核心执行 54 项配置解析检查。
- 验证边界：Node 自动化测试 65/65、依赖锁引用 704/704、JS/CJS/MJS 语法检查与 PowerShell BOM 检查在本容器执行；.NET Agent、54 项真实 sing-box check、TypeScript/Vite、NSIS 与 Wintun 动态行为须在 Windows 机器验收。


## 0.3.7 本轮增量审查

- 对照用户最新 Agent 错误：sing-box PID 已退出；适配器 `Description=sing-tun Tunnel #3`、`Status=Down`、`Addresses=[]`。
- 0.3.6 `IsSessionResidualAdapter()` 在 pre-start adapter snapshot 为空时，只检查同名适配器对象是否存在；Windows 保留的 Wintun 设备对象会造成误报。
- 0.3.7 新增 `IsAdapterOperationallyActive()`：仅 `OperationalStatus.Up` 或仍持有 `172.19.0.1` 的接口才可能构成活动残留。Down 且无 TUN 地址视为已释放，接口不删除。
- 安全边界：活动接口或仍含 TUN 地址的接口仍会触发 `cleanup_error`；没有改动核心进程退出确认、UAC、路由/DNS 或网卡删除策略。
- 新增 2 项 Node 源码契约测试；不替代 C# 编译和真实 Wintun 验收。
