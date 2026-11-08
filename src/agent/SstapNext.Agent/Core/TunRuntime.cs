using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text;
using System.Text.Json;

namespace SstapNext.Agent.Core;

internal static class TunRuntime
{
    private static readonly TimeSpan StartupTimeout = TimeSpan.FromSeconds(35);
    private static readonly TimeSpan StopTimeout = TimeSpan.FromSeconds(18);
    private static readonly TimeSpan AdapterRemovalTimeout = TimeSpan.FromSeconds(18);
    private static readonly TimeSpan HeartbeatTimeout = TimeSpan.FromSeconds(20);
    private static readonly TimeSpan PollInterval = TimeSpan.FromMilliseconds(500);
    private const string ExpectedInterfaceName = "SSTap Next";
    private const string ExpectedTunDescriptionPrefix = "sing-tun Tunnel";
    // Must match src/shared/tun-config.cjs DEFAULT_TUN_ADDRESS[0].
    private const string ExpectedTunAddress = "172.19.0.1";

    private sealed record SessionDocument(
        string SessionId,
        string ConfigSha256,
        string CachePath,
        string CorePath,
        string ConfigPath,
        string StatusPath,
        string HeartbeatPath,
        string StopPath,
        string LogPath,
        string InterfaceName,
        string Mode);

    private sealed record AgentStatus(
        string SessionId,
        string Status,
        int? CorePid,
        string InterfaceName,
        string Mode,
        string? StartedAt,
        string? UpdatedAt,
        string? LastError,
        string? LogPath);

    private sealed record AdapterSnapshot(string Id, OperationalStatus Status, bool HasExpectedAddress);


