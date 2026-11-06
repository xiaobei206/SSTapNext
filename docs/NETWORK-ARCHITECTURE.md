# 网络架构与流量路径（0.3.7）

## 本地代理模式

```text
本机应用（手动配置代理）
  └─ 127.0.0.1:<动态 mixed 端口>
       └─ sing-box mixed inbound
            └─ selected-proxy（当前节点）
```

mixed inbound 只监听 loopback，不自动修改 Windows 系统代理、路由或 DNS。节点测速同样通过本地 SOCKS5 端口。

## TUN 系统模式

```text
Windows TCP / UDP / DNS / IPv4 / IPv6
  └─ sing-box TUN inbound（SSTap Next，双栈）
       ├─ DNS hijack → address-family strategy → DNS route rules
       │    ├─ dns-bootstrap：解析节点服务器域名，避免启动递归
       │    ├─ dns-remote：普通 DoH 经 selected-proxy
       │    └─ bypass-cn geosite：大陆 DNS 走直连
       └─ route rules
            ├─ global：selected-proxy
            ├─ bypass-cn：geosite-cn / geoip-cn → direct，其余 selected-proxy
            └─ rule：自定义规则优先，未匹配 selected-proxy
```

TUN 接口始终保留 IPv4 与 IPv6 地址，并使用 `auto_route=true`、`strict_route=true` 接管双栈流量；DNS 策略决定域名解析的地址族偏好，不会因为选择 IPv4-only 而关闭 IPv6 路由或放任 IPv6 绕过隧道。

## DNS 地址族设置

| `settings.dnsStrategy` | sing-box DNS strategy | 用途 |
|---|---|---|
| `ipv4_only` | `ipv4_only` | 默认。适合所选代理出口没有可用 IPv6 的环境 |
| `prefer_ipv4` | `prefer_ipv4` | 允许 A/AAAA，IPv4 优先 |
| `prefer_ipv6` | `prefer_ipv6` | 允许 A/AAAA，IPv6 优先 |

双栈需要本地接入网络和所选节点代理出口都支持 IPv6。只有路由器 WAN 获得 IPv6 地址，或电脑网卡有 IPv6 链路本地地址，不能证明节点出口可访问公网 IPv6。修改 DNS 策略前必须断开 TUN；新策略在下一次会话启动时生成。

每种策略使用不同的缓存数据库：`sing-box-cache-ipv4.db`、`sing-box-cache-dual-ipv4.db`、`sing-box-cache-dual-ipv6.db`。避免从 IPv4-only 切换到双栈时复用旧 AAAA/A 缓存。Agent 对这些名称使用精确白名单，并限制在当前用户 AppData/cache 目录中。

## DNS 依赖方向

节点服务器域名使用数值 IP 的直连引导 DNS，避免节点地址解析依赖节点自身；普通 DNS 使用数值地址的 Cloudflare DoH，并经 selected-proxy 出站，减少明文 DNS 直连。bypass-cn 模式下大陆域名可走直连 DNS，但地址族策略仍由设置项控制。

## 管理员 Agent 安全边界

- Agent 由 UAC 单独启动；桌面 UI 不常驻管理员权限。
- 会话必须位于当前用户 AppData 的 `runtime/tun-<32 hex>` 中；会话文件和目录拒绝重解析点。
- Agent 校验 session ID、配置 SHA-256、固定核心路径、固定接口名、运行模式、单一 TUN 入站、受限 outbound、DNS bootstrap / remote detour、日志与缓存位置。
- 只允许 selected-proxy、direct、block 三种 outbound；不允许外部 endpoints 或 Clash API。
- 心跳每 3 秒刷新；Agent 超时未收到心跳会停止 sing-box；正常断开通过 session ID 匹配的 stop signal。
- 断开时等待 sing-box 退出并确认本次 TUN 资源移除；不确定时保留 `cleanup_error`，阻止不安全的再次接管。

## sing-box 核心升级

软件不自动升级核心。安装版设置页的“打开内核目录”定位实际路径；替换时必须先停掉 TUN、退出进程、备份当前 EXE 与 DLL，再从官方 GitHub Release 下载 Windows amd64 稳定版本并校验 SHA-256。源码构建会使用 `runtime/sing-box` 已有核心做 54 份配置检查。详见 `CORE-UPGRADE.md`。

## 未承诺/未验证

当前源码 Node 测试与 UI/配置生成检查不能代替 Windows Agent 编译、Windows sing-box 实际 `check`、Wintun 驱动动态行为、系统路由/DNS 恢复和公网出口验证。必须按 `WINDOWS-ACCEPTANCE.md` 在 Windows 10/11 实机验收。
