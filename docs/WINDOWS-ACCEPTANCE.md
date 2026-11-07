# SSTap Next v0.3.16 — Windows 10/11 实机验收清单

状态截至 2026-11-07：v0.3.16 已正式发布；Node CI 107/107、lock 704/704、sing-box 58/58、Agent/TS/Vite/NSIS、安装包 SHA 和 Release 资产均有成功证据。**下列真实用户机器验收尚未回填，全部保持未验收。**

正式安装包与 SHA-256：见 [docs/RELEASE-0.3.16.md](RELEASE-0.3.16.md) 和 [v0.3.16 Release](https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.16)。本清单覆盖 v0.3.16 的累计功能：本地代理/订阅、节点批量检测、SSTap 经典规则库、DNS、TUN Agent 白名单修复与实时流量统计。

**安全顺序：先做普通代理和无路由 smoke test，全部通过后才接管系统路由。首次真实 TUN 测试应准备手机热点或其他备用联网方式。** 任一停止条件触发时，停止后续 TUN 操作。

## A. 安装、版本与 UI

- [ ] 从官方 Release 安装 `SSTap.Next-0.3.16-x64.exe`，启动后版本显示 0.3.16。
- [ ] 可选校验：下载 EXE 与 `docs/RELEASE-0.3.16.md` 中的 EXE SHA-256 一致；确认 Release 中 EXE、blockmap、SHA-256 sidecar 均存在。
- [ ] 启动、退出、再次启动正常；节点/订阅/设置页可访问，旧用户数据可正常读取。
- [ ] 检查所有页面常规文字、说明、表头与 HTML small 不低于 14px；左下角版本号弱化显示、常规字重、14px。
- [ ] 节点列表横向滚动、排序、窄窗口/缩放时布局正常；表头排序不改变活动节点、选中和批测勾选状态。

## B. 本地代理、订阅与单节点测速

- [ ] 导入单节点与订阅；刷新成功时更新节点，订阅失败时保留旧列表。
- [ ] 选择已知可用节点，连接本地代理；首页显示 loopback SOCKS5 / HTTP 地址，手动配置浏览器后可访问预期网站。
- [ ] 单节点代理延迟/下载测速经所选节点执行；测试源失败时能按设计回退，结果能显示实际使用的源/失败原因。
- [ ] 断开本地代理后，未配置代理的浏览器仍能直连；应用不得自行更改 Windows 系统代理/PAC。

## C. 批量节点检测与测速隔离

- [ ] 测试全部节点与勾选节点两种范围，PING、TCPING、真实代理延迟、下载 Mbps 和最近检测时间逐节点回填；超时/N/A 与有效结果区分。
- [ ] 逐一测试并发档位 1、2、4、8、16、32；观察进度与取消功能。
- [ ] 批测期间确认当前活动节点没有被切换或断开，Windows 系统代理/PAC 不变，已建立的浏览器连接不中断。
- [ ] 取消后确认本批创建的 sing-box 进程、临时配置和监听端口清理干净；不误杀主代理核心或 TUN Agent。
- [ ] TUN active/transitioning/cleanup_error 时，批测必须被拒绝；不得通过批测绕过 TUN 安全锁。

## D. SSTap 规则库与分流优先级

- [ ] 打开分流模式，执行规则库首次下载/安装；核对上游 revision/SHA、规则数、CIDR 数和更新时间。
- [ ] 搜索至少一条第三字段为 0 的 Proxy 规则，以及第三字段为 1 的 Direct 规则；不能依据文件名推断动作。
- [ ] 在真实分流中核对顺序：private/LAN direct → 用户选择的 SSTap 游戏规则 → bypass-cn 模式的自动 `BypassCNandLan.rules` → MetaCubeX GeoSite/GeoIP fallback。
- [ ] 特别验证游戏 Proxy CIDR 与广泛 CN Direct CIDR 重叠时，显式游戏 Proxy 规则优先。
- [ ] 模拟断网、无效 ZIP 或损坏规则文件；失败后 last-known-good 版本、current pointer 和用户选择必须保持可用，不能半更新或删除旧版本。
- [ ] 在 TUN active/启动/停止/recovery/cleanup_error 时，规则更新、规则勾选、分流策略和 DNS 修改均被锁定；规则更新期间直接触发 TUN 启动也应被主进程拒绝。

## E. DNS 与内核管理

