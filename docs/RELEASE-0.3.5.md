# SSTap Next 0.3.5 — TUN IPv4-only DNS 回退

## 用户实测证据

0.3.4 在全局 TUN 下取得以下结果：

| 命令/场景 | 结果 | 可确认的事实 |
|---|---|---|
| `curl -4 https://www.youtube.com/generate_204` | HTTP 204，TLS 成功 | YouTube IPv4 HTTPS 经过 TUN 可达 |
| `curl -4 https://youtubei.googleapis.com/` | HTTP 405，TLS 成功 | TCP/TLS/HTTP 到达 API 主机；根路径 GET 不代表 API 业务测试 |
| `curl -6 https://www.youtube.com/generate_204` | Schannel TLS 握手失败 | YouTube IPv6 HTTPS 不可用 |
| `curl -6 https://youtubei.googleapis.com/` | Schannel TLS 握手失败 | YouTube API IPv6 HTTPS 不可用 |
| Chrome ZeroOmega Direct + TUN | 页面出现“你没有连接到互联网” | IPv4 curl 成功不代表浏览器全部请求成功 |

已知节点出口 IPv4 地址为用户确认的代理出口 `147.78.245.169`。因此没有必要重新改节点凭据、VLESS 协议或 IPv4 出站。当前最强证据指向该节点/路径的 IPv6 目标连接不可用，而浏览器仍可能使用 AAAA 结果。

## 修改内容

1. `src/shared/tun-config.cjs` 将生产 TUN DNS 的全局策略从 `prefer_ipv4` 改为 `ipv4_only`。官方 sing-box DNS 配置支持 `prefer_ipv4`、`prefer_ipv6`、`ipv4_only`、`ipv6_only`；`prefer_ipv4` 只是偏好，不能表达严格禁用 IPv6 DNS 结果的意图。
2. TUN 入站仍保留 `172.19.0.1/30` 与 `fdfe:dcba:9876::1/126`，`auto_route=true`、`strict_route=true`、DNS hijack 均不变。这样 IPv6 流量仍留在 TUN 管控范围，不会因删除 IPv6 路由而直接从物理网卡泄漏。
3. `src/shared/tun-controller.cjs` 将持久化缓存文件改为 `sing-box-cache-ipv4.db`；`TunRuntime.cs` 的严格缓存路径白名单同步更新为同一名称。原 `sing-box-cache.db` 不删除、不覆盖；首次运行使用新的空 DNS 缓存，避免旧 AAAA 记录干扰 IPv4-only 策略验证。
4. 新增/更新 Node 回归测试，验证 global、bypass-cn、custom-rules 三种模式全部使用 `ipv4_only`，TUN 地址仍双栈，旧缓存文件被保留，且 Agent 只允许新的缓存路径。
5. 保留 0.3.4 的 npm 锁文件预检、0.3.3 C# 变量名修复、0.3.2 CTRL+BREAK 停止与遗留会话迁移逻辑。

## 影响与限制

- 域名解析将只给应用提供 IPv4 结果；IPv6-only 网站/服务可能无法访问。这是针对当前所选节点 IPv6 不通的兼容策略，不等于全互联网 IPv6 功能已修好。
- TUN 仍是双栈路由接管。不要手动删除虚拟网卡 IPv6 地址或 Windows IPv6 路由。
- 若 Chrome 开启了独立 Secure DNS/DoH，浏览器可能绕过系统 DNS 劫持并自行取得 AAAA 结果；若安装 0.3.5 后问题仍在，下一步需要核对 Chrome Secure DNS 是否使用自定义提供商，而不是再改 VLESS 出站。
- 完全退出并重开 Chrome，避免沿用旧进程内 DNS 缓存。首次验证时 ZeroOmega 使用 Direct，不要使用本地 3026 代理。

## 当前环境验证

- Node 自动化测试：59/59（包含三种 TUN 模式 DNS 策略、双栈地址、缓存文件路径/旧缓存保留及 Agent 白名单一致性测试）。
- 锁文件检查：沿用 0.3.4 已核验的依赖图，只更新根版本字段；704 个依赖引用由预检器检查。
- Node 文件语法检查：执行本轮全量检查。
- PowerShell 脚本：保持 UTF-8 BOM。
- 未在当前容器执行：Windows .NET 10 Agent 编译、sing-box 1.14.4 的 18 份真实 `check`、NSIS 打包、Wintun 动态行为。Windows 构建脚本中的 `[3/8] validate:core` 会用你已下载的 sing-box 1.14.4 验证最终配置。

## 构建与验收

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

构建通过并安装后，完全退出 Chrome（确保后台进程结束），重新打开浏览器，ZeroOmega 选 Direct，在全局 TUN 下打开 YouTube。无需再验证强制 IPv6 curl；在 `ipv4_only` DNS 策略下强制 `curl -6` 无 AAAA 是预期行为。

若网页仍出现“你没有连接到互联网”，下一步只需看 Chrome Secure DNS 设置（是否指定自定义 DoH 提供商），不需要重新发送长日志。
