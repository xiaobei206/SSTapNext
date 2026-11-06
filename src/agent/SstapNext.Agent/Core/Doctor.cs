using System.Diagnostics;
using System.Security.Principal;

namespace SstapNext.Agent.Core;

internal static class Doctor
{
    public static async Task<int> RunAsync()
    {
        Console.WriteLine("SSTap Next 环境检查");
        Console.WriteLine("-------------------");
        Console.WriteLine($"系统：{Environment.OSVersion}");
        Console.WriteLine($"进程架构：{System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");
        Console.WriteLine($"管理员权限：{(IsAdministrator() ? "是" : "否")}");

        var executable = CoreLocator.FindSingBox();
        if (executable is null)
        {
            Console.WriteLine("[FAIL] 未找到 sing-box.exe。");
            Console.WriteLine("请运行 scripts\\Fetch-SingBox.ps1，或设置 SSTAP_SING_BOX 环境变量。");
            return 2;
        }

        Console.WriteLine($"sing-box：{executable}");
        var version = await ProcessRunner.RunCaptureAsync(executable, ["version"], TimeSpan.FromSeconds(10));
        Console.WriteLine(version.Output.Trim());
        if (version.ExitCode != 0)
        {
            Console.WriteLine($"[FAIL] sing-box version 返回 {version.ExitCode}：{version.Error}");
            return 3;
        }

        Console.WriteLine("[OK] sing-box 可执行。");
        if (!IsAdministrator())
            Console.WriteLine("[NOTE] 运行 --tun-smoke-test 时需要在管理员终端中执行。");
        return 0;
    }

    internal static bool IsAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        return principal.IsInRole(WindowsBuiltInRole.Administrator);
    }
}
