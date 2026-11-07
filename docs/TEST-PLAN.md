# SSTap Next 0.3.12 — 测试计划与验证边界

## 当前版本与 CI 范围

- 当前正式版本为 0.3.12，代码已合入 main，Tag v0.3.12 和 GitHub Release 已发布：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.12。
- 这是个人项目，日常只在 main 开发，不建立 feature 分支或 PR。每项开发都必须先更新文档（目标、现状、设计、影响文件、安全约束、验收与测试），再修改代码；上下文结束前必须完成交接文档。
- main 发布 commit：8f4be60d480e798bf3d17291230454df70674c86；该版本 Node CI run 42344552127、Windows Release run 42344552136 均成功。
- 当前代码变更的验证证据：Node tests 86/86、package-lock 704/704、sing-box 55/55、Windows x64 Agent、TypeScript/Vite、NSIS 和 SHA-256 均通过。PR 最新功能 HEAD 的 run：42343664603 / 42343664600；main 发布 run：42344552127 / 42344552136。
- 之后 main 文档提交对应 CI run 42344692593 和 Windows workflow run 42344692572 也成功；由于 v0.3.12 Release 已存在，文档提交不会重建/覆盖安装包。每轮新开发仍必须核对本次最新 SHA 对应的 run。
- package-lock 检查覆盖 704 个依赖引用；不得为“修复 CI”而弱化依赖版本范围校验。
- 新规则库样式须满足项目全局最小字号 14px 的回归约束。
- 上述 CI/构建证据不等于用户 Windows 10/11 实机验收；真实规则库行为、节点出口、DNS、UDP/QUIC、TUN/Wintun 仍按 WINDOWS-ACCEPTANCE.md 逐项记录。

## SSTap .rules 转换与规则库

| 项目 | 验证范围 | 关键断言 |
|---|---|---|
| 头部动作解析 | 真实上游样本与单元测试 | 第三个字段 0=proxy、1=direct；不按文件名猜动作 |
| CIDR 解析 | IPv4、IPv6、显式前缀、缺省主机前缀 | 非法地址/前缀拒绝；重复 CIDR 去重；单文件错误不部分导入 |
| ZIP 安全性 | ZIP 中央目录、路径、压缩方式、条目大小和 CRC-32 | 拒绝 ZIP64/分卷/加密/路径穿越/CRC 不匹配/异常大小 |
| 在线更新 | commit 固定下载、版本目录、manifest、current.json | 相同 SHA 不重复更新；失败不切换活动版本；旧版本保留 |
| 规则选择 | 持久化 ID、上游规则移除 | 保留仍存在的选择；清理已不存在的 ID |
| TUN 约束 | 控制器 Promise、保留会话和 Agent 状态 | recovery/start/stop 在途、requested/awaiting_uac/starting/running/stopping/cleanup_error 时禁止规则更新与路由设置修改；规则更新期间禁止启动 TUN |
| 动作与优先级 | proxy/direct 两种动作、bypass-cn 叠加 | 游戏规则先于自动 BypassCNandLan，再先于 GeoSite/GeoIP fallback |

## sing-box 实际核心检查

Windows Build-Windows.ps1 使用本机 runtime/sing-box 中的真实核心执行：

- 54 组基础组合：6 类节点协议 × 3 种分流模式 × 3 种 DNS 地址族策略。
- 额外 1 组 SSTap 专项配置：加载两个真实格式的本地 source rule-set fixture，一个 Proxy、一个 Direct；检查规则顺序位于自动大陆规则和 GeoSite/GeoIP 之前。
- 总计 55 次 sing-box check。若核心版本不同于默认下载基线，仍以当前核心实际校验结果为准。

## Windows 完整构建

发布新版本的 main Windows workflow（也支持 workflow_dispatch / PR 验证）必须在 windows-2022 runner 上完成：

1. Node.js 22、.NET 10 SDK 安装和 npm ci。
2. package-lock 检查和 Node tests。
3. 当前 sing-box 核心 55 项配置检查。
4. .NET 10 win-x64 Agent 自包含发布。
5. TypeScript / Vite 构建。
6. Electron NSIS 安装包生成。
7. 安装包、blockmap 和 SHA-256 校验并上传 workflow artifact。

新版本 main push 在 Release 尚不存在时会执行完整构建并创建正式 Release；PR/workflow_dispatch 仅作为可选验证入口，不是本项目日常开发流程。被后续提交取消的旧 Actions run 不能作为当前 HEAD 的通过证据。

## 必须由用户在 Windows 10/11 实机确认

- 安装并启动当前 PR 对应安装包，检查规则库页面、搜索、启用/停用和状态展示。
- 首次下载完整规则库；核对上游版本 SHA、规则总数、CIDR 总量和更新时间。
- 验证头部 0/1 的 Proxy/Direct 映射，尤其游戏规则与大陆规则有 CIDR 重叠时的优先级。
- 在 TUN recovery/start/stop、running、cleanup_error 阶段，确认规则更新、规则选择、基础策略和 DNS 控件被禁用，并由主进程拒绝绕过 UI 的 IPC 修改。
- 在规则库下载/转换过程中，确认连接中心的 TUN 启动按钮禁用，主进程也拒绝并发 TUN 启动；待更新完成后恢复可用。
- 模拟上游不可达、下载截断、ZIP CRC 错误或解析失败；确认旧规则版本保持可用。
- 验证全局代理、绕过中国大陆、自定义规则、UDP/QUIC、DNS 和真实节点公网出口。
- 至少 10 轮 TUN connect → disconnect → reconnect；检查核心真实退出、路由/DNS 恢复和 Wintun 清理状态。

**CI 通过、Windows 编译和 sing-box check 不等于真实节点握手或真实 TUN 已验收。** 若出现 cleanup_error、路由/DNS 残留或非预期物理网卡直连，立即停止后续接管测试；不得用删除未知网卡、route delete、重置 Winsock 或清空 DNS 来绕过保护。
