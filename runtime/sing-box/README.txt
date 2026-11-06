该目录用于放置官方 sing-box Windows x64 运行文件。

默认全新构建基线为 v1.14.4，下载脚本 `scripts\Fetch-SingBox.ps1` 会从 SagerNet/sing-box 官方 GitHub Release 下载，并校验项目锁定的 SHA-256。

SSTap Next 0.3.7 支持用户手动替换核心：
- 已安装版本请从软件设置点击“打开内核目录”。
- 源码构建请把官方 Windows amd64 压缩包中的 sing-box.exe 和配套 DLL 放进本目录。
- Build-Windows.ps1 发现 sing-box.exe 已存在时不会覆盖；后续会用当前核心执行 54 份配置检查。
- 默认 Fetch-SingBox.ps1 仍锁定 v1.14.4；手动使用其他稳定版本不会更改默认下载锁。

完整替换、SHA-256 核验和回滚步骤见 docs\CORE-UPGRADE.md。不要使用 nightly/alpha 或第三方网盘核心。
