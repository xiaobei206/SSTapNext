## 0.3.15 设计阶段：实时流量统计与可读性

设计文档：`LIVE-TRAFFIC-AND-UI-READABILITY.md`。当前仅设计，代码与测试均 NOT STARTED。

验收范围：
- Clash API /connections 真实核心返回 `uploadTotal`、`downloadTotal`，本次上传与下载独立累计；速率差分、计时、连接重置及 final sample 正确。
- API 仅监听 loopback + 每会话随机 secret；Renderer 不持有 API 地址或凭据。
- 本地代理统计准确累加到对应 nodeId；TUN 包含 direct 时只展示系统会话总量，不写入节点累计。
- 旧加密 state 缺少 nodeTrafficStats 时安全迁移；统计仅保存有效节点；节点删除清理孤儿数据；10 秒批量写盘及退出 flush。
- 节点表所有指标排序稳定、缺失/超时/N/A 始终置底，且不改变选中/活动/勾选。
- 全局普通文本与 `small` 至少 14px；侧栏版本标签与辅助文字相同字号/常规字重/低对比度；窄窗口、节点列表滚动不回归。
- 在固定 sing-box 1.14.4 上增加启用 Clash API 的 Proxy 与 TUN 核心配置检查；不升级内核、不增加 npm 依赖。

真实 Windows 10/11 验收需包含：本地代理实时上/下行速度与分开累计、断开 final/reconnect reset、多个节点累计不串账、重启持久化、TUN 直连与代理流量、API 失效状态、节点删除、字号与缩放布局。CI 不替代实机验收。

# SSTap Next 0.3.14 — 测试计划与验证边界

## 当前版本与 CI 范围

- 当前正式版本为 0.3.14；Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.14。上一正式版本为 v0.3.13。
- 这是个人项目，日常只在 main 开发，不建立 feature 分支或 PR。每项开发都必须先更新文档（目标、现状、设计、影响文件、安全约束、验收与测试），再修改代码；上下文结束前必须完成交接文档。
- main 发布 commit：8f4be60d480e798bf3d17291230454df70674c86；该版本 Node CI run 42344552127、Windows Release run 42344552136 均成功。
- 当前代码变更的验证证据：Node tests 86/86、package-lock 704/704、sing-box 55/55、Windows x64 Agent、TypeScript/Vite、NSIS 和 SHA-256 均通过。PR 最新功能 HEAD 的 run：42343664603 / 42343664600；main 发布 run：42344552127 / 42344552136。
- 之后 main 文档提交对应 CI run 42344692593 和 Windows workflow run 42344692572 也成功；由于 v0.3.12 Release 已存在，文档提交不会重建/覆盖安装包。每轮新开发仍必须核对本次最新 SHA 对应的 run。
- package-lock 检查覆盖 704 个依赖引用；不得为“修复 CI”而弱化依赖版本范围校验。
- 新规则库样式须满足项目全局最小字号 14px 的回归约束。
- 上述 CI/构建证据不等于用户 Windows 10/11 实机验收；真实规则库行为、节点出口、DNS、UDP/QUIC、TUN/Wintun 仍按 WINDOWS-ACCEPTANCE.md 逐项记录。


## 0.3.13：批量节点检测与测速（已发布；用户实机验收进行前）

完整设计与当前基线见 [CONCURRENT-NODE-TESTING.md](CONCURRENT-NODE-TESTING.md)。

自动化测试至少覆盖：
- ICMP PING 成功/丢包/超时/解析失败、TCPING 成功/拒绝/超时，以及 Hysteria2 TCPING=N/A。
- 节点列表全部/选中节点任务；并发节点数 1/2/4/8/16/32；worker 上限、单节点失败隔离、逐节点进度。
- 临时 sing-box worker 的端口/配置/进程隔离；set_system_proxy=false 和 loopback-only；不修改 Windows 系统代理。
- 主连接复用/隔离：不自动切换或断开用户当前节点；TUN 锁保持有效。
- 任务取消后无遗留子进程、临时配置和端口监听；节点删除/订阅更新后结果关联稳定。
- 10 MB HTTP Range 下载、备用源回退、每节点速度结果存储和重启后显示。

Windows 实机必须进一步测试 1/2/4/8/16/32 并发的 CPU/内存/带宽、系统代理不变、用户活动连接不受影响、取消后的完整清理。500 Mbps 出口下同时下载会共享带宽，不能把并发速度直接与单节点串行峰值比较。

0.3.13 已实现 speedTestThreads=单节点 Range worker 1/2/4/8/16/32，并另增 batchTestConcurrency=同时测速节点 1/2/4/8/16/32（默认 4）。单批最多 32 个节点；每批一个 sing-box 临时进程；每节点 loopback inbound 独立绑定自身 outbound；final=block；系统代理不变。

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
- 再额外 1 组多节点批测专项配置：两个 mixed loopback inbound、两个 node outbound，验证 route inbound 精确绑定、set_system_proxy=false 和 final=block。总计 56 次 sing-box check。若核心版本不同于默认下载基线，仍以当前核心实际校验结果为准。

## Windows 完整构建

发布新版本的 main Windows workflow（也支持 workflow_dispatch / PR 验证）必须在 windows-2022 runner 上完成：

