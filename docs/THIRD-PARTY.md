# 第三方组件与许可证初始清单

| 组件 | 用途 | 许可证/注意事项 |
|---|---|---|
| Electron | Windows 桌面壳 | MIT；正式发布需携带许可证文本 |
| React / React DOM | 界面 | MIT |
| Vite / TypeScript | 前端构建 | MIT |
| sing-box | 代理协议 / TUN / 路由内核 | GPL-3.0-or-later；发布整合版本前须完成许可证和源代码义务审查 |
| sing-tun / Wintun bindings | sing-box Windows TUN 实现 | 以具体锁定版本的 LICENSE / NOTICE 为准 |
| Wintun | Windows L3 TUN 驱动 | WireGuard 官方项目；以对应发行包许可证为准 |

本文件是初始清单，不代替正式发布时对每个二进制、依赖锁文件和许可证的逐项审计。


## 正式发布前必须完成

- 对 sing-box 二进制对应版本的 GPL-3.0-or-later 义务进行正式审核；若分发集成安装包，须确认提供对应完整源代码/书面要约等义务如何落实。
- electron-builder 生成的安装程序当前未配置代码签名；公开分发前应配置可信代码签名证书并审查 SmartScreen 呈现。
- 使用实际 npm lockfile 和最终安装包重新生成 SBOM / license inventory；不要仅依赖本初始清单。
- 检查 sing-box、Electron、Wintun 及其间接依赖在目标发行版本中的许可证与 NOTICE。
