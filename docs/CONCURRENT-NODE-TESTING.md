# 批量节点检测与测速（目标版本 0.3.13）

状态：**需求已确认，设计文档先行；当前尚未实现，0.3.12 正式版不包含本功能。**

## 1. 用户需求

用户使用 500 Mbps 宽带，测速文件通常为 10 MB。希望节点数量较多时无需逐个选节点测试，节点管理页直接显示每个节点的检测结果；批量任务可以选择 1 / 2 / 4 / 8 / 16 / 32 个并发工作线程。

需要同时解决当前单节点测速启动慢、让用户误以为必须先“生成系统代理”的体验问题。用户参考 v2rayN 的节点列表批量检测方式。

## 2. 当前实现与性能原因（修改前基线）

### 2.1 单节点测速现状

- Renderer 的 runSelectedSpeedTest() 只传入 selectedNodeId，只能测试一个当前选中节点。
- Electron IPC sstap:speed-test 会先校验 TUN 状态；没有运行同一节点时调用 CoreController.connect(node)，启动一次临时 sing-box。
- CoreController._connect() 的步骤包括：检测核心、分配 loopback 端口、生成单节点临时配置、执行 sing-box check、启动 sing-box、轮询等待 SOCKS5 握手可用（最多 15 秒）。
- 下载测速随后经 127.0.0.1:<临时端口> SOCKS5 发请求；临时连接完成后由 IPC finally 分支断开。
- 如果当前已连接同一节点则复用当前本地代理；若连接了不同节点则拒绝测速。
- 当前 speedTestThreads 是**单个节点下载时 Range 分段/HTTP worker 数**，允许值 1、2、4、8；不是同时测试多少个节点。src/shared/socks-speed-test.cjs 已有多 Range 并发下载能力。
- 当前 sing-box mixed inbound 明确设置 set_system_proxy: false，仅监听 127.0.0.1；测速不应修改 Windows 系统代理设置。

### 2.2 为什么用户感觉慢

当前测速的耗时不只是下载 10 MB 文件，还包括临时 sing-box 的配置检查、进程启动、本地 SOCKS5 就绪探测、下载和进程清理。现有单节点 handler 每次只处理一个节点，尚无独立批量 worker 池。

**术语纠正：** 这里启动的是仅供应用内部测速使用的本地 SOCKS5 核心会话，不是 Windows“设置代理服务器”或系统代理接管。系统代理开关必须始终保持不被测速代码修改。

## 3. v2rayN 参考实现结论

对照 v2rayN 当前 2dust/v2rayN 仓库 ServiceLib/Services/SpeedtestService.cs：

- RunTcpingAsync 并发对节点 Address / Port 直接执行 TCP connect，更新节点延迟，不需要为每个节点先建立代理转发链路。
- RunMixedTestAsync 使用 MixedConcurrencyCount 控制同时处理的节点数；每个测试任务使用 LoadCoreConfigSpeedtest(it) 创建该节点的测试核心会话，通过该节点的本地 SOCKS 入口执行真实代理延迟/速度检测，结束后关闭测试核心。
- RunRealPingAsync 可以将一批节点放入一个临时测速核心配置后并发执行真实代理延迟请求。
- 因此应借鉴其**节点并发调度、独立测速配置、逐节点实时回填、可取消任务**，不是照搬其 UI 或无差别启动 32 个核心进程。

参考源代码：
- https://github.com/2dust/v2rayN/blob/master/v2rayN/ServiceLib/Services/SpeedtestService.cs

## 4. 0.3.13 目标 UI

所有检测值都在“节点管理 → 我的节点”列表中直接可见，避免用户为了查看结果切换到“节点测速”页。

节点行建议列：

| 节点 | PING | TCPING | 代理延迟 | 下载速度 | 最近检测 |
|---|---:|---:|---:|---:|---|
| 日本节点 | xx ms / 丢包 | xx ms | xx ms | xx Mbps | 时间 |
| Hysteria2 | xx ms / 丢包 | 不适用 | xx ms | xx Mbps | 时间 |

空值显示 —；测试中显示进度/检测中；超时、拒绝、解析错误等应显示明确状态，不能都用一个 -1。

节点列表上方提供：
- **一键全部检测**：对所有节点执行 PING、TCPING（协议适用时）、真实代理延迟与下载测速。
- **检测选中节点**：仅处理勾选节点。
- **取消检测**：取消正在运行的批量任务，停止本任务启动的核心进程并清理临时文件。
- 结果直接逐行更新；不等待全部节点结束才一次性回填。
- 可选提供“仅延迟 / 延迟+下载”两种任务模式；完整下载测试应由用户显式启动，或在“全部检测”里按用户偏好包含。

