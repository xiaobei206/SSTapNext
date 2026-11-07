# SSTap Next 0.3.15 — Release 记录

状态：**main 已实现，自动化/Windows 构建待验收；未发布。**

- 最新公开版本：v0.3.14。
- main package / lock / .NET Agent 目标版本：0.3.15。
- 设计：LIVE-TRAFFIC-AND-UI-READABILITY.md。
- 本次功能：实时上传/下载速度、本次上下行累计、节点代理流量历史累计、排序表头、UI 字号与版本标签改进。
- 安全归属：TUN 会话总量注明含直连，仅显示在连接中心；节点历史累计只记录可准确归属的本地代理会话。
- Clash API：随机 loopback 端口与随机 Bearer secret；临时配置受运行目录/文件权限保护，API 密钥不出现在 IPC、日志或加密状态。

## 当前代码

- 新增 `src/shared/singbox-traffic.cjs` 与 `src/shared/singbox-traffic.test.mjs`。
- 两类会话控制器接入采样器；主进程加密状态增加 nodeTrafficStats，10 秒批次写入并在 disconnect/exit flush。
- Renderer 首页和节点列表 UI 已完成对应布局与交互。

## 自动化 / 构建证据

- Node CI：NOT VERIFIED。
- `npm test`：NOT RUN locally。
- `npm run verify:lock`：NOT RUN locally。
- sing-box 1.14.4 配置：目标 58/58，NOT VERIFIED。
- Windows .NET Agent / TypeScript / Vite / NSIS / installer / blockmap / SHA：NOT VERIFIED。
- Release assets：NOT CREATED / NOT VERIFIED。

## Windows 实机验收

- Local proxy 上/下行实时变化和分开累计：NOT RUN。
- 节点累计跨重连、跨软件重启及换节点隔离：NOT RUN。
- TUN 含直连总流量与不归入节点个人累计：NOT RUN。
- API 故障提示、断开清理和运行时端口：NOT RUN。
- 全页面字体、侧栏版本号、节点列表横向滚动与缩放：NOT RUN。

自动化成功只表明构建和代码测试通过，不能替代实际 Windows 网络与 TUN 验收。只有 GitHub Actions 成功并确认 EXE、blockmap、SHA sidecar 三项 Release 资产真实存在后，才可将状态改为“已发布”。
