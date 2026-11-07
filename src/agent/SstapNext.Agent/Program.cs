using System.Net;
using System.Net.NetworkInformation;
using System.Security.Principal;
using System.Text;
using System.Text.Json;
using SstapNext.Agent.Core;

Console.OutputEncoding = Encoding.UTF8;
Console.InputEncoding = Encoding.UTF8;

try
{
    if (!OperatingSystem.IsWindows())
    {
        Console.Error.WriteLine("SSTap Next Agent 仅支持 Windows 10/11。");
        return 2;
    }

    var command = args.FirstOrDefault()?.Trim().ToLowerInvariant();
    if (command is "--tun-smoke-test" or "--tun-run" or "--tun-diagnostic" or "--tun-diagnostic-full")
    {
        RedirectConsoleToLog();
    }
    return command switch
    {
        "--doctor" => await Doctor.RunAsync(),
        "--tun-smoke-test" => await TunSmokeTest.RunAsync(),
        "--tun-diagnostic" => await TunSmokeTest.RunDiagnosticAsync(),
        "--tun-diagnostic-full" => await TunSmokeTest.RunFullDiagnosticAsync(),
        "--tun-inspect-adapter" => TunRuntime.InspectAdapter(args.Skip(1).ToArray()),
        "--tun-run" => await TunRuntime.RunAsync(args.Skip(1).ToArray()),
        "--print-tun-test-config" => TunSmokeTest.PrintConfig(),
        _ => PrintUsage()
    };
}
catch (Exception ex)
{
    Console.Error.WriteLine($"[FATAL] {ex.GetType().Name}: {ex.Message}");
    return 1;
}

static void RedirectConsoleToLog()
{
    // Elevated TUN runs have no visible console; mirror stdout/stderr to a file
    // so unhandled failures can be diagnosed after the fact.
    try
    {
        var logDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SSTapNext", "Logs");
        Directory.CreateDirectory(logDir);
        var logPath = Path.Combine(logDir, $"agent-{DateTime.Now:yyyyMMdd-HHmmssfff}.log");
        var writer = new StreamWriter(logPath, append: false, Encoding.UTF8) { AutoFlush = true };
        var sync = TextWriter.Synchronized(writer);
        Console.SetOut(sync);
        Console.SetError(sync);
    }
    catch
    {
        // Logging setup must never prevent the agent from running.
    }
}

static int PrintUsage()
{
    Console.WriteLine("SSTap Next Agent 0.3.10");
    Console.WriteLine();
    Console.WriteLine("用法：");
    Console.WriteLine("  SstapNext.Agent.exe --doctor               检查运行环境与 sing-box");
    Console.WriteLine("  SstapNext.Agent.exe --print-tun-test-config 输出无默认路由的网卡自检配置");
    Console.WriteLine("  SstapNext.Agent.exe --tun-smoke-test        创建并验证 Wintun 适配器（需要管理员权限）");
    Console.WriteLine("  SstapNext.Agent.exe --tun-diagnostic        双栈 TUN 诊断（auto_route=false，不改路由/DNS）");
    Console.WriteLine("  SstapNext.Agent.exe --tun-diagnostic-full   完整 TUN 诊断（auto_route=true，短暂接管后恢复）");
    Console.WriteLine("  SstapNext.Agent.exe --tun-inspect-adapter --id <GUID> 只读检查指定网络适配器状态");
    Console.WriteLine("  SstapNext.Agent.exe --tun-run --session <目录> 运行受桌面端心跳监控的系统 TUN 会话（管理员）");
    Console.WriteLine();
    Console.WriteLine("注意：--tun-smoke-test 不接管路由；--tun-run 会启用系统路由与 DNS 接管。");
    return 0;
}