1. Node.js 22、.NET 10 SDK 安装和 npm ci。
2. package-lock 检查和 Node tests。
3. 当前 sing-box 核心 56 项配置检查。
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


### 新增批量节点测速实际代码覆盖

- src/shared/batch-node-test.test.mjs：ICMP/中文 Windows 输出、ping child 取消等待 close、TCPING、非 2 的幂次节点并发线程预算、loopback 多 inbound/outbound 路由、worker pool 并发/失败隔离/取消、两节点单进程集成、取消后临时配置清理。
- src/shared/singbox-config.cjs：buildBatchProxyConfig；每节点 inbound tag/outbound tag 一一对应；final block；仅 127.0.0.1 且 set_system_proxy=false。
- apps/desktop/src/main/index.cjs：可信 renderer IPC、节点 ID 校验、TUN 安全锁、nodeTestResults 加密持久化、节点删除结果清理、退出时取消并等待批测清理。
- apps/desktop/src/renderer/src/main.tsx：节点页结果列、勾选/全选、同时测速数和 Range 线程参数、全部/选中、逐项进度、取消。
- 以上为代码覆盖说明；实际通过数量和 Windows 构建结果必须以本次最新 main SHA 的 Actions logs 为准。用户 Windows 实机 1/2/4/8/16/32 压力测试、系统代理不变、活动连接隔离和取消清理仍 NOT RUN。



## 0.3.13 Release — 已正式发布并核验（2026-11-07）

- Tag / Release：v0.3.13 — https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.13
- Release target commit：`9d733967fb8c1280da6a1603b7ab9f733da6eccf`
- 当前 main 文档接力 HEAD（更新前）：`5344ca830e2625f4575467e6ed234c58f16006ad`；与 Release target 的差异为 Release 后续文档同步，不改变 0.3.13 运行时代码。
- Node CI：run `42352257931`（版本提交 SHA）和 run `42352323487`（当前文档 HEAD SHA）均 success；日志：`npm test 97/97 PASS`、`npm run verify:lock` 中 704 个依赖引用全部兼容。
- Windows Release workflow：run `42352257898`，job `128342706123`，success；npm ci、release version 校验、package-lock 校验、Build-Windows、安装包验证、Release 发布及 artifact 上传均 success。
- sing-box：当前 runtime 核心 1.14.4，真实配置矩阵 **56/56 PASS**（54 基础组合 + SSTap 本地规则集 + 多节点批测配置）。
- 安装程序：`SSTap.Next-0.3.13-x64.exe`，174,891,825 bytes；SHA-256：`113105a99e5201f6f7a3013ee82ce8583bcc6f69f88fea9d969e35b52b15abcd`。
- Blockmap：`SSTap.Next-0.3.13-x64.exe.blockmap`，182,868 bytes。
- SHA-256 sidecar：`SSTap.Next-0.3.13-x64.exe.sha256`，93 bytes。
- Workflow artifact：`SSTapNext-main-Windows-x64`，ID `13566081600`，175,084,704 bytes，尚未过期。
- Release API 已核实三个资产均实际存在；安装程序 SHA-256 与 Windows 构建日志和 Release asset digest 一致。
- **NOT RUN：** 用户 Windows 10/11 实机的 1/2/4/8/16/32 并发 CPU/内存/共享带宽压力、Windows 系统代理前后状态比对、正在使用的连接不被切换/中断、取消后进程/端口/临时配置完全清理，以及真实节点公网出口/协议连通性。不可用 CI 替代这些实测。


## 0.3.14 — Windows 中文 ping 输出编码回归

- 用户真实证据：PowerShell `ping -n 3 -w 1000 65.49.237.84` 返回 45ms、43ms、43ms，0% 丢包，平均 43ms；0.3.13 列表却错误显示 PING 超时。
- 新 parser 测试必须覆盖英文 `time=43ms`、中文 `时间=43ms`、OEM 中文前缀被 UTF-8 解码成乱码但仍保留 ASCII `=43ms`、`<1ms`、部分丢包、0 回复超时。
- 核心断言：中文前缀损坏不能使有效 RTT 变成 timeout；接收数/平均 RTT/丢包率与回复条数一致；真正无回复仍为 timeout；DNS 失败仍为 error。
- `runIcmpPing()` 仍须使用参数数组启动 ping.exe，取消后等待子进程 close；测试必须保留这个生命周期断言。
- Windows 真实验收：批测 65.49.237.84，应显示约 43ms；系统代理、主连接、TUN 不受影响。
- 全量发布验证：npm test、verify:lock（704 refs）、sing-box 56 项、Windows .NET Agent、TypeScript/Vite、NSIS、安装包 SHA-256；Actions 必须对应本次 0.3.14 commit。


### 0.3.14 实际验证结果（2026-11-07）

- Node CI run 42353385323，最新 parser/test commit `d0fbcd52c87aa94c60aeb054789e5fc786e71868`：**98/98 PASS**，0 fail。
- package-lock 检查：**704/704 PASS**。
- Windows Release run 42353296447 / job 128345843932：**success**；Build-Windows 中 sing-box **56/56 PASS**、Agent、TypeScript/Vite、NSIS、installer SHA 验证及 Release 上传成功。
- 用户实机对 65.49.237.84 的批测 PING 复测仍 **NOT RUN**，须安装 0.3.14 后确认约 43ms。
