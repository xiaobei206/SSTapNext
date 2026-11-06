using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace SstapNext.Agent.Core;

internal static class TunSmokeTest
{
    private const string AdapterName = "SSTap Next Test";
    private const string TestAddress = "172.31.254.1";
    private const string TestNetwork = "172.31.254.0";
    private const int TestPrefixLength = 30;
    private static readonly IPAddress TestIp = IPAddress.Parse(TestAddress);
    private static readonly IPAddress TestNetworkAddress = IPAddress.Parse(TestNetwork);
    // Real TUN IPv4 address (tun-config.cjs DEFAULT_TUN_ADDRESS[0]); used by --tun-diagnostic.
    private static readonly IPAddress DiagnosticIp = IPAddress.Parse("172.19.0.1");
    // Isolation-test address used by --tun-diagnostic-full to avoid leftover-adapter conflicts.
    private static readonly IPAddress FullDiagnosticIp = IPAddress.Parse("172.20.0.1");

    public static int PrintConfig()
    {
        Console.WriteLine(JsonSerializer.Serialize(CreateConfiguration(Path.Combine(Path.GetTempPath(), "sstap-next-smoke.log")), new JsonSerializerOptions { WriteIndented = true }));
        return 0;
    }

    public static async Task<int> RunAsync()
    {
        Console.WriteLine("SSTap Next / Wintun 适配器安全自检");
        Console.WriteLine("====================================");
        Console.WriteLine("本测试仅创建 TUN 适配器，不接管默认路由、不修改现有路由或 DNS。");

        if (!Doctor.IsAdministrator())
        {
            Console.Error.WriteLine("[BLOCKED] 请在“管理员终端”中运行此测试。没有管理员权限时不会尝试创建网卡。");
            return 10;
        }

        var core = CoreLocator.FindSingBox();
        if (core is null)
        {
            Console.Error.WriteLine("[BLOCKED] 未找到 sing-box.exe。请先运行 scripts\\Fetch-SingBox.ps1。");
            return 11;
        }

        var namedExisting = NetworkInterface.GetAllNetworkInterfaces()
            .FirstOrDefault(adapter => StringComparer.OrdinalIgnoreCase.Equals(adapter.Name, AdapterName));
        if (namedExisting is not null)
        {
            Console.Error.WriteLine($"[BLOCKED] 已存在同名测试接口 {namedExisting.Name}，请先确认并手动移除残留接口；本次不会创建第二张网卡。");
            return 12;
        }
        var overlappingAdapter = FindInterfaceWithOverlappingPrefix(TestNetworkAddress, TestPrefixLength);
        if (overlappingAdapter is not null)
        {
            Console.Error.WriteLine($"[BLOCKED] 测试网段 {TestNetwork}/{TestPrefixLength} 与现有接口 {overlappingAdapter.Name} 的地址前缀重叠；为避免局域网流量被测试网卡截获，本次取消。");
            return 12;
        }
        var overlappingRoute = await FindOverlappingRouteAsync();
        if (!string.IsNullOrEmpty(overlappingRoute))
        {
            Console.Error.WriteLine($"[BLOCKED] 测试网段 {TestNetwork}/{TestPrefixLength} 与现有路由 {overlappingRoute} 重叠；为避免改变该网段的路由选择，本次取消。");
            return 12;
        }

        var logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SSTapNext", "Logs");
        Directory.CreateDirectory(logDirectory);
        var runId = Guid.NewGuid().ToString("N");
        var configPath = Path.Combine(Path.GetTempPath(), $"sstap-next-tun-{runId}.json");
        var logPath = Path.Combine(logDirectory, $"tun-smoke-{DateTime.Now:yyyyMMdd-HHmmss}.log");
        var beforeRoutes = await GetDefaultRouteSnapshotAsync();
        var beforeExternalRoutes = await GetExternalRouteSnapshotAsync();
        var beforeDns = await GetDnsSnapshotAsync();
        await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(CreateConfiguration(logPath), JsonOptions), new UTF8Encoding(false));
        NativeConsoleProcess? child = null;