    public static int InspectAdapter(string[] args)
    {
        if (args.Length != 4 || !StringComparer.Ordinal.Equals(args[0], "--id")
            || !Guid.TryParse(args[1], out var requestedId)
            || !StringComparer.Ordinal.Equals(args[2], "--pid")
            || !int.TryParse(args[3], out var requestedPid) || requestedPid <= 0)
        {
            Console.WriteLine(JsonSerializer.Serialize(new { found = false, inspectionComplete = false, error = "用法：--tun-inspect-adapter --id <GUID> --pid <PID>" }));
            return 11;
        }

        try
        {
            var adapters = NetworkInterface.GetAllNetworkInterfaces();
            var matches = adapters
                .Where(adapter => Guid.TryParse(adapter.Id, out var adapterId) && adapterId == requestedId)
                .ToArray();
            var relatedAdapters = adapters
                .Where(adapter =>
                    StringComparer.OrdinalIgnoreCase.Equals(adapter.Name, ExpectedInterfaceName)
                    || adapter.Description.StartsWith(ExpectedTunDescriptionPrefix, StringComparison.OrdinalIgnoreCase))
                .Select(InspectNetworkInterface)
                .ToArray();
            var process = InspectProcess(requestedPid);
            var otherAgents = InspectOtherAgentProcesses();

            if (matches.Length != 1)
            {
                Console.WriteLine(JsonSerializer.Serialize(new
                {
                    found = false,
                    inspectionComplete = true,
                    ambiguous = matches.Length > 1,
                    matchCount = matches.Length,
                    requestedId = requestedId.ToString("B"),
                    relatedAdapters,
                    processId = requestedPid,
                    processCheckComplete = process.CheckComplete,
                    singBoxProcessRunning = process.SingBoxRunning,
                    processName = process.ProcessName,
                    otherAgentProcessCheckComplete = otherAgents.CheckComplete,
                    otherAgentProcessCount = otherAgents.Count
                }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
                return 0;
            }

            var adapter = InspectNetworkInterface(matches[0]);
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                found = true,
                inspectionComplete = true,
                matchCount = 1,
                name = adapter.Name,
                description = adapter.Description,
                id = adapter.Id,
                status = adapter.Status,
                addresses = adapter.Addresses,
                inspectionError = adapter.InspectionError,
                relatedAdapters,
                processId = requestedPid,
                processCheckComplete = process.CheckComplete,
                singBoxProcessRunning = process.SingBoxRunning,
                processName = process.ProcessName,
                expectedTunAddress = ExpectedTunAddress,
                operationallyActive = adapter.OperationallyActive,
                otherAgentProcessCheckComplete = otherAgents.CheckComplete,
                otherAgentProcessCount = otherAgents.Count
            }, new JsonSerializerOptions(JsonSerializerDefaults.Web)));
            return 0;
        }
        catch (Exception ex)
        {
            Console.WriteLine(JsonSerializer.Serialize(new
            {
                found = false,
                inspectionComplete = false,
                error = ex.GetType().Name + ": " + ex.Message
            }));
            return 1;
        }
    }

    private sealed record AdapterInspection(
        string Name, string Description, string Id, string Status, string[] Addresses,
        bool OperationallyActive, string? InspectionError);

    private sealed record ProcessInspection(bool CheckComplete, bool SingBoxRunning, string? ProcessName);
    private sealed record OtherAgentProcessInspection(bool CheckComplete, int Count);

    private static OtherAgentProcessInspection InspectOtherAgentProcesses()
    {
        try
        {
            var processes = Process.GetProcessesByName("SstapNext.Agent");
            var otherCount = 0;
            foreach (var process in processes)
            {
                try
                {
                    if (process.Id != Environment.ProcessId) otherCount++;
                }
                finally
                {
                    process.Dispose();
                }
            }
            return new OtherAgentProcessInspection(true, otherCount);
        }
        catch
        {
            return new OtherAgentProcessInspection(false, -1);
        }
    }

    private static AdapterInspection InspectNetworkInterface(NetworkInterface adapter)
    {
        string[] addresses;
        string? inspectionError = null;
        try
        {
            addresses = adapter.GetIPProperties().UnicastAddresses
                .Select(item => item.Address?.ToString() ?? string.Empty)
                .Where(item => item.Length > 0)
                .ToArray();
        }
        catch (Exception ex)
        {
            addresses = [];
            inspectionError = ex.GetType().Name + ": " + ex.Message;
        }

        var hasExpectedAddress = addresses.Contains(ExpectedTunAddress, StringComparer.OrdinalIgnoreCase);
        return new AdapterInspection(
            adapter.Name, adapter.Description, adapter.Id, adapter.OperationalStatus.ToString(),
            addresses, adapter.OperationalStatus == OperationalStatus.Up || hasExpectedAddress,
            inspectionError);
    }

    private static ProcessInspection InspectProcess(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            if (process.HasExited) return new ProcessInspection(true, false, null);
            var processName = process.ProcessName;
            return new ProcessInspection(true,
                StringComparer.OrdinalIgnoreCase.Equals(processName, "sing-box"), processName);
        }
        catch (ArgumentException)
        {
            return new ProcessInspection(true, false, null);
        }
        catch (InvalidOperationException)
        {
            return new ProcessInspection(true, false, null);
        }
        catch
        {
            // Unreadable process state must never be treated as proof of absence.
            return new ProcessInspection(false, true, null);
        }
    }

    public static async Task<int> RunAsync(string[] args)
    {
        if (!Doctor.IsAdministrator())
        {
            Console.Error.WriteLine("[BLOCKED] 系统 TUN 运行必须由 UAC 管理员进程启动。");
            return 10;
        }
        if (args.Length != 2 || !StringComparer.OrdinalIgnoreCase.Equals(args[0], "--session"))
        {
            Console.Error.WriteLine("用法：SstapNext.Agent.exe --tun-run --session <会话目录>");
            return 11;
        }

        var sessionDirectory = Path.GetFullPath(args[1]);
        SessionDocument? session = null;
        var sessionValidated = false;
        NativeConsoleProcess? child = null;
        AdapterSnapshot? preExistingAdapterSnapshot = null;
        var coreStarted = false;
        var startedAt = DateTimeOffset.UtcNow.ToString("O");
        string? lastError = null;
        try
        {
            ValidateSessionDirectoryBeforeRead(sessionDirectory);
            var sessionFile = Path.Combine(sessionDirectory, "session.json");
            if (!File.Exists(sessionFile)) throw new FileNotFoundException("缺少 TUN 会话描述文件。", sessionFile);
            RejectReparsePointIfPresent(sessionFile);
            session = JsonSerializer.Deserialize<SessionDocument>(await File.ReadAllTextAsync(sessionFile, Encoding.UTF8), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidDataException("TUN 会话描述文件为空。");
            ValidateSession(sessionDirectory, session);
            sessionValidated = true;
            ValidateRestrictedTunConfig(session);

            // Never adopt, overwrite, or later delete an adapter that was not created by this session.
            var preExistingAdapter = FindAdapter(session.InterfaceName);
            preExistingAdapterSnapshot = SnapshotAdapter(preExistingAdapter);
            if (preExistingAdapter?.OperationalStatus == OperationalStatus.Up)
                throw new InvalidOperationException($"检测到已存在且处于 Up 状态的 TUN 接口“{preExistingAdapter.Name}”。为避免接管或删除其他会话的活动网卡，本次启动已阻止；请先核查旧会话与网络状态。");
            if (preExistingAdapter is not null)
                Console.WriteLine($"检测到同名 TUN 接口“{preExistingAdapter.Name}”（{preExistingAdapter.OperationalStatus}）。该接口启动前已存在；本次不会主动删除它，继续尝试启动核心。");

            await WriteStatusAsync(session, "starting", null, startedAt, null);
            Console.WriteLine("[1/4] 检查 sing-box 核心与 TUN 配置…");
            if (!File.Exists(session.CorePath)) throw new FileNotFoundException("未找到 sing-box.exe。", session.CorePath);
            var version = await ProcessRunner.RunCaptureAsync(session.CorePath, ["version"], TimeSpan.FromSeconds(10));
            if (version.ExitCode != 0) throw new InvalidOperationException($"sing-box version 检查失败：{version.Error} {version.Output}".Trim());
            var check = await ProcessRunner.RunCaptureAsync(session.CorePath, ["check", "-c", session.ConfigPath], TimeSpan.FromSeconds(30));
            if (check.ExitCode != 0) throw new InvalidOperationException($"sing-box 配置检查未通过：{check.Error} {check.Output}".Trim());

            Console.WriteLine("[2/4] 启动系统 TUN。路由与 DNS 由 sing-box 管理…");
            child = NativeConsoleProcess.Start(session.CorePath, ["run", "-c", session.ConfigPath]);
            coreStarted = true;
            var adapter = await WaitForAdapterAsync(session.InterfaceName, StartupTimeout, () => child.HasExited, preExistingAdapterSnapshot);
            if (adapter is null)
            {
                var logTail = await ReadTailAsync(session.LogPath, 80);
                throw new InvalidOperationException($"TUN 网卡在 {StartupTimeout.TotalSeconds:0} 秒内没有进入 Up 状态。{Environment.NewLine}--- sing-box 日志 ---{Environment.NewLine}{logTail}{Environment.NewLine}--- 当前网络接口 ---{Environment.NewLine}{DescribeInterfaces()}");
            }

            await WriteStatusAsync(session, "running", (int)child.ProcessId, startedAt, null);
            Console.WriteLine($"[3/4] TUN 已启动：{adapter.Name} / {adapter.OperationalStatus} / PID {child.ProcessId}");
            Console.WriteLine("Agent 正在监视停止信号和桌面端心跳。关闭应用或心跳中断时会自动停止 TUN。");

            while (!child.HasExited)
            {
                if (File.Exists(session.StopPath))
                {
                    var token = (await File.ReadAllTextAsync(session.StopPath)).Trim();
                    if (StringComparer.Ordinal.Equals(token, session.SessionId)) break;
                }

                var heartbeatAge = DateTime.UtcNow - File.GetLastWriteTimeUtc(session.HeartbeatPath);
                if (!File.Exists(session.HeartbeatPath) || heartbeatAge > HeartbeatTimeout)
                {
                    lastError = $"桌面端心跳中断（{heartbeatAge.TotalSeconds:0} 秒）；Agent 已触发安全断开。";
                    break;
                }
                await Task.Delay(PollInterval);
            }

            if (child.HasExited)
            {
                var logTail = await ReadTailAsync(session.LogPath, 80);
                lastError = $"sing-box 意外退出。{logTail}".Trim();
            }

            await WriteStatusAsync(session, "stopping", (int)child.ProcessId, startedAt, lastError);
            Console.WriteLine("[4/4] 正在停止 sing-box 并等待 TUN 网卡移除…");
            var graceful = await child.StopGracefullyAsync(StopTimeout);
            if (!child.HasExited)
                throw new InvalidOperationException($"sing-box PID {child.ProcessId} 尚未确认退出；为避免在核心仍运行时重新接管 TUN，本次停止失败。");
            Console.WriteLine($"[STOP] sing-box PID {child.ProcessId} 已退出（graceful={graceful}）。等待 Wintun 接口释放…");
            var removed = await WaitForAdapterRemovalAsync(session.InterfaceName, AdapterRemovalTimeout, preExistingAdapterSnapshot);
            if (!removed)
            {
                var remainingAdapter = FindAdapter(session.InterfaceName);
                var adapterDetails = DescribeAdapter(remainingAdapter);
                lastError = string.Join(Environment.NewLine, new[]
                {
                    lastError,
                    $"sing-box PID {child.ProcessId} 已退出，但 TUN 接口 {session.InterfaceName} 在 {AdapterRemovalTimeout.TotalSeconds:0} 秒后仍被检测为本次会话残留。",
                    adapterDetails,
                    "不要再次启动系统代理；请检查网络适配器和 Agent 日志。"
                }.Where(x => !string.IsNullOrWhiteSpace(x)));
                Console.Error.WriteLine($"[CLEANUP-FAIL] {lastError}");
                await WriteStatusAsync(session, "cleanup_error", null, startedAt, lastError);
                return 30;
            }
            if (!graceful && lastError is null)
                lastError = "sing-box 未能在超时内正常处理退出信号，Agent 已结束进程并确认 TUN 接口消失。";
            await WriteStatusAsync(session, lastError is null ? "stopped" : "stopped_with_warning", null, startedAt, lastError);
            var retainedAdapter = FindAdapter(session.InterfaceName);
            if (retainedAdapter is null)
                Console.WriteLine("[OK] 本次 TUN 会话已断开，适配器已移除。");
            else if (!IsAdapterOperationallyActive(retainedAdapter))
                Console.WriteLine($"[OK] TUN 已释放。Windows 保留了 Wintun 适配器对象“{retainedAdapter.Name}”（Status={retainedAdapter.OperationalStatus}，无 {ExpectedTunAddress} 地址）；该接口当前不承载本次会话流量，程序不会擅自删除它。");
            else
                Console.WriteLine($"[OK] 本次 TUN 会话已断开；启动前已存在的活动接口“{retainedAdapter.Name}”保持原状并被保留，没有删除其他会话资源。");
            return 0;
        }
        catch (Exception ex)
        {
            lastError = $"{ex.GetType().Name}: {ex.Message}";
            Console.Error.WriteLine($"[FAIL] {lastError}");
            if (session is not null && sessionValidated)
            {
                try { await WriteStatusAsync(session, "stopping", child is { HasExited: false } ? (int)child.ProcessId : null, startedAt, lastError); } catch { }
            }
            var coreConfirmedStopped = child is null;
            if (child is not null)
            {
                try
                {
                    var graceful = await child.StopGracefullyAsync(StopTimeout);
                    coreConfirmedStopped = child.HasExited;
                    Console.WriteLine($"[STOP] 异常清理：sing-box PID {child.ProcessId} 已退出={coreConfirmedStopped}（graceful={graceful}）。");
                    if (session is not null && coreConfirmedStopped)
                        await WaitForAdapterRemovalAsync(session.InterfaceName, AdapterRemovalTimeout, preExistingAdapterSnapshot);
                }
                catch (Exception cleanup)
                {
                    lastError += $"；清理异常：{cleanup.Message}";
                    coreConfirmedStopped = child.HasExited;
                }
            }
            if (session is not null && sessionValidated)
            {
                try
                {
                    var remaining = FindAdapter(session.InterfaceName);
                    var hasSessionResidual = IsSessionResidualAdapter(remaining, preExistingAdapterSnapshot);
                    // Never publish a recoverable plain error while the core might
                    // still be alive; that would let the desktop controller remove the
                    // session directory and start a second TUN over an active process.
                    var finalStatus = coreStarted && (!coreConfirmedStopped || hasSessionResidual) ? "cleanup_error" : "error";
                    if (finalStatus == "cleanup_error" && hasSessionResidual)
                        lastError += Environment.NewLine + DescribeAdapter(remaining);
                    await WriteStatusAsync(session, finalStatus, child is { HasExited: false } ? (int)child.ProcessId : null, startedAt, lastError);
                }
                catch { }
            }
            return 20;
        }
        finally
        {
            child?.Dispose();
            if (session is not null && sessionValidated)
            {
                try { File.Delete(session.ConfigPath); } catch { }
                try { File.Delete(session.StopPath); } catch { }
                try { File.Delete(session.HeartbeatPath); } catch { }
            }
        }
    }

    private static void ValidateSession(string sessionDirectory, SessionDocument session)
    {
        if (session.SessionId is null || session.SessionId.Length != 32 || !session.SessionId.All(Uri.IsHexDigit))
            throw new InvalidDataException("TUN 会话 ID 格式无效。");
        if (session.Mode is not ("global" or "bypass-cn" or "rule"))
            throw new InvalidDataException("TUN 分流模式无效。");
        if (!StringComparer.OrdinalIgnoreCase.Equals(Path.GetFileName(sessionDirectory), $"tun-{session.SessionId}"))
            throw new InvalidDataException("TUN 会话目录与 Session ID 不匹配。");
        if (!StringComparer.OrdinalIgnoreCase.Equals(Path.GetFileName(Path.GetDirectoryName(sessionDirectory)), "runtime"))
            throw new InvalidDataException("TUN 会话目录不在受支持的 runtime 目录内。");
        var userDataDirectory = Directory.GetParent(Path.GetDirectoryName(sessionDirectory)!)?.FullName
            ?? throw new InvalidDataException("无法定位应用数据目录。");
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var appDataRoot = IsInside(appData, sessionDirectory) ? appData
            : IsInside(localAppData, sessionDirectory) ? localAppData
            : throw new InvalidDataException("TUN 会话目录必须位于当前用户的 AppData 内。");
        EnsureNoReparsePoints(appDataRoot, sessionDirectory);
        if (!StringComparer.OrdinalIgnoreCase.Equals(session.InterfaceName, ExpectedInterfaceName))
            throw new InvalidDataException("TUN 接口名称不符合程序固定值，已阻止运行。");
        if (session.ConfigSha256.Length != 64 || !session.ConfigSha256.All(Uri.IsHexDigit))
            throw new InvalidDataException("TUN 配置 SHA-256 格式无效。");
        if (!new[] { session.ConfigPath, session.StatusPath, session.HeartbeatPath, session.StopPath, session.LogPath }
            .All(candidate => IsInside(sessionDirectory, candidate)))
            throw new InvalidDataException("会话文件路径必须全部位于当前临时会话目录内。");
        foreach (var file in new[] { session.ConfigPath, session.StatusPath, session.HeartbeatPath, session.StopPath, session.LogPath })
            RejectReparsePointIfPresent(file);
        var cacheFileName = Path.GetFileName(session.CachePath);
        if (cacheFileName is not ("sing-box-cache-ipv4.db" or "sing-box-cache-dual-ipv4.db" or "sing-box-cache-dual-ipv6.db"))
            throw new InvalidDataException("sing-box 缓存文件名不在允许列表中。");
        var expectedCache = Path.GetFullPath(Path.Combine(userDataDirectory, "cache", cacheFileName));
        if (!StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(session.CachePath), expectedCache))
            throw new InvalidDataException("sing-box 缓存路径不符合应用数据目录限制。");
        EnsureNoReparsePoints(appDataRoot, Path.GetDirectoryName(expectedCache)!);
        RejectReparsePointIfPresent(expectedCache);
        if (!CoreLocator.IsAllowedForElevatedRun(session.CorePath))
            throw new InvalidDataException("Agent 拒绝执行非应用安装目录内的 sing-box.exe。");
        if (!File.Exists(session.CorePath) || !File.Exists(session.ConfigPath) || !File.Exists(session.HeartbeatPath))
            throw new FileNotFoundException("sing-box 核心、TUN 配置或桌面端初始心跳文件不存在。");
        RejectReparsePointIfPresent(session.CorePath);
        if (File.Exists(session.StopPath) && !StringComparer.Ordinal.Equals(File.ReadAllText(session.StopPath).Trim(), session.SessionId))
            throw new InvalidDataException("停止信号文件验证失败。");

        var actualHash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(File.ReadAllBytes(session.ConfigPath)));
        if (!StringComparer.OrdinalIgnoreCase.Equals(actualHash, session.ConfigSha256))
            throw new InvalidDataException("TUN 配置文件校验失败，可能在 UAC 授权期间被修改。");
    }

    private static void ValidateRestrictedTunConfig(SessionDocument session)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(session.ConfigPath));
        var root = document.RootElement;
        // Endpoints remain categorically forbidden in the elevated TUN process.
        // The statistics API is permitted only in the narrow loopback-only shape
        // validated below; do not remove or broaden this Agent security boundary.
        if (root.TryGetProperty("endpoints", out _))
            throw new InvalidDataException("TUN 配置不允许使用根级 endpoints。");

        if (!root.TryGetProperty("inbounds", out var inbounds) || inbounds.ValueKind != JsonValueKind.Array || inbounds.GetArrayLength() != 1)
            throw new InvalidDataException("TUN 配置只能包含一个受限的 TUN 入站。");
        var inbound = inbounds[0];
        if (GetString(inbound, "type") != "tun"
            || GetString(inbound, "tag") != "sstap-tun-in"
            || GetString(inbound, "interface_name") != ExpectedInterfaceName
            || !GetBoolean(inbound, "auto_route")
            || !GetBoolean(inbound, "strict_route")
            || GetString(inbound, "dns_mode") != "hijack")
            throw new InvalidDataException("TUN 入站配置不符合 SSTap Next 的受限路由策略。");

        if (!root.TryGetProperty("outbounds", out var outbounds) || outbounds.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("TUN 配置缺少 outbounds。");
        var outboundTags = new HashSet<string>(StringComparer.Ordinal);
        var hasSelectedProxy = false;
        var hasDirect = false;
        var hasBlock = false;
        foreach (var outbound in outbounds.EnumerateArray())
        {
            var tag = GetString(outbound, "tag");
            var type = GetString(outbound, "type");
            if (string.IsNullOrWhiteSpace(tag) || !outboundTags.Add(tag))
                throw new InvalidDataException("TUN 配置包含空或重复的 outbound tag。");
            if (tag == "selected-proxy")
            {
                if (type is not ("vless" or "hysteria2" or "shadowsocks" or "vmess" or "trojan"))
                    throw new InvalidDataException("所选节点 outbound 类型不受支持。");
                if (!outbound.TryGetProperty("domain_resolver", out var resolver)
                    || resolver.ValueKind != JsonValueKind.String
                    || resolver.GetString() != "dns-bootstrap")
                    throw new InvalidDataException("代理节点域名必须使用固定直连引导 DNS，防止 DNS 与代理形成递归依赖。");
                hasSelectedProxy = true;
            }
            else if (tag == "direct" && type == "direct") hasDirect = true;
            else if (tag == "block" && type == "block") hasBlock = true;
            else throw new InvalidDataException($"TUN 配置包含不允许的 outbound：{tag}/{type}");
        }
        if (!hasSelectedProxy || !hasDirect || !hasBlock || outboundTags.Count != 3)
            throw new InvalidDataException("TUN 配置必须且只能包含 selected-proxy、direct、block 三个 outbound。");

        if (!root.TryGetProperty("route", out var route)
            || GetString(route, "final") != "selected-proxy"
            || GetString(route, "default_domain_resolver") != "dns-bootstrap"
            || !GetBoolean(route, "auto_detect_interface"))
            throw new InvalidDataException("TUN route 缺少防止代理回环的物理接口自动检测、固定引导 DNS 或默认代理路由。");
        if (route.TryGetProperty("rules", out var routeRules) && routeRules.ValueKind == JsonValueKind.Array)
        {
            foreach (var rule in routeRules.EnumerateArray())
            {
                if (rule.TryGetProperty("outbound", out var outbound) && !outboundTags.Contains(outbound.GetString() ?? ""))
                    throw new InvalidDataException("路由规则引用了不允许的 outbound。");
            }
        }

        if (!root.TryGetProperty("dns", out var dns) || GetString(dns, "final") != "dns-remote"
            || !dns.TryGetProperty("servers", out var dnsServers) || dnsServers.ValueKind != JsonValueKind.Array)
            throw new InvalidDataException("TUN DNS 配置缺少固定的远端 DNS fallback。");
        var bootstrapDns = dnsServers.EnumerateArray().FirstOrDefault(item => GetString(item, "tag") == "dns-bootstrap");
        var remoteDns = dnsServers.EnumerateArray().FirstOrDefault(item => GetString(item, "tag") == "dns-remote");
        if (bootstrapDns.ValueKind != JsonValueKind.Object || GetString(bootstrapDns, "type") != "udp"
            || GetString(bootstrapDns, "server") != "223.5.5.5")
            throw new InvalidDataException("TUN 代理节点引导 DNS 未遵循受限的直连解析配置。");
        if (remoteDns.ValueKind != JsonValueKind.Object || GetString(remoteDns, "type") != "https"
            || GetString(remoteDns, "server") != "1.1.1.1" || GetString(remoteDns, "detour") != "selected-proxy")
            throw new InvalidDataException("TUN 远端 DoH 必须通过所选代理出站，防止 DNS 明文直连泄漏。");
        if (!root.TryGetProperty("log", out var log) || !StringComparer.OrdinalIgnoreCase.Equals(GetString(log, "output"), session.LogPath))
            throw new InvalidDataException("sing-box 日志必须写入当前会话目录。");
        if (!root.TryGetProperty("experimental", out var experimentalConfig)
            || experimentalConfig.ValueKind != JsonValueKind.Object
            || !experimentalConfig.TryGetProperty("cache_file", out var cache)
            || !GetBoolean(cache, "enabled")
            || !StringComparer.OrdinalIgnoreCase.Equals(GetString(cache, "path"), session.CachePath))
            throw new InvalidDataException("sing-box 缓存必须限制在当前用户应用数据目录。");

        if (experimentalConfig.TryGetProperty("clash_api", out var clashApi))
            ValidateRestrictedClashApi(clashApi);

        foreach (var property in experimentalConfig.EnumerateObject())
        {
            if (property.Name is not ("cache_file" or "clash_api"))
                throw new InvalidDataException($"TUN experimental 配置不允许字段：{property.Name}");
        }
    }

    private static void ValidateRestrictedClashApi(JsonElement clashApi)
    {
        if (clashApi.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Clash API 配置必须是对象。");

        var fields = new HashSet<string>(StringComparer.Ordinal);
        foreach (var property in clashApi.EnumerateObject())
        {
            if (!fields.Add(property.Name))
                throw new InvalidDataException("Clash API 配置包含重复字段。");
            if (property.Name is not ("external_controller" or "secret"))
                throw new InvalidDataException($"TUN Clash API 不允许字段：{property.Name}");
        }
        if (fields.Count != 2 || !fields.Contains("external_controller") || !fields.Contains("secret"))
            throw new InvalidDataException("TUN Clash API 只能包含 external_controller 与 secret。");

        if (!clashApi.TryGetProperty("external_controller", out var endpointElement)
            || endpointElement.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("TUN Clash API 必须指定本地控制端点。");

        var endpoint = endpointElement.GetString() ?? string.Empty;
        var endpointMatch = System.Text.RegularExpressions.Regex.Match(
            endpoint,
            @"^127\.0\.0\.1:([0-9]{1,5})$",
            System.Text.RegularExpressions.RegexOptions.CultureInvariant);
        if (!endpointMatch.Success
            || !int.TryParse(endpointMatch.Groups[1].Value, System.Globalization.NumberStyles.None,
                System.Globalization.CultureInfo.InvariantCulture, out var port)
            || port < 1 || port > 65535)
            throw new InvalidDataException("TUN Clash API 只允许监听 127.0.0.1 的有效 TCP 端口。");

        if (!clashApi.TryGetProperty("secret", out var secretElement)
            || secretElement.ValueKind != JsonValueKind.String
            || !System.Text.RegularExpressions.Regex.IsMatch(secretElement.GetString() ?? string.Empty,
                "^[0-9a-fA-F]{64}$", System.Text.RegularExpressions.RegexOptions.CultureInvariant))
            throw new InvalidDataException("TUN Clash API 密钥必须是 64 位十六进制随机值。");
    }

    private static void ValidateSessionDirectoryBeforeRead(string sessionDirectory)
    {
        var full = Path.GetFullPath(sessionDirectory);
        if (!System.Text.RegularExpressions.Regex.IsMatch(Path.GetFileName(full), @"^tun-[a-f0-9]{32}$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            throw new InvalidDataException("TUN 会话目录名称无效。");
        var parent = Path.GetDirectoryName(full);
        if (parent is null || !StringComparer.OrdinalIgnoreCase.Equals(Path.GetFileName(parent), "runtime"))
            throw new InvalidDataException("TUN 会话目录不在 runtime 目录内。");
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var root = IsInside(appData, full) ? appData
            : IsInside(localAppData, full) ? localAppData
            : throw new InvalidDataException("TUN 会话目录必须位于当前用户的 AppData 内。");
        EnsureNoReparsePoints(root, full);
    }

    private static void EnsureNoReparsePoints(string trustedRoot, string target)
    {
        var root = Path.GetFullPath(trustedRoot).TrimEnd(Path.DirectorySeparatorChar);
        var full = Path.GetFullPath(target);
        if (!IsInside(root, full) && !StringComparer.OrdinalIgnoreCase.Equals(root, full.TrimEnd(Path.DirectorySeparatorChar)))
            throw new InvalidDataException("受信任文件路径越过了 AppData 边界。");
        var current = full;
        while (!StringComparer.OrdinalIgnoreCase.Equals(current.TrimEnd(Path.DirectorySeparatorChar), root))
        {
            RejectReparsePointIfPresent(current);
            current = Path.GetDirectoryName(current) ?? throw new InvalidDataException("无法验证文件路径目录链。");
        }
    }

    private static void RejectReparsePointIfPresent(string path)
    {
        if (!File.Exists(path) && !Directory.Exists(path)) return;
        var attributes = File.GetAttributes(path);
        if ((attributes & FileAttributes.ReparsePoint) != 0)
            throw new InvalidDataException($"拒绝通过符号链接或重解析点访问提权文件：{path}");
    }

    private static string? GetString(JsonElement parent, string property)
        => parent.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;

    private static bool GetBoolean(JsonElement parent, string property)
        => parent.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.True;

    private static bool IsInside(string root, string candidate)
    {
        var fullRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        var fullCandidate = Path.GetFullPath(candidate);
        return fullCandidate.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static async Task<NetworkInterface?> WaitForAdapterAsync(string name, TimeSpan timeout, Func<bool> processExited, AdapterSnapshot? before)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (processExited()) return null;
            var adapter = FindAdapter(name);
            if (adapter is not null)
            {
                if (adapter.OperationalStatus == OperationalStatus.Up) return adapter;
                // sing-box has created and addressed the interface. Raw Wintun adapters may
                // report a non-Up media state in .NET even though the tunnel is functional;
                // the assigned TUN address is the authoritative "configured" signal.
                if (HasExpectedTunAddress(adapter) && !IsUnchangedPreExistingAdapter(adapter, before))
                {
                    Console.WriteLine($"TUN 接口 {adapter.Name} 已由本次会话配置 {ExpectedTunAddress}，OperationalStatus={adapter.OperationalStatus}；按已配置继续。");
                    return adapter;
                }
            }
            await Task.Delay(PollInterval);
        }
        return null;
    }

    private static NetworkInterface? FindAdapter(string name)
    {
        try
        {
            var adapters = NetworkInterface.GetAllNetworkInterfaces();
            var namedAdapter = adapters.FirstOrDefault(item =>
                StringComparer.OrdinalIgnoreCase.Equals(item.Name, name)
                || StringComparer.OrdinalIgnoreCase.Equals(item.Description, name));
            if (namedAdapter is not null) return namedAdapter;

            // sing-box may expose the Wintun device under a different .NET Name.
            // Only use the TUN address as a fallback when the adapter description
            // also identifies the sing-box Wintun driver; never match an arbitrary NIC
            // solely because it happens to carry 172.19.0.1.
            return adapters.FirstOrDefault(item =>
                item.Description.StartsWith(ExpectedTunDescriptionPrefix, StringComparison.OrdinalIgnoreCase)
                && HasExpectedTunAddress(item));
        }
        catch (NetworkInformationException) { return null; }
    }

    private static bool HasExpectedTunAddress(NetworkInterface adapter)
    {
        try
        {
            return adapter.GetIPProperties().UnicastAddresses
                .Any(item => item.Address != null
                    && StringComparer.OrdinalIgnoreCase.Equals(item.Address.ToString(), ExpectedTunAddress));
        }
        catch (NetworkInformationException) { return false; }
    }

    private static string DescribeAdapter(NetworkInterface? adapter)
    {
        if (adapter is null) return "适配器详情：当前无法按接口名称重新枚举到对应网卡。";
        try
        {
            var addresses = string.Join(", ", adapter.GetIPProperties().UnicastAddresses
                .Select(item => item.Address?.ToString() ?? "?"));
            return $"适配器详情：Name={adapter.Name}; Description={adapter.Description}; Id={adapter.Id}; Status={adapter.OperationalStatus}; Type={adapter.NetworkInterfaceType}; Addresses=[{addresses}]";
        }
        catch (Exception ex)
        {
            return $"适配器详情：Name={adapter.Name}; Description={adapter.Description}; Id={adapter.Id}; Status={adapter.OperationalStatus}; 地址读取失败={ex.GetType().Name}: {ex.Message}";
        }
    }

    private static string DescribeInterfaces()
    {
        try
        {
            var rows = NetworkInterface.GetAllNetworkInterfaces()
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .Select(item =>
                {
                    string addresses;
                    try
                    {
                        addresses = string.Join(", ", item.GetIPProperties().UnicastAddresses.Select(a => a.Address?.ToString() ?? "?"));
                    }
                    catch (NetworkInformationException) { addresses = "<无法读取地址>"; }
                    return $"{item.Name} | {item.Description} | OperationalStatus={item.OperationalStatus} | {addresses}";
                });
            return string.Join(Environment.NewLine, rows);
        }
        catch (Exception ex)
        {
            return $"无法枚举网络接口：{ex.GetType().Name}: {ex.Message}";
        }
    }

    private static AdapterSnapshot? SnapshotAdapter(NetworkInterface? adapter)
        => adapter is null ? null : new AdapterSnapshot(adapter.Id, adapter.OperationalStatus, HasExpectedTunAddress(adapter));

    private static bool IsUnchangedPreExistingAdapter(NetworkInterface current, AdapterSnapshot? before)
    {
        return before is not null
            && StringComparer.OrdinalIgnoreCase.Equals(current.Id, before.Id)
            && current.OperationalStatus == before.Status
            && HasExpectedTunAddress(current) == before.HasExpectedAddress;
    }

    private static bool IsAdapterOperationallyActive(NetworkInterface adapter)
    {
        // Wintun/sing-box may leave the adapter object installed after its last
        // session handle is closed. A Down interface with no TUN address is not
        // carrying this session's traffic and must not be treated as a leak.
        // Keep the guard strict for an Up interface or one still holding the
        // address assigned by this application.
        return adapter.OperationalStatus == OperationalStatus.Up || HasExpectedTunAddress(adapter);
    }

    private static bool IsSessionResidualAdapter(NetworkInterface? current, AdapterSnapshot? before)
    {
        if (current is null) return false;
        if (!IsAdapterOperationallyActive(current)) return false;
        if (before is null) return true;
        if (!StringComparer.OrdinalIgnoreCase.Equals(current.Id, before.Id)) return true;

        // An unchanged pre-existing adapter remains outside this session's
        // ownership. A changed adapter is a residual only while it is still
        // operational or still holds the configured TUN address.
        return current.OperationalStatus != before.Status
            || HasExpectedTunAddress(current) != before.HasExpectedAddress;
    }

    private static async Task<bool> WaitForAdapterRemovalAsync(string name, TimeSpan timeout, AdapterSnapshot? before)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            if (!IsSessionResidualAdapter(FindAdapter(name), before)) return true;
            await Task.Delay(PollInterval);
        }
        return !IsSessionResidualAdapter(FindAdapter(name), before);
    }

    private static async Task WriteStatusAsync(SessionDocument session, string status, int? pid, string? startedAt, string? error)
    {
        var payload = new AgentStatus(session.SessionId, status, pid, session.InterfaceName, session.Mode,
            startedAt, DateTimeOffset.UtcNow.ToString("O"), error, session.LogPath);
        var temp = session.StatusPath + ".tmp";
        await File.WriteAllTextAsync(temp, JsonSerializer.Serialize(payload, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true }), new UTF8Encoding(false));
        File.Move(temp, session.StatusPath, true);
    }

    private static async Task<string> ReadTailAsync(string path, int maxLines)
    {
        try
        {
            if (!File.Exists(path)) return "未生成 sing-box 日志文件。";
            var lines = await File.ReadAllLinesAsync(path);
            return string.Join(Environment.NewLine, lines.TakeLast(maxLines));
        }
        catch (IOException ex) { return $"日志读取失败：{ex.Message}"; }
    }
}