- [ ] 默认 IPv4-only 策略保持有效；TUN 未启动时，IPv4-only、双栈 IPv4 优先、双栈 IPv6 优先可按设置保存。
- [ ] TUN active/transitioning 时 DNS 策略选择器禁用；主进程也拒绝绕过 UI 的不安全修改。
- [ ] 设置页显示实际 sing-box 版本和路径；打开内核目录能定位实际目录。本次不要求升级 sing-box 核心。
- [ ] 如测试 IPv6，分别检查 IPv6 出口、DNS、浏览器访问和断开后的物理网络状态，不能只凭路由器获取 IPv6 推断代理支持。

## F. Wintun 无路由 smoke test

- [ ] 普通代理及应用基础功能已通过；准备备用联网方式。
- [ ] 按仓库当前脚本执行 `scripts/Run-Tun-SmokeTest.ps1`；该测试必须明确不接管默认路由与 DNS。
- [ ] UAC 后 Agent 能启动，临时测试接口创建并成功移除，脚本输出 PASS。
- [ ] 测试前后 IPv4/IPv6 默认路由、物理网卡路由和 DNS 快照一致；重复执行两次均通过。

若 smoke test 有 FAIL、接口未释放或路由/DNS 改变：**停止，不要启动真实 TUN。**

## G. v0.3.16 系统 TUN 与 Agent 白名单修复

- [ ] 点击“启动系统接管”，UAC 后 Agent/sing-box/TUN 进入 running/Up，不再报 `InvalidDataException: TUN 配置包含不允许的 endpoint 或外部控制接口。`。
- [ ] 分别测试 Global、bypass-cn、rule 模式；验证预期网站、实际公网出口、DNS 解析和浏览器业务。
- [ ] 若实际节点与网络条件支持，独立检查 UDP/QUIC 和 IPv6；HTTP curl 单个端点成功不等于完整业务已通过。
- [ ] TUN 会话中采集器故障不能使 Agent 放松配置校验，也不能绕过 fail-closed 清理；不允许外部/LAN/wildcard 控制接口。
- [ ] 流量规则更新、DNS/分流修改与 TUN lifecycle 的锁定边界与主进程保护正常。

## H. 实时流量、累计与持久化

- [ ] 本地代理真实下载和上传时，首页实时下载速度、上传速度分别变化；本次下载累计与本次上传累计分开增长。
- [ ] 本地代理断开时最后一次统计被 flush，停止刷新并保留最终结果；下一次成功连接创建新会话，累计归零。
- [ ] 按节点独立累计代理上传/下载/总量；换节点、关闭应用再启动后数据仍准确，删除节点后不保留孤儿统计。
- [ ] TUN 下实时上/下行和本次累计正常，界面明确说明含 Direct 流量；TUN 总量不得错误记入当前节点的个人代理累计。
- [ ] 模拟短时统计 API 无法读取时，界面显示不可用状态而非伪 0；恢复后累计不倒退、不出现负速率。
- [ ] 断开时 endpoint/secret 相关临时运行文件与端口清理正常；secret 不进入 IPC、普通日志或加密用户状态。

## I. 重连、资源释放与负向保护

- [ ] 首次 TUN 成功后正常断开，确认 sing-box 退出、Agent 状态结束、物理默认路由和 DNS 恢复。
- [ ] 至少重复 10 轮 `connect → disconnect → reconnect`，记录每一轮结果，无残留活动进程/意外路由/DNS 改变。
- [ ] Down 且无 `172.19.0.1` 地址的持久化 Wintun 对象不能仅因对象仍存在就误报活动残留；程序不得擅自删除网卡。
- [ ] 若接口仍为 Up 或仍持有 `172.19.0.1`，必须保持 `cleanup_error` 并阻止再次接管；确认 fail-closed 保护生效。
- [ ] 记录实测日期、应用版本、分流模式、结果/错误信息与脱敏日志；不记录节点 URI、密码、订阅地址或 bearer secret。

## J. 立即停止条件

以下任何一项发生，停止 TUN 测试，不要继续点击连接，也不要手动删除不明网卡或重置 Windows 网络：

- 状态为 `cleanup_error`，或 Agent 启动失败后仍有 sing-box 进程/虚拟网卡。
- SSTap/Wintun 网卡的状态或资源归属不明确。
- 物理网卡 DNS、默认路由与测试前快照不一致。
- IPv4/IPv6 流量出现非预期物理网卡直连。
- UAC 取消/Agent 启动失败后系统网络状态无法确定。

分享日志前脱敏节点服务器地址；不得公开节点 URI、密码、订阅 URL、API secret 或 `state.enc.json`。