        try
        {
            Console.WriteLine("[1/5] 检查 sing-box 配置…");
            var check = await ProcessRunner.RunCaptureAsync(core, ["check", "-c", configPath], TimeSpan.FromSeconds(20));
            if (check.ExitCode != 0)
            {
                Console.Error.WriteLine("[FAIL] sing-box check 失败：");
                Console.Error.WriteLine(check.Error);
                Console.Error.WriteLine(check.Output);
                return 20;
            }
            Console.WriteLine("[OK] 配置通过 sing-box 校验。");

            Console.WriteLine("[2/5] 启动临时 TUN 入站…");
            child = NativeConsoleProcess.Start(core, ["run", "-c", configPath]);
            var found = await WaitForAdapterAsync(TimeSpan.FromSeconds(20), () => child!.HasExited);
            if (found is null)
            {
                Console.Error.WriteLine("[FAIL] 20 秒内没有发现带有测试 IPv4 地址的 Wintun 接口。");
                Console.Error.WriteLine($"日志：{logPath}");
                Console.Error.WriteLine(await ReadLogTailAsync(logPath));
                Console.Error.WriteLine(DescribeInterfaces());
                await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
                return 21;
            }

            Console.WriteLine($"[OK] 找到适配器：{found.Name} / {found.Description}");
            await WriteAdapterReportAsync(logDirectory, found);
            Console.WriteLine("[3/5] 验证接口名称、地址与状态…");
            if (!StringComparer.OrdinalIgnoreCase.Equals(found.Name, AdapterName)
                || found.OperationalStatus != OperationalStatus.Up
                || !found.GetIPProperties().UnicastAddresses.Any(x => x.Address.Equals(TestIp)))
            {
                Console.Error.WriteLine($"[FAIL] 适配器没有处于 Up 状态，或测试地址未正确配置。实际：Name={found.Name}, Description={found.Description}, OperationalStatus={found.OperationalStatus}。");
                await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
                return 22;
            }
            Console.WriteLine("[OK] 接口已启用，测试地址配置正确。");

            Console.WriteLine("[4/5] 验证默认路由、其他路由和 DNS 未被更改…");
            var duringRoutes = await GetDefaultRouteSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeRoutes, duringRoutes))
            {
                Console.Error.WriteLine("[FAIL] 测试期间检测到 IPv4/IPv6 默认路由快照变化。将停止测试并报告，不会尝试猜测性修改路由。");
                await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
                return 23;
            }
            var duringExternalRoutes = await GetExternalRouteSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeExternalRoutes, duringExternalRoutes))
            {
                Console.Error.WriteLine("[FAIL] 测试期间检测到测试虚拟网卡以外的路由表变化。将停止测试并报告，不会猜测性修改路由。");
                await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
                return 29;
            }
            var duringDns = await GetDnsSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeDns, duringDns))
            {
                Console.Error.WriteLine("[FAIL] 测试期间检测到现有物理网卡 DNS 配置变化。将停止测试并报告。");
                await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
                return 27;
            }
            Console.WriteLine("[OK] 默认路由、非测试网卡路由和现有网卡 DNS 快照与测试前一致。");

            Console.WriteLine("[5/5] 正常停止 sing-box 并验证适配器清理…");
            var stopped = await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
            if (!stopped)
            {
                // A hard kill is acceptable for the no-route smoke test as long as the
                // adapter is actually removed (verified below); routes/DNS are untouched.
                Console.Error.WriteLine("[WARN] sing-box 未能在超时内正常响应退出信号；Agent 已结束进程，继续验证网卡是否移除。");
            }

            var removed = await WaitForAdapterRemovalAsync(TimeSpan.FromSeconds(15));
            if (!removed)
            {
                Console.Error.WriteLine("[FAIL] sing-box 已退出，但测试接口仍然存在。请先不要启用系统路由接管。");
                Console.Error.WriteLine($"残留接口：{FindInterfaceByAddress(TestIp)?.Name ?? "名称未能读取"}");
                return 25;
            }

            var afterRoutes = await GetDefaultRouteSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeRoutes, afterRoutes))
            {
                Console.Error.WriteLine("[FAIL] 测试结束后的默认路由快照与测试前不一致。请先检查系统网络状态，不要继续连接。");
                return 26;
            }
            var afterExternalRoutes = await GetExternalRouteSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeExternalRoutes, afterExternalRoutes))
            {
                Console.Error.WriteLine("[FAIL] 测试结束后的非测试网卡路由快照与测试前不一致。请先检查系统网络状态，不要继续连接。");
                return 30;
            }
            var afterDns = await GetDnsSnapshotAsync();
            if (!StringComparer.Ordinal.Equals(beforeDns, afterDns))
            {
                Console.Error.WriteLine("[FAIL] 测试结束后的物理网卡 DNS 快照与测试前不一致。请先检查系统网络状态。");
                return 28;
            }

            Console.WriteLine("[PASS] 网卡创建、地址配置、退出清理均通过；默认路由、其他路由和现有网卡 DNS 前后保持一致。");
            Console.WriteLine($"日志：{logPath}");
            return 0;
        }
        finally
        {
            if (child is not null)
            {
                try
                {
                    var stopped = await child.StopGracefullyAsync(TimeSpan.FromSeconds(10));
                    if (!stopped)
                        Console.Error.WriteLine("[CLEANUP WARNING] 自检进程未能正常退出；已尝试强制终止。请检查测试网卡是否消失。" );
                    var removed = await WaitForAdapterRemovalAsync(TimeSpan.FromSeconds(10));
                    if (!removed)
                        Console.Error.WriteLine($"[CLEANUP WARNING] 测试适配器仍存在：{FindInterfaceByAddress(TestIp)?.Name ?? "名称未能读取"}。请勿启用系统路由接管。" );
                }
                catch (Exception cleanupError)
                {
                    Console.Error.WriteLine($"[CLEANUP ERROR] 自动清理失败：{cleanupError.Message}");
                }
                finally
                {
                    child.Dispose();
                }
            }
            try { File.Delete(configPath); } catch { /* Temporary config cleanup is best effort. */ }
        }
    }

    public static async Task<int> RunDiagnosticAsync()
    {
        Console.WriteLine("SSTap Next / 双栈 TUN 诊断（auto_route=false，不改路由/DNS）");
        if (!Doctor.IsAdministrator())
        {
            Console.Error.WriteLine("[BLOCKED] 需要管理员权限。");
            return 10;
        }
        var core = CoreLocator.FindSingBox();
        if (core is null)
        {
            Console.Error.WriteLine("[BLOCKED] 未找到 sing-box.exe。");
            return 11;
        }

        var logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SSTapNext", "Logs");
        Directory.CreateDirectory(logDirectory);
        var runId = Guid.NewGuid().ToString("N");
        var configPath = Path.Combine(Path.GetTempPath(), $"sstap-next-diag-{runId}.json");
        var logPath = Path.Combine(logDirectory, $"tun-diag-{DateTime.Now:yyyyMMdd-HHmmss}.log");
        await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(CreateDiagnosticConfiguration(logPath), JsonOptions), new UTF8Encoding(false));
        NativeConsoleProcess? child = null;
        try
        {
            var check = await ProcessRunner.RunCaptureAsync(core, ["check", "-c", configPath], TimeSpan.FromSeconds(20));
            if (check.ExitCode != 0)
            {
                Console.Error.WriteLine($"[FAIL] sing-box check 失败：{check.Error} {check.Output}");
                return 20;
            }

            child = NativeConsoleProcess.Start(core, ["run", "-c", configPath]);
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(20);
            NetworkInterface? found = null;
            while (DateTime.UtcNow < deadline && found is null && !child.HasExited)
            {
                found = FindInterfaceByAddress(DiagnosticIp);
                if (found is null) await Task.Delay(250);
            }

            if (found is null)
            {
                Console.Error.WriteLine("[FAIL] 20 秒内没有找到双栈 TUN 接口（172.19.0.1）。");
                Console.Error.WriteLine(await ReadLogTailAsync(logPath));
                Console.Error.WriteLine(DescribeInterfaces());
                return 21;
            }

            await WriteAdapterReportAsync(logDirectory, found);
            Console.WriteLine($"[OK] 找到双栈接口：{found.Name} / {found.Description} / OperationalStatus={found.OperationalStatus}");
            Console.WriteLine($"[RESULT] 地址：{string.Join(", ", found.GetIPProperties().UnicastAddresses.Select(a => $"{a.Address}/{a.PrefixLength}"))}");
            return 0;
        }
        finally
        {
            if (child is not null)
            {
                try { await child.StopGracefullyAsync(TimeSpan.FromSeconds(10)); } catch { }
                child.Dispose();
            }
            try { File.Delete(configPath); } catch { }
        }
    }

    public static async Task<int> RunFullDiagnosticAsync()
    {
        Console.WriteLine("SSTap Next / 完整 TUN 诊断（auto_route=true + strict_route=true + dns_mode=hijack，会短暂接管路由/DNS）");
        if (!Doctor.IsAdministrator())
        {
            Console.Error.WriteLine("[BLOCKED] 需要管理员权限。");
            return 10;
        }
        var core = CoreLocator.FindSingBox();
        if (core is null)
        {
            Console.Error.WriteLine("[BLOCKED] 未找到 sing-box.exe。");
            return 11;
        }

        var logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SSTapNext", "Logs");
        Directory.CreateDirectory(logDirectory);
        var runId = Guid.NewGuid().ToString("N");
        var configPath = Path.Combine(Path.GetTempPath(), $"sstap-next-fulldiag-{runId}.json");
        var logPath = Path.Combine(logDirectory, $"tun-fulldiag-{DateTime.Now:yyyyMMdd-HHmmss}.log");

        var beforeRoutes = await GetDefaultRouteSnapshotAsync();
        var beforeExternal = await GetExternalRouteSnapshotAsync();
        var beforeDns = await GetDnsSnapshotAsync();

        await File.WriteAllTextAsync(configPath, JsonSerializer.Serialize(CreateFullDiagnosticConfiguration(logPath), JsonOptions), new UTF8Encoding(false));
        NativeConsoleProcess? child = null;
        try
        {
            var check = await ProcessRunner.RunCaptureAsync(core, ["check", "-c", configPath], TimeSpan.FromSeconds(20));
            if (check.ExitCode != 0)
            {
                Console.Error.WriteLine($"[FAIL] sing-box check 失败：{check.Error} {check.Output}");
                return 20;
            }

            child = NativeConsoleProcess.Start(core, ["run", "-c", configPath]);
            var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
            NetworkInterface? found = null;
            while (DateTime.UtcNow < deadline && found is null && !child.HasExited)
            {
                found = FindInterfaceByAddress(FullDiagnosticIp);
                if (found is null) await Task.Delay(250);
            }

            if (found is null)
            {
                Console.Error.WriteLine("[FAIL] 15 秒内没有找到 TUN 接口（172.20.0.1），或 sing-box 已退出。");
                Console.Error.WriteLine(await ReadLogTailAsync(logPath));
                Console.Error.WriteLine(DescribeInterfaces());
                return 21;
            }

            await WriteAdapterReportAsync(logDirectory, found);
            Console.WriteLine($"[OK] 找到接口：{found.Name} / {found.Description} / OperationalStatus={found.OperationalStatus}");

            var stopped = await child.StopGracefullyAsync(TimeSpan.FromSeconds(12));
            if (!stopped) Console.Error.WriteLine("[WARN] 非优雅退出，已硬杀。");
            var removed = await WaitForAdapterRemovalAsync(TimeSpan.FromSeconds(15));
            if (!removed)
            {
                Console.Error.WriteLine("[FAIL] TUN 接口未移除。");
                return 25;
            }

            var afterRoutes = await GetDefaultRouteSnapshotAsync();
            var afterExternal = await GetExternalRouteSnapshotAsync();
            var afterDns = await GetDnsSnapshotAsync();
            var routesOk = StringComparer.Ordinal.Equals(beforeRoutes, afterRoutes);
            var externalOk = StringComparer.Ordinal.Equals(beforeExternal, afterExternal);
            var dnsOk = StringComparer.Ordinal.Equals(beforeDns, afterDns);
            Console.WriteLine($"[RESULT] 默认路由恢复={routesOk} 非测试网卡路由恢复={externalOk} DNS恢复={dnsOk}");
            return (routesOk && externalOk && dnsOk) ? 0 : 26;
        }
        finally
        {
            if (child is not null)
            {
                try { await child.StopGracefullyAsync(TimeSpan.FromSeconds(10)); } catch { }
                child.Dispose();
            }
            try { File.Delete(configPath); } catch { }
        }
    }

    private static object CreateFullDiagnosticConfiguration(string logPath) => new
    {
        log = new { level = "debug", timestamp = true, output = logPath },
        dns = new
        {
            servers = new[] { new { type = "udp", tag = "dns-direct", server = "223.5.5.5", server_port = 53 } },
            final = "dns-direct",
            strategy = "prefer_ipv4"
        },
        inbounds = new[]
        {
            new
            {
                type = "tun",
                tag = "sstap-tun-in",
                interface_name = "SSTap FullDiag",
                address = new[] { "172.20.0.1/30", "fdfe:dcba:9876::2/126" },
                mtu = 1400,
                auto_route = true,
                strict_route = true,
                dns_mode = "hijack"
            }
        },
        outbounds = new[] { new { type = "direct", tag = "direct" } },
        route = new
        {
            rules = new object[]
            {
                new { protocol = new[] { "dns" }, action = "hijack-dns" },
                new { action = "sniff" },
                new { ip_is_private = true, action = "route", outbound = "direct" }
            },
            auto_detect_interface = true,
            default_domain_resolver = "dns-direct",
            final = "direct"
        }
    };

    private static object CreateDiagnosticConfiguration(string logPath) => new
    {
        log = new { level = "debug", timestamp = true, output = logPath },
        inbounds = new[]
        {
            new
            {
                type = "tun",
                tag = "sstap-tun-in",
                interface_name = "SSTap Next",
                address = new[] { "172.19.0.1/30", "fdfe:dcba:9876::1/126" },
                mtu = 1400,
                auto_route = false,
                dns_mode = "disabled"
            }
        },
        outbounds = new[] { new { type = "direct", tag = "direct" } },
        route = new { auto_detect_interface = true, final = "direct" }
    };

    private static object CreateConfiguration(string logPath) => new
    {
        log = new { level = "debug", timestamp = true, output = logPath },
        inbounds = new[]
        {
            new
            {
                type = "tun",
                tag = "tun-smoke",
                interface_name = AdapterName,
                address = new[] { "172.31.254.1/30" },
                mtu = 1400,
                auto_route = false,
                dns_mode = "disabled"
            }
        },
        outbounds = new[] { new { type = "direct", tag = "direct" } },
        route = new { auto_detect_interface = true, final = "direct" }
    };

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true };

    private static NetworkInterface? FindInterfaceByAddress(IPAddress address)
    {
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                if (adapter.GetIPProperties().UnicastAddresses.Any(item => item.Address.Equals(address)))
                    return adapter;
            }
            catch (NetworkInformationException)
            {
                // Ignore interfaces that disappear while Windows is refreshing the adapter list.
            }
        }
        return null;
    }

    private static async Task WriteAdapterReportAsync(string logDirectory, NetworkInterface adapter)
    {
        try
        {
            var reportPath = Path.Combine(logDirectory, $"tun-smoke-adapter-{DateTime.Now:yyyyMMdd-HHmmss}.txt");
            var addresses = string.Join(", ", adapter.GetIPProperties().UnicastAddresses.Select(a => $"{a.Address}/{a.PrefixLength}"));
            var content = $"Name: {adapter.Name}{Environment.NewLine}"
                + $"Description: {adapter.Description}{Environment.NewLine}"
                + $"OperationalStatus: {adapter.OperationalStatus} ({(int)adapter.OperationalStatus}){Environment.NewLine}"
                + $"NetworkInterfaceType: {adapter.NetworkInterfaceType}{Environment.NewLine}"
                + $"Addresses: {addresses}{Environment.NewLine}";
            await File.WriteAllTextAsync(reportPath, content, Encoding.UTF8);
            Console.WriteLine($"适配器报告：{reportPath}");
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[WARN] 写入适配器报告失败：{ex.GetType().Name}: {ex.Message}");
        }
    }

    private static string DescribeInterfaces()
    {
        try
        {
            return string.Join(Environment.NewLine, NetworkInterface.GetAllNetworkInterfaces()
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .Select(item =>
                {
                    string addresses;
                    try { addresses = string.Join(", ", item.GetIPProperties().UnicastAddresses.Select(a => a.Address?.ToString() ?? "?")); }
                    catch (NetworkInformationException) { addresses = "<无法读取地址>"; }
                    return $"{item.Name} | {item.Description} | OperationalStatus={item.OperationalStatus} | {addresses}";
                }));
        }
        catch (Exception ex)
        {
            return $"无法枚举网络接口：{ex.GetType().Name}: {ex.Message}";
        }
    }

    private static NetworkInterface? FindInterfaceWithOverlappingPrefix(IPAddress networkAddress, int prefixLength)
    {
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces())
        {
            try
            {
                foreach (var unicast in adapter.GetIPProperties().UnicastAddresses)
                {
                    if (PrefixesOverlap(networkAddress, prefixLength, unicast.Address, unicast.PrefixLength))
                        return adapter;
                }
            }
            catch (NetworkInformationException)
            {
                // Ignore interfaces that disappear while Windows is refreshing the adapter list.
            }
        }
        return null;
    }

    private static bool PrefixesOverlap(IPAddress leftAddress, int leftPrefix, IPAddress rightAddress, int rightPrefix)
    {
        var left = leftAddress.GetAddressBytes();
        var right = rightAddress.GetAddressBytes();
        if (left.Length != right.Length) return false;
        var bits = Math.Min(Math.Clamp(leftPrefix, 0, left.Length * 8), Math.Clamp(rightPrefix, 0, right.Length * 8));
        var fullBytes = bits / 8;
        for (var i = 0; i < fullBytes; i++)
            if (left[i] != right[i]) return false;
        var remainingBits = bits % 8;
        if (remainingBits == 0) return true;
        var mask = (byte)(0xFF << (8 - remainingBits));
        return (left[fullBytes] & mask) == (right[fullBytes] & mask);
    }

    private static async Task<string?> FindOverlappingRouteAsync()
    {
        const string script = "$ErrorActionPreference = 'Stop'; try { Get-NetRoute -PolicyStore ActiveStore | Select-Object -ExpandProperty DestinationPrefix | ConvertTo-Json -Compress } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }";
        var result = await ProcessRunner.RunCaptureAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], TimeSpan.FromSeconds(15));
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"无法检查测试网段是否与现有路由重叠：{result.Error}");
        if (string.IsNullOrWhiteSpace(result.Output)) return null;

        using var document = JsonDocument.Parse(result.Output);
        var root = document.RootElement;
        IEnumerable<string> prefixes = root.ValueKind == JsonValueKind.Array
            ? root.EnumerateArray().Where(item => item.ValueKind == JsonValueKind.String).Select(item => item.GetString()!)
            : root.ValueKind == JsonValueKind.String ? [root.GetString()!] : [];
        foreach (var prefix in prefixes)
        {
            var parts = prefix.Split('/');
            if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var address)
                || !int.TryParse(parts[1], out var length)) continue;
            if (address.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork || length == 0) continue;
            if (length < 0 || length > 32) continue;
            if (PrefixesOverlap(TestNetworkAddress, TestPrefixLength, address, length)) return prefix;
        }
        return null;
    }

    private static async Task<NetworkInterface?> WaitForAdapterAsync(TimeSpan timeout, Func<bool> processExited)
    {
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (processExited()) return null;
            var found = FindInterfaceByAddress(TestIp);
            if (found is not null) return found;
            await Task.Delay(250);
        }
        return FindInterfaceByAddress(TestIp);
    }

    private static async Task<bool> WaitForAdapterRemovalAsync(TimeSpan timeout)
    {
        var until = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < until)
        {
            if (FindInterfaceByAddress(TestIp) is null) return true;
            await Task.Delay(250);
        }
        return FindInterfaceByAddress(TestIp) is null;
    }

    private static async Task<string> GetDefaultRouteSnapshotAsync()
    {
        const string script = "$ErrorActionPreference = 'Stop'; try { Get-NetRoute -PolicyStore ActiveStore | Where-Object { $_.DestinationPrefix -in @('0.0.0.0/0','::/0') } | Sort-Object DestinationPrefix,InterfaceIndex,NextHop,RouteMetric | Select-Object DestinationPrefix,InterfaceIndex,NextHop,RouteMetric,PolicyStore | ConvertTo-Json -Compress } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }";
        var result = await ProcessRunner.RunCaptureAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], TimeSpan.FromSeconds(12));
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"无法读取默认路由快照：{result.Error}");
        return result.Output.Trim();
    }

    private static async Task<string> GetExternalRouteSnapshotAsync()
    {
        const string script = "$ErrorActionPreference = 'Stop'; try { Get-NetRoute -PolicyStore ActiveStore | Where-Object { $_.InterfaceAlias -ne 'SSTap Next Test' } | Sort-Object DestinationPrefix,InterfaceIndex,NextHop,RouteMetric,PolicyStore | Select-Object DestinationPrefix,InterfaceIndex,InterfaceAlias,NextHop,RouteMetric,PolicyStore | ConvertTo-Json -Depth 4 -Compress } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }";
        var result = await ProcessRunner.RunCaptureAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], TimeSpan.FromSeconds(15));
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"无法读取非测试网卡路由快照：{result.Error}");
        return result.Output.Trim();
    }

    private static async Task<string> GetDnsSnapshotAsync()
    {
        const string script = "$ErrorActionPreference = 'Stop'; try { Get-DnsClientServerAddress | Where-Object { $_.InterfaceAlias -ne 'SSTap Next Test' } | Sort-Object InterfaceIndex,AddressFamily | Select-Object InterfaceIndex,InterfaceAlias,AddressFamily,ServerAddresses | ConvertTo-Json -Depth 4 -Compress } catch { [Console]::Error.WriteLine($_.ToString()); exit 1 }";
        var result = await ProcessRunner.RunCaptureAsync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], TimeSpan.FromSeconds(12));
        if (result.ExitCode != 0)
            throw new InvalidOperationException($"无法读取 DNS 快照：{result.Error}");
        return result.Output.Trim();
    }

    private static async Task<string> ReadLogTailAsync(string path)
    {
        try
        {
            if (!File.Exists(path)) return "（sing-box 尚未写入日志）";
            var lines = await File.ReadAllLinesAsync(path);
            return string.Join(Environment.NewLine, lines.TakeLast(35));
        }
        catch (IOException ex) { return $"读取日志失败：{ex.Message}"; }
    }
}

