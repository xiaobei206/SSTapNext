'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { buildTunConfig } = require('./tun-config.cjs');

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function captureProcess(executable, args, options = {}) {
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = options.timeoutMs || 20000;
  return new Promise((resolve, reject) => {
    const child = spawnImpl(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* process may already be closed */ }
      reject(new Error(`管理员 Agent 启动脚本超时（${timeoutMs} ms）`));
    }, timeoutMs);
    child.stdout?.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-64 * 1024); });
    child.stderr?.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-64 * 1024); });
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) reject(new Error((stderr || stdout || `PowerShell 退出代码 ${code}`).trim()));
      else resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

class TunController {
  constructor(options) {
    if (!options || typeof options.getAgentPath !== 'function' || typeof options.getCorePath !== 'function' || typeof options.getUserDataPath !== 'function' || typeof options.getLauncherPath !== 'function') {
      throw new TypeError('TunController 缺少 Agent、核心、会话目录或启动脚本提供器');
    }
    this.getAgentPath = options.getAgentPath;
    this.getCorePath = options.getCorePath;
    this.getUserDataPath = options.getUserDataPath;
    this.getLauncherPath = options.getLauncherPath;
    this.spawnImpl = options.spawnImpl || spawn;
    this.powershellPath = options.powershellPath || 'powershell.exe';
    this.inspectAdapter = options.inspectAdapter || (async (adapterId) => {
      const normalizedId = String(adapterId || '').replace(/[{}]/g, '');
      if (!/^[0-9a-f-]{36}$/i.test(normalizedId)) {
        throw new Error('历史网卡 GUID 格式无效，不能自动解除 TUN 清理锁。');
      }

      const script = [
        "$ErrorActionPreference = 'Stop'",
        \`$requested = [guid]'\${normalizedId}'\`,
        "try {",
        "  $matches = @(Get-NetAdapter -IncludeHidden -ErrorAction Stop | Where-Object { try { ([guid]$_.InterfaceGuid).ToString('D') -eq $requested.ToString('D') } catch { $false } })",
        "  if ($matches.Count -ne 1) { [ordered]@{ found = $false; matchCount = $matches.Count; inspectionError = 'Get-NetAdapter 未能唯一定位历史 GUID' } | ConvertTo-Json -Compress; exit 0 }",
        "  $adapter = $matches[0]",
        "  $addresses = @(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -ErrorAction SilentlyContinue | ForEach-Object { [string]$_.IPAddress } | Where-Object { $_ })",
        "  $rawStatus = [string]$adapter.Status",
        "  $status = if ($rawStatus -in @('Down','Disconnected')) { 'Down' } else { $rawStatus }",
        "  $active = ($status -eq 'Up') -or ($addresses -contains '172.19.0.1')",
        "  [ordered]@{ found = $true; name = [string]$adapter.Name; description = [string]$adapter.InterfaceDescription; id = ([guid]$adapter.InterfaceGuid).ToString('B'); status = $status; rawStatus = $rawStatus; addresses = $addresses; expectedTunAddress = '172.19.0.1'; operationallyActive = $active } | ConvertTo-Json -Compress",
        "} catch { [ordered]@{ found = $false; inspectionError = $_.Exception.Message } | ConvertTo-Json -Compress; exit 0 }"
      ].join('; ');

      let powershellFailure = null;
      try {
        const result = await captureProcess(this.powershellPath, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
        ], { spawnImpl: this.spawnImpl, timeoutMs: 12000 });
        const output = result.stdout.replace(/^\\uFEFF/, '').trim().split(/\\r?\\n/).filter(Boolean).at(-1);
        const inspected = JSON.parse(output || 'null');
        if (inspected?.found === true) return inspected;
        powershellFailure = inspected?.inspectionError || 'PowerShell 未找到该网卡';
      } catch (error) {
        powershellFailure = String(error.message || error);
      }

      // Use the read-only .NET Agent as an independent fallback when NetAdapter
      // cmdlets are unavailable or cannot locate the exact historical GUID.
      const agentPath = this.getAgentPath();
      if (!agentPath) throw new Error(\`PowerShell 网卡核验失败（\${powershellFailure}），且无法定位备用 Agent。\`);
      try {
        const result = await captureProcess(agentPath, ['--tun-inspect-adapter', '--id', \`{\${normalizedId}}\`], {
          spawnImpl: this.spawnImpl, timeoutMs: 10000,
        });
        const output = result.stdout.replace(/^\\uFEFF/, '').trim().split(/\\r?\\n/).filter(Boolean).at(-1);
        const inspected = JSON.parse(output || 'null');
        if (inspected?.found === true) return inspected;
        throw new Error(inspected?.error || inspected?.inspectionError || 'Agent 未找到该网卡');
      } catch (error) {
        throw new Error(\`PowerShell 核验失败：\${powershellFailure}；Agent 备用核验失败：\${error.message || error}\`);
      }
    });
    this.onEvent = options.onEvent || (() => {});
    this.session = null;
    this.startPromise = null;
    this.startNodeId = null;
    this.startMode = null;
    this.stopPromise = null;
    this.recoveryPromise = null;
    this.lastStatus = { status: 'disconnected', connected: false, lastError: null };
  }

  _publish(status) {
    this.lastStatus = { ...status };
    try { this.onEvent(this.getStatus()); } catch { /* UI listeners must not stop network cleanup. */ }
  }

  getStatus() {
    if (!this.session) return structuredClone(this.lastStatus);
    return {
      ...this.session.agentStatus,
      connected: this.session.agentStatus.status === 'running',
      nodeId: this.session.node.id,
      nodeName: this.session.node.name,
      server: this.session.node.server,
      serverPort: this.session.node.server_port,
      mode: this.session.mode,
      interfaceName: 'SSTap Next',
      logPath: this.session.logPath,
      sessionDirectory: this.session.directory,
    };
  }

  async _readAgentStatus(session) {
    try {
      const data = JSON.parse(await fs.readFile(session.statusPath, 'utf8'));
      if (data.sessionId !== session.sessionId) throw new Error('Agent 状态文件 Session ID 不匹配');
      session.agentStatus = data;
      this._publish(this.getStatus());
      return data;
    } catch (error) {
      if (error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async _writeHeartbeat(session) {
    await fs.writeFile(session.heartbeatPath, `${new Date().toISOString()}\n`, { encoding: 'utf8' });
  }

  _startHeartbeat(session) {
    this._stopHeartbeat(session);
    session.heartbeatTimer = setInterval(() => {
      this._writeHeartbeat(session).catch((error) => {
        session.heartbeatError = String(error.message || error);
        this._publish({ ...this.getStatus(), lastError: `桌面端心跳写入失败：${session.heartbeatError}` });
      });
    }, 3000);
    session.heartbeatTimer.unref?.();
  }

  _stopHeartbeat(session) {
    if (session?.heartbeatTimer) clearInterval(session.heartbeatTimer);
    if (session) session.heartbeatTimer = null;
  }

  async connect(node, settings = {}) {
    if (!node || typeof node.id !== 'string') throw new Error('请先选择一个有效节点');
    const requestedMode = settings.mode || 'global';
    if (this.session?.agentStatus?.status === 'running') {
      if (this.session.node.id === node.id && this.session.mode === requestedMode) return this.getStatus();
      throw new Error('系统 TUN 已连接。请先断开，再切换节点或分流策略。');
    }
    if (this.startPromise) {
      if (this.startNodeId === node.id && this.startMode === requestedMode) return this.startPromise;
      throw new Error('另一个系统 TUN 会话正在启动；请等待完成或取消后再切换节点。');
    }
    if (this.session) throw new Error('检测到未完成清理的 TUN 会话；为防止重复路由，禁止再次连接。请检查状态和日志。');

    this.startNodeId = node.id;
    this.startMode = requestedMode;
    this.startPromise = (async () => {
      if (this.stopPromise) await this.stopPromise;
      await this.recoverStaleSessions();
      if (this.session) throw new Error('检测到未完成清理的 TUN 会话；为防止重复路由，禁止再次连接。');
      return this._connect(node, settings);
    })().finally(() => { this.startPromise = null; this.startNodeId = null; this.startMode = null; });
    return this.startPromise;
  }


  async _verifyInactiveAdapterForOldCleanupError(sessionDocument, status) {
    // Match only the historical post-exit Wintun false-positive. Any unconfirmed
    // process, different interface, changed GUID, or ambiguous diagnostic stays blocked.
    if (status?.corePid != null || status?.interfaceName !== 'SSTap Next'
      || (sessionDocument?.interfaceName && sessionDocument.interfaceName !== 'SSTap Next')) return null;

    const detail = String(status.lastError || '');
    const exitedProcess = detail.match(/sing-box PID\s+(\d+)\s+已退出/);
    const adapterId = detail.match(/\bId=\{?([0-9a-f-]{36})\}?/i);
    const reportedStatus = detail.match(/\bStatus=([A-Za-z]+)/);
    const reportedAddresses = detail.match(/\bAddresses=\[([^\]]*)\]/);
    if (!exitedProcess || !adapterId || reportedStatus?.[1] !== 'Down'
      || !reportedAddresses || reportedAddresses[1].trim() !== '') return null;

    const expectedId = \`{\${adapterId[1]}}\`;
    const current = await this.inspectAdapter(expectedId);
    const normalizedExpected = adapterId[1].replace(/-/g, '').toLowerCase();
    const normalizedCurrent = String(current?.id || '').replace(/[{}-]/g, '').toLowerCase();
    if (!current || current.found !== true || current.ambiguous === true
      || current.inspectionError
      || current.name !== 'SSTap Next'
      || typeof current.description !== 'string'
      || !current.description.startsWith('sing-tun Tunnel')
      || normalizedCurrent !== normalizedExpected
      || !['Down', 'Disconnected'].includes(current.status)
      || !Array.isArray(current.addresses)
      || current.addresses.length !== 0
      || current.expectedTunAddress !== '172.19.0.1'
      || current.operationallyActive !== false) {
      throw new Error(\`实时网卡核验不满足安全恢复条件：\${JSON.stringify({
        found: current?.found, name: current?.name, description: current?.description,
        id: current?.id, status: current?.status, addresses: current?.addresses,
        operationallyActive: current?.operationallyActive, inspectionError: current?.inspectionError,
      })}\`);
    }

    return {
      exitedPid: Number(exitedProcess[1]), adapterId: current.id,
      adapterName: current.name, adapterDescription: current.description,
      status: current.status, addresses: current.addresses,
      rawStatus: current.rawStatus || current.status,
    };
  }


  async recoverStaleSessions() {
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = (async () => {
      try {
      const runtimeRoot = path.join(this.getUserDataPath(), 'runtime');
      let entries;
      try { entries = await fs.readdir(runtimeRoot, { withFileTypes: true }); }
      catch (error) { if (error?.code === 'ENOENT') return; throw error; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^tun-[a-f0-9]{32}$/i.test(entry.name)) continue;
        const directory = path.join(runtimeRoot, entry.name);
        const sessionPath = path.join(directory, 'session.json');
        const statusPath = path.join(directory, 'status.json');
        let sessionDocument = null;
        let status = null;
        try { sessionDocument = JSON.parse(await fs.readFile(sessionPath, 'utf8')); }
        catch (error) { if (error?.code !== 'ENOENT') throw new Error(`无法读取遗留 TUN 会话：${directory}（${error.message}）`); }
        try { status = JSON.parse(await fs.readFile(statusPath, 'utf8')); }
        catch (error) { if (error?.code !== 'ENOENT') throw new Error(`无法读取遗留 TUN 状态：${directory}（${error.message}）`); }

        if (!sessionDocument) {
          await fs.rm(directory, { recursive: true, force: true });
          continue;
        }
        const expectedId = entry.name.slice(4);
        if (sessionDocument.sessionId !== expectedId) throw new Error(`遗留 TUN 会话 ID 不匹配：${directory}；为避免误删文件，已停止自动恢复。`);
        if (!status) throw new Error(`遗留 TUN 会话没有状态文件：${directory}；请先检查系统是否残留“SSTap Next”网卡。`);
        if (status.sessionId !== expectedId) throw new Error(`遗留 TUN 状态 Session ID 不匹配：${directory}`);

        const terminal = new Set(['stopped', 'stopped_with_warning', 'error']);
        if (!terminal.has(status.status)) {
          await fs.writeFile(path.join(directory, 'stop.signal'), `${expectedId}\n`, 'utf8');
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            await delay(400);
            try { status = JSON.parse(await fs.readFile(statusPath, 'utf8')); }
            catch (error) { if (error?.code === 'ENOENT') break; throw error; }
            if (status.sessionId !== expectedId) throw new Error(`遗留 TUN 状态 Session ID 不匹配：${directory}`);
            if (terminal.has(status.status) || status.status === 'cleanup_error') break;
          }
        }
        if (status?.status === 'cleanup_error') {
          let verifiedInactiveAdapter = null;
          let verificationError = null;
          try {
            verifiedInactiveAdapter = await this._verifyInactiveAdapterForOldCleanupError(sessionDocument, status);
          } catch (error) {
            verificationError = String(error.message || error);
            console.warn(\`[TUN-RECOVERY] 旧会话网卡只读核验失败，保持启动锁：\${verificationError}\`);
          }
          if (verifiedInactiveAdapter) {
            const legacyStatusPath = path.join(directory, 'status.cleanup_error-legacy.json');
            const originalStatus = await fs.readFile(statusPath, 'utf8');
            try {
              await fs.writeFile(legacyStatusPath, originalStatus, { encoding: 'utf8', flag: 'wx' });
            } catch (error) {
              if (error?.code !== 'EEXIST') throw error;
            }

            const recoveredAt = new Date().toISOString();
            const recoveredStatus = {
              ...status, status: 'stopped_with_warning', corePid: null, updatedAt: recoveredAt,
              lastError: \`0.3.9 已核实历史 sing-box PID \${verifiedInactiveAdapter.exitedPid} 已退出；同一网卡 \${verifiedInactiveAdapter.adapterId} 当前为 \${verifiedInactiveAdapter.status} 且没有 IP 地址。已解除旧清理锁；保留 Windows Wintun 设备对象及原始日志，不删除网卡。\`,
            };
            const temporaryStatusPath = \`\${statusPath}.recovering\`;
            await fs.writeFile(temporaryStatusPath, JSON.stringify(recoveredStatus, null, 2), 'utf8');
            await fs.rename(temporaryStatusPath, statusPath);
            status = recoveredStatus;

            const recoveryMarker = path.join(directory, '.verified-inactive-adapter-recovered-0.3.9');
            await fs.writeFile(recoveryMarker, JSON.stringify({
              recoveredAt, source: 'PowerShell Get-NetAdapter/Get-NetIPAddress (with .NET Agent read-only fallback)',
              ...verifiedInactiveAdapter,
            }, null, 2), 'utf8');
            console.warn(\`[TUN-RECOVERY] 已确认历史 Wintun 已释放并正式解除旧 cleanup_error 锁：\${verifiedInactiveAdapter.adapterId}；原状态归档为 status.cleanup_error-legacy.json，日志保留。\`);
          } else {
            const legacyReviewMarker = path.join(directory, '.legacy-cleanup-review-0.3.2');
            const known031StopSignalFailure = status.corePid == null
              && status.interfaceName === 'SSTap Next'
              && String(status.lastError || '').includes('TUN 接口 SSTap Next 仍然存在');

            // 0.3.1 used CTRL_C_EVENT with a non-zero process-group id. Windows does
            // not deliver that event to the target group, so its Agent could force-kill
            // sing-box and leave a stale cleanup_error lock. Preserve old evidence and
            // let the 0.3.2 elevated Agent perform its normal adapter ownership guard.
            if (known031StopSignalFailure) {
              try {
                await fs.writeFile(legacyReviewMarker, \`Reviewed by SSTap Next 0.3.2 at \${new Date().toISOString()}\\n\`, { encoding: 'utf8', flag: 'wx' });
                console.warn(\`[TUN-RECOVERY] 已隔离已知 0.3.1 停止信号遗留锁 \${expectedId}；原日志和状态均保留，后续由新版 Agent 复核接口。\`);
              } catch (error) {
                if (error?.code !== 'EEXIST') throw error;
              }
              continue;
            }

            const reason = verificationError ? \`；实时核验失败：\${verificationError}\` : '';
            throw new Error(\`发现遗留 TUN 清理异常：\${status.lastError || directory}。请勿再次启用系统代理，先检查日志\${reason}。\`);
          }
        }
        if (!status || !terminal.has(status.status)) {
          throw new Error(`遗留 TUN 会话在 30 秒内没有完成安全断开：${directory}。请先检查网卡和 Agent 日志。`);
        }
        for (const name of ['config.json', 'session.json', 'heartbeat.touch', 'stop.signal']) {
          await fs.rm(path.join(directory, name), { force: true }).catch(() => {});
        }
      }
      this._publish({ status: 'disconnected', connected: false, lastError: null });
      } catch (error) {
        this._publish({ status: 'cleanup_error', connected: false, lastError: String(error.message || error) });
        throw error;
      }
    })().finally(() => { this.recoveryPromise = null; });
    return this.recoveryPromise;
  }

  async _connect(node, settings) {
    const agentPath = this.getAgentPath();
    const corePath = this.getCorePath();
    const launcherPath = this.getLauncherPath();
    for (const [label, value] of [['SSTap Next Agent', agentPath], ['sing-box.exe', corePath], ['Start-Tun-Agent.ps1', launcherPath]]) {
      if (!value) throw new Error(`未找到 ${label}。请先完整构建/安装 Windows 运行组件。`);
    }
    const sessionId = crypto.randomBytes(16).toString('hex');
    const directory = path.join(this.getUserDataPath(), 'runtime', `tun-${sessionId}`);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const session = {
      sessionId,
      directory,
      node: structuredClone(node),
      mode: settings.mode || 'global',
      configPath: path.join(directory, 'config.json'),
      statusPath: path.join(directory, 'status.json'),
      heartbeatPath: path.join(directory, 'heartbeat.touch'),
      stopPath: path.join(directory, 'stop.signal'),
      sessionPath: path.join(directory, 'session.json'),
      launchPath: path.join(directory, 'launch.json'),
      logPath: path.join(directory, 'sing-box.log'),
      cachePath: path.join(this.getUserDataPath(), 'cache', settings.dnsStrategy === 'prefer_ipv6'
        ? 'sing-box-cache-dual-ipv6.db'
        : settings.dnsStrategy === 'prefer_ipv4' ? 'sing-box-cache-dual-ipv4.db' : 'sing-box-cache-ipv4.db'),
      agentStatus: { sessionId, status: 'requested', updatedAt: new Date().toISOString(), lastError: null },
      heartbeatTimer: null,
    };
    this.session = session;
    this._publish({ ...session.agentStatus, nodeId: node.id, nodeName: node.name, mode: session.mode, interfaceName: 'SSTap Next', logPath: session.logPath });

    try {
      await fs.mkdir(path.dirname(session.cachePath), { recursive: true });
      const config = buildTunConfig(node, settings, { interfaceName: 'SSTap Next', logPath: session.logPath, cachePath: session.cachePath });
      const configText = JSON.stringify(config, null, 2);
      const configSha256 = crypto.createHash('sha256').update(configText, 'utf8').digest('hex');
      await fs.writeFile(session.configPath, configText, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      const document = {
        sessionId,
        configSha256,
        cachePath: session.cachePath,
        corePath,
        configPath: session.configPath,
        statusPath: session.statusPath,
        heartbeatPath: session.heartbeatPath,
        stopPath: session.stopPath,
        logPath: session.logPath,
        interfaceName: 'SSTap Next',
        mode: session.mode,
      };
      await fs.writeFile(session.sessionPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await this._writeHeartbeat(session);
      await fs.writeFile(session.statusPath, JSON.stringify(session.agentStatus), { encoding: 'utf8', flag: 'wx', mode: 0o600 });

      this._publish({ ...session.agentStatus, status: 'awaiting_uac', nodeId: node.id, nodeName: node.name, mode: session.mode, interfaceName: 'SSTap Next', logPath: session.logPath });
      this._startHeartbeat(session);
      await captureProcess(this.powershellPath, [
        '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
        '-File', launcherPath, '-AgentPath', agentPath, '-SessionPath', directory,
      ], { spawnImpl: this.spawnImpl, timeoutMs: 120000 });

      const deadline = Date.now() + 45000;
      while (Date.now() < deadline) {
        await delay(450);
        const status = await this._readAgentStatus(session);
        if (status?.status === 'running') return this.getStatus();
        if (status && ['error', 'cleanup_error', 'stopped', 'stopped_with_warning'].includes(status.status)) {
          throw new Error(status.lastError || `系统 TUN 未能启动，Agent 状态：${status.status}`);
        }
        if (status?.lastError) throw new Error(status.lastError);
      }
      throw new Error('等待管理员 Agent 启动 TUN 超时。请检查 UAC 是否被取消，以及 Agent 日志。');
    } catch (error) {
      this._stopHeartbeat(session);
      try { await fs.writeFile(session.stopPath, `${sessionId}\n`, 'utf8'); } catch { /* Agent may not have started. */ }
      const cleanupDeadline = Date.now() + 12000;
      let finalStatus = null;
      while (Date.now() < cleanupDeadline) {
        finalStatus = await this._readAgentStatus(session).catch(() => null);
        if (!finalStatus || ['stopped', 'stopped_with_warning', 'error', 'cleanup_error'].includes(finalStatus.status)) break;
        await delay(350);
      }
      if (finalStatus?.status === 'cleanup_error') {
        this._publish({ ...finalStatus, nodeId: node.id, nodeName: node.name, mode: session.mode, logPath: session.logPath });
        throw new Error(`${error.message || error}；Agent 报告清理异常，请不要继续连接。日志：${session.logPath}`);
      }
      if (finalStatus?.status !== 'running' && finalStatus?.status !== 'stopping') {
        this.session = null;
        await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
        this._publish({ status: 'error', connected: false, nodeId: node.id, nodeName: node.name, lastError: String(error.message || error) });
      }
      throw error;
    }
  }

  async disconnect() {
    if (this.stopPromise) return this.stopPromise;
    if (this.startPromise) await this.startPromise.catch(() => {});
    if (!this.session) return this.getStatus();
    const session = this.session;
    this.stopPromise = (async () => {
      this._publish({ ...this.getStatus(), status: 'stopping', connected: false });
      this._stopHeartbeat(session);
      await fs.writeFile(session.stopPath, `${session.sessionId}\n`, 'utf8');
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        await delay(500);
        const status = await this._readAgentStatus(session);
        if (status?.status === 'stopped' || status?.status === 'stopped_with_warning') {
          const result = { ...status, connected: false, nodeId: session.node.id, nodeName: session.node.name, mode: session.mode, interfaceName: session.interfaceName || 'SSTap Next', logPath: session.logPath };
          this.session = null;
          await fs.rm(session.configPath, { force: true }).catch(() => {});
          await fs.rm(session.sessionPath, { force: true }).catch(() => {});
          await fs.rm(session.heartbeatPath, { force: true }).catch(() => {});
          await fs.rm(session.stopPath, { force: true }).catch(() => {});
          // Keep the log/status files for diagnostics; they contain no node credentials.
          this._publish(result);
          return result;
        }
        if (status?.status === 'cleanup_error') {
          this._publish({ ...status, connected: false, nodeId: session.node.id, nodeName: session.node.name, mode: session.mode, logPath: session.logPath });
          throw new Error(`${status.lastError || 'TUN 清理失败'}；请不要再次启动系统代理。`);
        }
        if (status?.status === 'error') {
          this._publish({ ...status, connected: false, nodeId: session.node.id, nodeName: session.node.name, mode: session.mode, logPath: session.logPath });
          this.session = null;
          throw new Error(status.lastError || 'Agent 报告 TUN 退出异常，请检查日志。');
        }
      }
      throw new Error(`等待 TUN 清理超时。不要继续连接；请检查接口“${session.interfaceName || 'SSTap Next'}”是否仍存在。日志：${session.logPath}`);
    })().finally(() => { this.stopPromise = null; });
    return this.stopPromise;
  }

  async dispose() {
    if (this.session) return this.disconnect();
    return this.getStatus();
  }
}

module.exports = { TunController, captureProcess };
