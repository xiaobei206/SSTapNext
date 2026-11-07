# SSTap Next 0.3.12 — 测试计划与验证边界

## 当前版本与 CI 范围

- main 当前仍为 0.3.11；0.3.12 位于 PR #1 的功能分支，合并前只以 PR 最新 HEAD 对应的 Actions 结果作为验收证据。
- GitHub CI 执行锁定依赖安装（npm ci）、完整 Node 自动化测试和 package-lock 一致性检查。
- package-lock 检查覆盖 704 个依赖引用；不得为“修复 CI”而弱化依赖版本范围校验。
- 新规则库样式须满足项目全局最小字号 14px 的回归约束。

## SSTap .rules 转换与规则库

| 项目 | 验证范围 | 关键断言 |
|---|---|---|
| 头部动作解析 | 真实上游样本与单元测试 | 第三个字段 0=proxy、1=direct；不按文件名猜动作 |
| CIDR 解析 | IPv4、IPv6、显式前缀、缺省主机前缀 | 非法地址/前缀拒绝；重复 CIDR 去重；单文件错误不部分导入 |
| ZIP 安全性 | ZIP 中央目录、路径、压缩方式、条目大小和 CRC-32 | 拒绝 ZIP64/分卷/加密/路径穿越/CRC 不匹配/异常大小 |
| 在线更新 | commit 固定下载、版本目录、manifest、current.json | 相同 SHA 不重复更新；失败不切换活动版本；旧版本保留 |
| 规则选择 | 持久化 ID、上游规则移除 | 保留仍存在的选择；清理已不存在的 ID |
| TUN 约束 | 更新/更改选择时的 Agent 状态 | requested/awaiting_uac/starting/running/stopping 阶段禁止修改 |
| 动作与优先级 | proxy/direct 两种动作、bypass-cn 叠加 | 游戏规则先于自动 BypassCNandLan，再先于 GeoSite/GeoIP fallback |

## sing-box 实际核心检查

Windows Build-Windows.ps1 使用本机 runtime/sing-box 中的真实核心执行：

- 54 组基础组合：6 类节点协议 × 3 种分流模式 × 3 种 DNS 地址族策略。
- 额外 1 组 SSTap 专项配置：加载两个真实格式的本地 source rule-set fixture，一个 Proxy、一个 Direct；检查规则顺序位于自动大陆规则和 GeoSite/GeoIP 之前。
- 总计 55 次 sing-box check。若核心版本不同于默认下载基线，仍以当前核心实际校验结果为准。

## Windows 完整构建

PR 的 Windows workflow 必须在 windows-2022 runner 上完成：

1. Node.js 22、.NET 10 SDK 安装和 npm ci。
2. package-lock 检查和 Node tests。
3. 当前 sing-box 核心 55 项配置检查。
4. .NET 10 win-x64 Agent 自包含发布。
5. TypeScript / Vite 构建。
6. Electron NSIS 安装包生成。
7. 安装包、blockmap 和 SHA-256 校验并上传 workflow artifact。

PR 触发构建但不发布正式 GitHub Release；正式 Release 只能由 main/tag 发布流程创建。被后续提交取消的旧 Actions run 不能作为当前 HEAD 的通过证据。

## 必须由用户在 Windows 10/11 实机确认

- 安装并启动当前 PR 对应安装包，检查规则库页面、搜索、启用/停用和状态展示。
- 首次下载完整规则库；核对上游版本 SHA、规则总数、CIDR 总量和更新时间。
- 验证头部 0/1 的 Proxy/Direct 映射，尤其游戏规则与大陆规则有 CIDR 重叠时的优先级。
- 在 TUN 连接、断开和启动过渡阶段，确认规则更新/选择控件被禁用。
- 模拟上游不可达、下载截断、ZIP CRC 错误或解析失败；确认旧规则版本保持可用。
- 验证全局代理、绕过中国大陆、自定义规则、UDP/QUIC、DNS 和真实节点公网出口。
- 至少 10 轮 TUN connect → disconnect → reconnect；检查核心真实退出、路由/DNS 恢复和 Wintun 清理状态。

**CI 通过、Windows 编译和 sing-box check 不等于真实节点握手或真实 TUN 已验收。** 若出现 cleanup_error、路由/DNS 残留或非预期物理网卡直连，立即停止后续接管测试；不得用删除未知网卡、route delete、重置 Winsock 或清空 DNS 来绕过保护。