internal sealed class NativeConsoleProcess : IDisposable
{
    // CREATE_NEW_PROCESS_GROUP makes the child the leader of its own process group
    // (group id == child pid). That lets GenerateConsoleCtrlEvent target exactly the
    // child's group. Note: CREATE_NEW_PROCESS_GROUP is IGNORED if combined with
    // CREATE_NEW_CONSOLE, so the child inherits this process's console here.
    private const uint CreateNewProcessGroup = 0x00000200;
    private const uint StartfUseShowWindow = 0x00000001;
    private const ushort SwHide = 0;
    // CTRL_C_EVENT cannot be targeted to a process group: Windows documents that
    // a non-zero group id causes the target group not to receive the event.
    // CTRL_BREAK_EVENT is group-targetable and Go maps it to os.Interrupt on Windows.
    private const uint CtrlBreakEvent = 1;
    private const uint WaitObject0 = 0;
    private const uint WaitTimeout = 258;
    private const uint AttachParentProcess = 0xFFFFFFFF;

    private readonly IntPtr _processHandle;
    private readonly IntPtr _threadHandle;
    private readonly uint _processId;
    private bool _disposed;

    private NativeConsoleProcess(IntPtr processHandle, IntPtr threadHandle, uint processId)
    {
        _processHandle = processHandle;
        _threadHandle = threadHandle;
        _processId = processId;
    }

