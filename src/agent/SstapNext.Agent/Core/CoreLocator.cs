namespace SstapNext.Agent.Core;

internal static class CoreLocator
{
    public static string? FindSingBox()
    {
        var fromEnvironment = Environment.GetEnvironmentVariable("SSTAP_SING_BOX");
        if (!string.IsNullOrWhiteSpace(fromEnvironment) && File.Exists(fromEnvironment))
            return Path.GetFullPath(fromEnvironment);

        return FindBundledSingBox();
    }

    // Elevated TUN sessions must never execute an arbitrary path supplied by an editable
    // session.json. Only known application-owned installation locations are accepted.
    public static string? FindBundledSingBox()
    {
        var candidates = GetBundledCandidates();
        return candidates.FirstOrDefault(File.Exists);
    }

    public static bool IsAllowedForElevatedRun(string candidate)
    {
        if (!Path.IsPathFullyQualified(candidate)) return false;
        var fullCandidate = Path.GetFullPath(candidate);
        return GetBundledCandidates().Any(allowed =>
            StringComparer.OrdinalIgnoreCase.Equals(Path.GetFullPath(allowed), fullCandidate));
    }

    private static IEnumerable<string> GetBundledCandidates()
    {
        var baseDirectory = AppContext.BaseDirectory;
        yield return Path.GetFullPath(Path.Combine(baseDirectory, "runtime", "sing-box", "sing-box.exe"));
        yield return Path.GetFullPath(Path.Combine(baseDirectory, "..", "sing-box", "sing-box.exe"));
        yield return Path.GetFullPath(Path.Combine(baseDirectory, "..", "..", "runtime", "sing-box", "sing-box.exe"));
        yield return Path.GetFullPath(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "SSTap Next", "runtime", "sing-box", "sing-box.exe"));
    }
}
