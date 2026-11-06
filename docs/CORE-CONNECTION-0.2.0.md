> 历史说明：本文描述 0.2.0 本地代理实现；当前版本另有 Windows TUN / Agent 代码，验收以 README.md 与 WINDOWS-ACCEPTANCE.md 为准。

# 本地代理连接实现说明（0.2.0）

## 状态机

`disconnected → starting → connected → stopping → disconnected`；子进程意外退出时进入 `error`。同一节点重复连接返回当前会话；不同节点连接必须先断开。

## 配置流程

1. 定位固定版本的 sing-box.exe。
2. 执行 `sing-box version` 以确认核心可执行。
3. 为当前会话选择 loopback 随机端口。
4. 用共享解析器的 `buildSingBoxOutbound()` 生成 selected-proxy 出站。
5. 创建仅绑定 `127.0.0.1` 的 mixed inbound 配置。
6. 将临时配置写入 userData/runtime。
7. 执行 `sing-box check -c`；失败即删除配置并退出。
8. 启动 `sing-box run -c`，等待 loopback 端口真正监听后标记 connected。
9. 断开时先 SIGTERM，超时再尝试 SIGKILL；清除临时配置并向 UI 同步状态。

## 代理端口

首页展示运行时端口。sing-box mixed inbound 同时接受 SOCKS4/4a/5 与 HTTP 代理。连接默认不设置系统代理，使用者需要在支持手动代理的应用内填写 `127.0.0.1:<port>`。

## 测速流程

1. 连接目标节点，或复用已连接的同一节点。
2. 发起一个经 SOCKS5 通道的 HTTP Range 请求，记录首个 HTTP 响应延迟。
3. 按 1 / 2 / 4 / 8 个 worker 读取固定总字节数。Cloudflare `/__down` 采用每个 worker 的 `bytes` 参数；普通文件使用 HTTP Range 并校验 Content-Range。
4. 数据只流过内存，不写入磁盘。
5. 计算下载期间平均 Mbps 和 400 ms 采样峰值 Mbps。
6. 保存最近 50 条历史；用户取消时中止活动请求。

如果服务器不支持 Range，多线程测速会报错而不是重复下载同一段伪造速度；单线程允许从 200 响应读取文件开头的指定字节数。

## 未涵盖

真实服务端协议握手需要真实节点验证。模拟 SOCKS5 中继仅验证测速客户端确实通过 SOCKS5 连接目标，不验证 sing-box 或远端代理本身。Windows TUN 系统接管尚未实现。
