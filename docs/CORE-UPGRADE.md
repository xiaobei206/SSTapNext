# sing-box 内核手动升级说明（SSTap Next 0.3.7）

SSTap Next 不会在后台自动升级 sing-box。用户可以在确认新版本兼容后手动替换，软件启动时读取实际 `sing-box.exe version`，并在源码构建时使用目录内当前核心进行 54 份配置检查。

## 已安装软件中替换

1. 在 SSTap Next 的“软件设置”页面查看当前核心版本，点击“打开内核目录”。这比手动猜测安装目录可靠。
2. 先断开系统 TUN 和本地代理，并完全退出 SSTap Next，确认任务管理器中没有该应用启动的 `sing-box.exe`。
3. 只从官方发布页下载 Windows amd64 正式版：<https://github.com/SagerNet/sing-box/releases>。不要使用 nightly/alpha 或第三方网盘版本。
4. 在目录外备份当前 `sing-box.exe` 和全部同目录 DLL。检查 GitHub Release 提供的 SHA-256 digest，并对下载的 ZIP 使用 `Get-FileHash -Algorithm SHA256` 核对。
5. 将同一压缩包内的 `sing-box.exe` 和它的配套 DLL 一起复制到内核目录。不要混用不同版本的 DLL，也不要只覆盖 EXE 后保留来源不明的 DLL。
6. 启动 SSTap Next，进入设置页核对实际显示的版本；再做本地代理连接和配置检查。若核心无法启动或配置检查失败，退出软件并将备份的 EXE/DLL 一起恢复。

常见安装目录会位于 `C:\Program Files\SSTap Next\resources\sing-box`，但应以设置页面“打开内核目录”打开的实际路径为准。用户级安装可能位于其他目录。

## 从源码重新构建时替换

将已校验的官方 Windows amd64 `sing-box.exe` 与同包 DLL 放到项目的 `runtime\sing-box\`。`scripts\Build-Windows.ps1` 检测到该目录已有 `sing-box.exe` 时不会下载默认核心；随后 `[3/8]` 会显示实际核心版本，并使用它执行 6 类协议 × 3 种路由模式 × 3 种 DNS 地址族共 54 份 `sing-box check`。任何配置检查失败都会停止构建，不会继续打包。

如果希望恢复项目默认锁定核心，先把手动核心移出该目录，再运行 `scripts\Fetch-SingBox.ps1`。目前该下载脚本仍锁定经过项目校验的 1.14.4 及其 SHA-256；手动使用更新版本不会改变这个默认下载锁。

## 升级边界

54 份 `sing-box check` 只验证当前配置能被新核心解析，不等于完整验证所有协议行为、路由、Wintun 或代理节点兼容性。跨较大版本升级前应先保留备份，并用实际节点验证本地代理和 TUN。不要在 TUN 接管期间覆盖核心文件。