## 5. 并发参数的定义

用户指定并发选项：**1 / 2 / 4 / 8 / 16 / 32**。

为避免概念混淆，必须在 UI 标注“同时测速节点数”，而不是让用户误以为它是每个节点的 HTTP Range 分段数。

- 同时测速节点数：批量 worker 并发上限，允许值 1、2、4、8、16、32。
- 单节点下载 Range 线程数：沿用现有 speedTestThreads 概念，单独定义。不可把两个参数相乘后无上限地开连接；需设置总连接/总资源保护并合理默认值。
- 选中的节点少于并发值时，实际 worker 数不得超过选中节点数。
- 对 500 Mbps 共享出口，多个节点同时下载的速度会共享带宽；并发越高，每个节点测得速度越接近“竞争状态下的分配值”，不等同于逐个单测的峰值。结果中应保留测试线程数、下载字节数和耗时以便解释。
- 对用户常用的 10 MB 文件，保留可配置的下载量与 URL；确认测试源支持 HTTP Range 和可靠返回，不可因并发而重复下载整份文件造成流量失控。

## 6. 指标定义

### ICMP PING
- 对节点 server 主机名/IP 发 ICMP Echo，建议 3 次。
- 显示平均 RTT 和丢包率；如全部超时显示“超时/可能屏蔽 ICMP”，不能直接判断代理节点坏掉。
- 不经节点代理，仅代表本机到服务器地址的网络层连通性。
- Windows 域名解析、IPv4/IPv6 选择和本地化输出必须可靠；不得以解析失败冒充 ICMP 超时。

### TCPING
- 对 TCP 类型节点的 server:server_port 建立原始 TCP 连接，至少记录连接耗时。
- 不经过节点代理，不做 TLS/协议鉴权；只能说明 TCP 端口可建立连接。
- Hysteria2 是 UDP/QUIC 服务，TCPING 应标为“不适用”，不得拿 TCP 失败判断 Hysteria2 不可用。
- 对 TCP 被屏蔽/拒绝/超时/域名解析失败分别保留错误类别。

### 真实代理延迟
- 为单个节点生成隔离的测试出口/本地 SOCKS5 入口，通过该节点实际协议发起小型 HTTP 请求。
- 测量从请求开始至有效 HTTP 响应的耗时；复用或明确预热 DNS/TLS 的策略，区分冷启动与稳定请求。
- 不能用 ICMP/TCPING 代替此指标。TCP 端口开着不代表代理协议认证/TLS/传输成功。
- 失败要保存具体原因（核心启动、DNS、TLS、认证、连接超时、HTTP 状态码等）。

### 下载速度
- 使用现有 downloadSpeedTest() 和用户配置的测速 URL/下载量（用户常用 10 MB）。
- 通过每个节点独立的本地 SOCKS5 入口，HTTP Range 分段下载，逐节点记录 average/peak Mbps、HTTP latency、bytes、elapsed、threads、URL 和时间。
- 批量测试期间可实时显示每节点进度/结果；任何节点失败不得中断其他节点，除非用户点取消。
- 当前已有测速主源/备用源回退逻辑，应保留。

## 7. 运行隔离、安全与生命周期

1. **绝不改 Windows 系统代理。** 临时测试配置的 mixed inbound 只能监听 loopback，set_system_proxy: false；禁止调用系统代理写入/恢复逻辑。
2. **不占用主连接控制器。** 新建专用 batch speed-test service / runner，不能通过反复调用单例 CoreController.connect() 来切换 32 个节点，也不能为了测速断开用户当前正在使用的节点。
3. 每个测试任务/worker 应有独立 session ID、动态 loopback 端口、临时配置路径、AbortSignal 和明确的进程归属。仅能终止本批测试创建的子进程。
4. 测试使用完成后清理该批任务创建的临时配置、临时状态和子进程；清理失败记录诊断，不能误杀用户正常核心或 TUN Agent。
5. 不把节点 URI、UUID、密码、订阅 URL、用户状态或生成的完整配置写进日志/测试结果。
6. TUN active/recovery/starting/stopping/cleanup_error 时仍按现有安全边界拒绝真实代理批量测速，不因批测而接管/修改系统网络。纯 ICMP/TCP probe 是否允许在 TUN 中运行，应明确路由含义并分别验收。
7. 若已有本地核心正在连接：
   - 测试同一节点可在安全且不改变运行状态的前提下复用已有 SOCKS；
   - 测其他节点必须使用隔离测试会话；
   - 不得自动切换、断开或覆盖当前活动节点。
