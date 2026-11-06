# GitHub 公共仓库与 Release 发布流程

推荐仓库：`xiaobei206/SSTapNext`（Public）。当前 GitHub API 返回 404，确认该仓库尚不存在或不可见；本轮不会向无关仓库提交。

## 首次建立仓库

GitHub 连接当前可查询和写入已存在仓库的文件/Tree/Commit，但没有创建新仓库的 API 权限入口。因此需要仓库所有者先在 GitHub 创建一个空的 Public repository：

- Repository name：`SSTapNext`
- Visibility：Public
- 不要预先勾选 README、.gitignore 或 License（避免首次导入产生无关 merge）
- 默认分支：`main`

创建后，把仓库地址提供给维护者，以便将本项目源码树初始化提交到该仓库。不要将项目放入其他用途仓库。

## 日常开发与版本

- 主开发分支：`main`
- 正式版本使用 SemVer，例如 `0.3.7`
- 每个正式发布 tag 使用 `v` 前缀，例如 `v0.3.7`
- tag 指向对应版本已审查的源码提交；package.json、package-lock、Agent、UI 和构建脚本版本必须一致
- 不把 `node_modules`、`dist`、`release`、用户配置、节点 URI、订阅 URL、`state.enc.json` 或运行会话目录提交到 Git

## 发布安装包

1. 先将经过测试的版本提交到 `main`。
2. 在 GitHub Releases 页面选择 Draft a new release。
3. 创建匹配版本的 tag，例如 `v0.3.7`，target 选择 `main` 中对应提交。
4. 发布 Release。
5. `.github/workflows/release-windows.yml` 自动在 `windows-2022` runner 上：安装 Node 22 与 .NET 10、校验 tag 和 package.json 版本、执行 `scripts/Build-Windows.ps1`、运行 Node 测试和 54 份 sing-box 配置检查、编译 Agent、构建 UI、生成 NSIS 安装包，然后将安装 EXE、blockmap 与 SHA-256 文件上传到该 Release。
6. 到 Actions 确认 `Build and publish Windows installer` 成功，再从 Release 下载安装程序。

GitHub 自动为 tag 提供源码 ZIP/TAR。安装包以 Actions 构建结果为准，不将未经 Windows 构建的本地源码包称为安装程序。

## 失败处理

- Windows 构建失败时 workflow 会失败，不会上传不完整安装包。
- 检查 Actions 中第一个失败步骤，修复后必须递增修订版本或按改动范围递增版本，不要覆盖已有正式 tag。
- 不允许跳过测试、sing-box check、Agent 编译或 NSIS 打包来制造绿色 Release。
