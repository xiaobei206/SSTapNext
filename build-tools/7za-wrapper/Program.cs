// Build-time workaround for the Windows symlink-privilege limitation.
// app-builder invokes 7za.exe with "x -snld -bd", where "-snld" makes 7-Zip
// try to recreate macOS darwin/*.dylib symlinks inside winCodeSign. On Windows
// without Developer Mode/admin, that fails with "Cannot create symbolic link".
// 7-Zip's "-snl-" flag dereferences/skips symlinks and exits 0. This wrapper
// rewrites "-snld" to "-snl-" and delegates everything else to the real 7za.
using System.Diagnostics;

var exeDir = AppContext.BaseDirectory;
var real = Path.Combine(exeDir, "7za-real.exe");
if (!File.Exists(real))
{
    Console.Error.WriteLine($"7za wrapper: real 7za not found at {real}");
    return 2;
}

var rewritten = args.Select(a => a == "-snld" ? "-snl-" : a).ToArray();

var psi = new ProcessStartInfo
{
    FileName = real,
    UseShellExecute = false,
};
foreach (var arg in rewritten)
    psi.ArgumentList.Add(arg);

using var process = Process.Start(psi) ?? throw new InvalidOperationException("无法启动 7za-real.exe");
process.WaitForExit();
return process.ExitCode;