8. 任务必须可取消、进度可观察；取消后等待并确认本任务启动的子进程退出，再释放对应资源。
9. 默认并发不能造成无控制的 32 个完整核心持续运行；必须测试 8/16/32 并发的 CPU、内存、连接数、错误率和取消清理表现，必要时使用一个多 outbound/multiple inbound 的专用测试核心或有界 worker 核心池。

## 8. 技术实现路线（设计约束）

- 新增独立模块，例如 src/shared/batch-node-test.cjs，将 PING、TCPING、临时 sing-box/SOCKS 测试和调度统一编排；不要将并发逻辑塞进 Renderer。
- 单节点临时测试配置由现有 buildProxyConfig() 复用其节点 outbound 生成逻辑，但 set_system_proxy: false 和 loopback-only 必须有自动化断言。
- 先做不需代理核心的 ICMP/TCP probing；之后按 worker 并发执行真实代理延迟和下载测试。
- 批量运行器通过 callback/event 回填 { nodeId, metric, status, value, message, testedAt, progress }，主进程校验 renderer 来源并推送事件。
- IPC 需支持 start-all / start-selected / cancel / progress，并对 node IDs、并发上限、参数类型和节点数量做严格验证。
- 复用当前测速源回退机制与 range download engine；需要把 downloadSpeedTest() 的取消和并发边界做成可组合、可独立测试的接口。
- 节点结果可以新增受限的 nodeTestResults map 或内存/持久化结果结构；限制最大条目数并处理节点删除/订阅刷新后的孤儿记录。不要把测速结果写入敏感凭据对象。
- 节点页 UI 采用表格/列式布局，适配长节点名、窄窗口和大量节点；保存结果后重启应用仍可看到最后一次检测值和时间。
- 结果列应可排序（延迟/速度/名称）属于推荐增强，不得因此扩大为自动切换当前节点。

## 9. 验收和测试清单

### 自动化测试
- ICMP 成功/丢包/全部超时/域名解析失败/IPv4 与 IPv6 场景。
- TCPING 成功/ECONNREFUSED/ETIMEDOUT/ENOTFOUND，Hysteria2 显示 N/A。
- 单节点和多节点任务、选中节点、全部节点、0 节点、重复 nodeId、已删除 nodeId。
- 并发上限 1/2/4/8/16/32；节点数量小于并发上限；确保全局活动 worker 不超限。
- 单个节点失败不影响其他节点继续；进度和结果按 nodeId 正确回填。
- 取消任务：取消后无遗留子进程、无临时配置、无端口监听；其他用户连接继续运行。
- 临时核心启动失败、配置检查失败、SOCKS 未就绪、下载中断、备用测速源切换。
- set_system_proxy: false、loopback-only、不能修改 Windows Internet Settings / registry / 系统代理。
- 主核心连接同一节点/不同节点时不自动切换/断开；TUN 生命周期锁仍有效。
- 结果持久化、删除节点后的清理、订阅更新后稳定 ID 的沿用。

### Windows 10/11 实机
- 1、2、4、8、16、32 并发各跑一次，至少记录完成时间、成功/失败数、CPU/内存峰值、总流量和取消清理。
- 与 v2rayN 在同一节点、同一 URL/10 MB、同样并发节点数下横向比较；分别比较 TCPING、真实代理延迟和下载速度，不混用指标。
- 测试期间系统代理状态必须与测试前完全一致。
- 用户正常本地代理/TUN 连接不能被批量检测切换或断开。
- 记录 500 Mbps 共享出口并发时每个节点速度下降属于带宽竞争，不直接判为客户端故障。

## 10. 开发顺序

1. 文档优先：本设计、START HERE NEXT GPT、HANDOVER、TEST-PLAN、开发日志保持一致。
2. 独立实现 ICMP/TCPING 和节点结果显示。
3. 独立测速 Runner 与可取消 worker pool，先实现低并发并完成安全契约测试。
4. 复用现有 downloadSpeedTest，加入批量并发调度和单节点进度。
5. 再增加 16/32 并发资源压力与无系统代理改动验证。
6. 同步正式版本号至 0.3.13，更新 package.json/package-lock、UI/Agent/doctor/其他版本来源、CHANGELOG 和 docs/RELEASE-0.3.13.md。
7. 运行 Node 测试、lock 检查、sing-box 55 项配置检查、Windows Agent/TypeScript/Vite/NSIS 构建和实机验收。
8. 直接提交 main，检查对应 GitHub Actions，发布 v0.3.13 后核对 EXE、blockmap、SHA-256。

在代码开始前，不得跳过本设计文档，也不得把“并发节点数”和“单节点 Range 连接数”混作一个参数。
