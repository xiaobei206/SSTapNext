# SSTap Next 0.3.3 — Agent 编译修正版

## 本轮问题

用户在 Windows 11 / .NET 10 SDK 构建 0.3.2 时，Agent 编译在 `TunRuntime.cs(140,21)` 报错：

```text
CS0136: 无法在此范围中声明名为“remainingAdapter”的局部变量或参数，因为该名称在封闭局部范围中用于定义局部变量或参数
```

## 根因

`RunAsync()` 的正常停止路径中，`if (!removed)` 子作用域声明了 `remainingAdapter`（用于记录清理失败时的接口详情）；在其后同一个外层 `try` 作用域，成功清理分支又声明同名 `remainingAdapter`。C# 不允许在外层作用域后续声明与嵌套作用域内同名的局部变量，因此触发 CS0136。

## 修复

仅将成功清理分支变量重命名为 `retainedAdapter`，并同步更改该分支的 null 判断与 Name 输出。清理失败分支保留 `remainingAdapter`。没有改变控制流程、网卡判定、等待时间、停止信号或状态机行为。

新增 `agent-stop-contract.test.mjs` 回归测试，断言两个代码路径使用不同局部变量名。

## 验证范围

- Node 自动化测试：54/54 PASS（包含新增 CS0136 回归断言）。
- `.js/.cjs/.mjs` 语法检查：全部 PASS。
- C# / .NET 10 Windows Agent 编译：当前开发容器没有 .NET SDK，未执行；必须由用户 Windows 机器上的 `Build-Windows.ps1` 完成验证。
- sing-box 18 组配置检查、TypeScript/Vite 和 NSIS：本轮未在当前容器执行。
- 真实 CTRL+BREAK、Wintun 创建/释放、节点握手和全局代理流量：未在当前容器执行。

## Windows 构建

在 Windows 11 的项目根目录运行：

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\Build-Windows.ps1
```

预期安装包：`release\SSTap Next-0.3.3-x64.exe`。若 Agent 编译再次失败，请提供从 `[4/8] 编译 Windows Agent...` 开始至错误结束的完整输出；不要启动系统 TUN。