    public static NativeConsoleProcess Start(string executable, IReadOnlyList<string> arguments)
    {
        var commandLine = new StringBuilder(Quote(executable));
        foreach (var argument in arguments)
            commandLine.Append(' ').Append(Quote(argument));

        var startup = new StartupInfo
        {
            cb = Marshal.SizeOf<StartupInfo>(),
            dwFlags = StartfUseShowWindow,
            wShowWindow = SwHide
        };

        if (!CreateProcessW(executable, commandLine, IntPtr.Zero, IntPtr.Zero, false, CreateNewProcessGroup, IntPtr.Zero, Path.GetDirectoryName(executable), ref startup, out var processInfo))
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "无法启动 sing-box TUN 自检进程");

        return new NativeConsoleProcess(processInfo.hProcess, processInfo.hThread, processInfo.dwProcessId);
    }

    public bool HasExited => WaitForSingleObject(_processHandle, 0) == WaitObject0;
    public uint ProcessId => _processId;

    public async Task<bool> StopGracefullyAsync(TimeSpan timeout)
    {
        if (_disposed) return true;
        if (WaitForSingleObject(_processHandle, 0) == WaitObject0) return true;

        // Send CTRL+BREAK to the child's dedicated process group. CTRL+C cannot be
        // scoped to a process group on Windows; passing _processId to CTRL_C_EVENT
        // succeeds but the target group does not receive it, so sing-box would time out
        // and be force-killed without running its Wintun cleanup path.
        if (!GenerateConsoleCtrlEvent(CtrlBreakEvent, _processId))
        {
            var error = Marshal.GetLastWin32Error();
            Console.Error.WriteLine($"[WARN] 向 sing-box 进程组发送 CTRL+BREAK 失败：Win32 {error}");
        }
        else
        {
            Console.WriteLine($"[STOP] 已向 sing-box 进程组 {_processId} 发送 CTRL+BREAK，等待核心优雅退出…");
        }

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (WaitForSingleObject(_processHandle, 250) == WaitObject0)
            {
                Console.WriteLine($"[STOP] sing-box PID {_processId} 已响应退出信号并结束。");
                return true;
            }
            await Task.Delay(100);
        }

        // A hard kill is a last-resort safety measure. It cannot run sing-box's
        // deferred cleanup, so the caller must still verify the adapter is gone.
        Console.Error.WriteLine($"[WARN] sing-box PID {_processId} 在 {timeout.TotalSeconds:0} 秒内未优雅退出，正在执行最后手段强制终止。");
        if (!TerminateProcess(_processHandle, 0xEE))
        {
            var error = Marshal.GetLastWin32Error();
            if (WaitForSingleObject(_processHandle, 0) != WaitObject0)
                throw new System.ComponentModel.Win32Exception(error, $"无法强制终止 sing-box PID {_processId}。");
        }

        var forcedWait = WaitForSingleObject(_processHandle, 5000);
        if (forcedWait != WaitObject0)
        {
            if (forcedWait == WaitTimeout)
                throw new TimeoutException($"强制终止后仍无法确认 sing-box PID {_processId} 已退出；为避免遗留活动 TUN，本次不会报告清理成功。");
            throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), $"无法确认 sing-box PID {_processId} 的最终退出状态。");
        }
        Console.Error.WriteLine($"[WARN] sing-box PID {_processId} 已被强制终止；接下来仍必须确认 TUN/Wintun 资源已释放。");
        return false;
    }

    private static string Quote(string value)
    {
        if (value.Length > 0 && !value.Any(char.IsWhiteSpace) && !value.Contains('"')) return value;
        var builder = new StringBuilder("\"");
        var backslashes = 0;
        foreach (var c in value)
        {
            if (c == '\\') { backslashes++; continue; }
            if (c == '"')
            {
                builder.Append('\\', backslashes * 2 + 1).Append('"');
                backslashes = 0;
                continue;
            }
            builder.Append('\\', backslashes).Append(c);
            backslashes = 0;
        }
        builder.Append('\\', backslashes * 2).Append('"');
        return builder.ToString();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        CloseHandle(_threadHandle);
        CloseHandle(_processHandle);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct StartupInfo
    {
        public int cb;
        public string? lpReserved;
        public string? lpDesktop;
        public string? lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public ushort wShowWindow;
        public ushort cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ProcessInformation
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcessW(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string? currentDirectory, ref StartupInfo startupInfo, out ProcessInformation processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool AttachConsole(uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FreeConsole();

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GenerateConsoleCtrlEvent(uint controlEvent, uint processGroupId);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetConsoleCtrlHandler(IntPtr handler, bool add);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}
