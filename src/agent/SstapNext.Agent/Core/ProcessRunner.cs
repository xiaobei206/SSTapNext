using System.Diagnostics;

namespace SstapNext.Agent.Core;

internal sealed record ProcessResult(int ExitCode, string Output, string Error);

internal static class ProcessRunner
{
    public static async Task<ProcessResult> RunCaptureAsync(string executable, IReadOnlyList<string> arguments, TimeSpan timeout)
    {
        var executableDirectory = Path.GetDirectoryName(executable);
        var startInfo = new ProcessStartInfo
        {
            FileName = executable,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = string.IsNullOrWhiteSpace(executableDirectory) ? Environment.CurrentDirectory : executableDirectory,
        };
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = new Process { StartInfo = startInfo };
        if (!process.Start())
            throw new InvalidOperationException($"无法启动程序：{executable}");

        var stdoutTask = process.StandardOutput.ReadToEndAsync();
        var stderrTask = process.StandardError.ReadToEndAsync();
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await process.WaitForExitAsync(cts.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* Process may already have exited. */ }
            using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            try { await process.WaitForExitAsync(cleanup.Token); } catch (OperationCanceledException) { }
            if (process.HasExited)
            {
                try { await Task.WhenAll(stdoutTask, stderrTask); } catch { /* Preserve the original timeout as the primary failure. */ }
            }
            throw new TimeoutException($"程序执行超时：{Path.GetFileName(executable)}");
        }

        return new ProcessResult(process.ExitCode, await stdoutTask, await stderrTask);
    }
}
