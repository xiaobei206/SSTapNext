# SSTap Next 0.3.14 — Windows ICMP PING 解析修复

状态：**已正式发布（2026-11-07）**。上一正式版本：v0.3.13。Release：https://github.com/xiaobei206/SSTapNext/releases/tag/v0.3.14

## 用户复现

0.3.13 批量节点检测中，36 个节点的 PING 全部显示超时。用户在同一 Windows PowerShell 执行：

```powershell
ping -n 3 -w 1000 65.49.237.84
```

获得 3/3 成功回复：45ms、43ms、43ms，0% 丢包，平均 43ms。客户端显示超时属于解析缺陷。

## 修复内容

- RTT 正则不再要求完整 `time` / `时间` 前缀，只匹配 `=` 或 `<` 后的毫秒数和 `ms`。
- 兼容 OEM 代码页中文前缀被 UTF-8 解码成乱码的情况。
- 保留现有丢包统计、DNS 失败、真正 ICMP timeout 和取消后的 ping 子进程关闭等待。
- 不改变 TCPING、真实代理延迟、下载测速、sing-box 批测架构、系统代理和 TUN 安全边界。

## 影响文件

- `src/shared/batch-node-test.cjs`
- `src/shared/batch-node-test.test.mjs`
- 本版本号涉及的 package/package-lock、Agent、构建脚本和发行文档。

## 验证标准

- [x] parser：英文、完整中文、乱码中文前缀、`<1ms`、丢包、全超时、DNS 错误（Node CI 98/98）。
- [x] ping.exe 子进程参数及取消后等待 close（Node CI）。
- [x] `npm test`：98/98 PASS。
- [x] `npm run verify:lock`：704/704 PASS。
- [x] sing-box 56/56 配置检查通过。
- [x] Windows .NET Agent、TypeScript/Vite、NSIS、安装包 SHA 校验通过。
- [ ] GitHub Actions 对应 0.3.14 代码 commit 成功。
- [ ] 用户实机：65.49.237.84 列表 PING 显示约 43ms，与系统 ping 结果吻合（待安装后复测）。

## 风险与回滚

改动只作用于 ICMP 输出文本解析，不改变外部网络操作。若出现回归，使用 GitHub Revert 回滚对应代码提交，再按版本纪律递增修复；不覆盖 v0.3.13 资产，不重写历史。

## 发布记录

待 0.3.14 构建及 Release 实际完成后填写 commit SHA、Actions、安装包文件名与 SHA-256、blockmap 和 sidecar 资产核验结果。未完成前不得标记为已发布。


## 实际发布资产与验证证据

- Release target commit：`fab186b48b0597b76afc1a79dc6e7c1dd59dbe6b`；latest main parser/test commit：`d0fbcd52c87aa94c60aeb054789e5fc786e71868`。
- EXE：`SSTap.Next-0.3.14-x64.exe`，174892333 bytes，SHA-256 `61dc8bed3e08307e2b4d32105c0f5d539207ea10935d0bb552c0eb56b1abb007`。
- Blockmap：182937 bytes，SHA-256 `91a246dd4120f4c33ce74e1bb4fb81f7205cfc6044d05bd904732a231447cb3d`。
- SHA sidecar：93 bytes，asset digest `463ce07f29966011507040624528a94c6a9ec56abd08a70afb1570c1bc9b1245`。
- Node CI 42353385323：98/98 tests，704/704 lock refs。Windows Release 42353296447：56/56 sing-box checks，完整构建与 Release 上传成功。
- Workflow artifact ID：13566382935，175085295 bytes。
- 用户 Windows 实机 PING 回归仍待验收。
