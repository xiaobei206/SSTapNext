import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Page = 'home' | 'nodes' | 'rules' | 'speed' | 'settings';

const icons: Record<Page, string> = {
  home: '◫', nodes: '◈', rules: '⌘', speed: '↗', settings: '⚙',
};

function formatBytes(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)} GB`;
  return `${Math.round(value / 1_000_000)} MB`;
}

function formatTrafficBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return Math.round(value) + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return amount.toFixed(index === 0 ? 1 : 2) + ' ' + units[index];
}

function formatTrafficRate(value: number): string {
  return formatTrafficBytes(value) + '/s';
}

function formatSessionDuration(startedAt?: string | null, sampledAt?: string, active = true): string {
  const start = startedAt ? Date.parse(startedAt) : NaN;
  const end = !active && sampledAt ? Date.parse(sampledAt) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.floor((end - start) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return hours > 0
    ? String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
    : String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0');
}

type NodeSortKey = 'ping' | 'tcping' | 'proxyLatency' | 'download' | 'trafficUpload' | 'trafficDownload' | 'trafficTotal' | 'testedAt';

function App() {
  const [page, setPage] = useState<Page>('home');
  const [state, setState] = useState<SstapState | null>(null);
  const [ruleLibrary, setRuleLibrary] = useState<SstapRuleLibrary>({ installed: false, source: 'FQrabbit/SSTap-Rule', revision: null, updatedAt: null, ruleCount: 0, totalCidrs: 0, skipped: [], rules: [] });
  const [ruleLibraryBusy, setRuleLibraryBusy] = useState(false);
  const [ruleSearch, setRuleSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [coreBusy, setCoreBusy] = useState(false);
  const [speedTestBusy, setSpeedTestBusy] = useState(false);
  const [batchTestBusy, setBatchTestBusy] = useState(false);
  const [batchConcurrency, setBatchConcurrency] = useState('4');
  const [batchSelectedNodeIds, setBatchSelectedNodeIds] = useState<string[]>([]);
  const [batchTestProgress, setBatchTestProgress] = useState<SstapBatchTestProgress>({ status: 'completed', total: 0, completed: 0, failed: 0, active: 0 });
  const [coreStatus, setCoreStatus] = useState<SstapCoreStatus>({ status: 'disconnected', connected: false });
  const [tunStatus, setTunStatus] = useState<SstapTunStatus>({ status: 'disconnected', connected: false });
  const [traffic, setTraffic] = useState<SstapTrafficSample | null>(null);
  const [tunBusy, setTunBusy] = useState(false);
  const [customRulesText, setCustomRulesText] = useState('');
  const [coreInfo, setCoreInfo] = useState<SstapCoreInfo>({ installed: false, executable: null, version: null, error: null });
  const [speedProgress, setSpeedProgress] = useState<SstapSpeedProgress>({ status: 'starting', ratio: 0, receivedBytes: 0, totalBytes: 0 });
  const [latestSpeedResult, setLatestSpeedResult] = useState<SstapSpeedResult | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [importErrors, setImportErrors] = useState<Array<{ line: number; message: string }>>([]);
  const [importText, setImportText] = useState('');
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [subscriptionName, setSubscriptionName] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [speedUrl, setSpeedUrl] = useState('');
  const [speedBytes, setSpeedBytes] = useState('');
  const [threads, setThreads] = useState('1');

  useEffect(() => {
    const unsubscribeCore = window.sstap.onCoreEvent(setCoreStatus);
    const unsubscribeTun = window.sstap.onTunEvent(setTunStatus);
    const unsubscribeTraffic = window.sstap.onTrafficEvent(setTraffic);
    const unsubscribeSpeed = window.sstap.onSpeedProgress(setSpeedProgress);
    const unsubscribeBatch = window.sstap.onBatchTestProgress((progress) => {
      setBatchTestProgress(progress);
      if (progress.nodeId && progress.result) {
        setState((current) => {
          if (!current) return current;
          const previous = current.nodeTestResults?.[progress.nodeId!] as SstapNodeTestResult | undefined;
          const patch = progress.result!;
          const merged: SstapNodeTestResult = {
            testedAt: patch.testedAt || previous?.testedAt || new Date().toISOString(),
            status: patch.status || previous?.status || 'testing',
            ping: { ...(previous?.ping || { status: 'testing' as const }), ...(patch.ping || {}) },
            tcping: { ...(previous?.tcping || { status: 'testing' as const }), ...(patch.tcping || {}) },
            proxyLatency: { ...(previous?.proxyLatency || { status: 'testing' as const }), ...(patch.proxyLatency || {}) },
            download: { ...(previous?.download || { status: 'testing' as const }), ...(patch.download || {}) },
          };
          return { ...current, nodeTestResults: { ...(current.nodeTestResults || {}), [progress.nodeId!]: merged } };
        });
      }
    });
    window.sstap.getRuleLibrary().then(setRuleLibrary).catch((reason: unknown) => setError(String(reason)));
    window.sstap.getState()
      .then((result) => {
        setState(result);
        if (result.nodes.length > 0) setSelectedNodeId(result.nodes[0].id);
        setSpeedUrl(result.settings.speedTestUrl);
        setSpeedBytes(String(result.settings.speedTestBytes));
        setThreads(String(result.settings.speedTestThreads));
        setBatchConcurrency(String(result.settings.batchTestConcurrency || 4));
        setCustomRulesText(result.settings.customRulesText || '');
        if (result.speedResults?.[0]) setLatestSpeedResult(result.speedResults[0]);
        if (result.recoveryNotice) setNotice(result.recoveryNotice);
      })
      .catch((reason: unknown) => setError(String(reason)))
      .finally(() => setLoading(false));
    window.sstap.checkCore().then(setCoreInfo).catch((reason: unknown) => setCoreInfo({ installed: false, executable: null, version: null, error: String(reason) }));
    window.sstap.getCoreStatus().then(setCoreStatus).catch(() => {});
    window.sstap.getTunStatus().then(setTunStatus).catch(() => {});
    return () => {
      unsubscribeCore();
      unsubscribeTun();
      unsubscribeTraffic();
      unsubscribeSpeed();
      unsubscribeBatch();
    };
  }, []);

  const selectedNode = useMemo(() => state?.nodes.find((node) => node.id === selectedNodeId) || null, [state, selectedNodeId]);
  const tunRulesLocked = ['requested', 'awaiting_uac', 'starting', 'running', 'stopping', 'cleanup_error'].includes(tunStatus.status || '');

  function applyState(next: SstapState, message: string) {
    setState(next);
    if (!next.nodes.some((node) => node.id === selectedNodeId)) setSelectedNodeId(next.nodes[0]?.id || '');
    setImportErrors((next.errors || []).map((item) => ({ line: item.line, message: item.message })));
    if (next.refreshPreserved) {
      setNotice('订阅更新未应用；旧节点列表已完整保留');
      setError(next.refreshError || '订阅更新未能完成');
    } else if (next.importSummary) {
      const summary = next.importSummary;
      setNotice(`${message}：新增 ${summary.added}，匹配更新 ${summary.updated}，未识别 ${summary.failed}`);
      setError('');
    } else {
      setNotice(message);
      setError('');
    }
  }

  async function runAction(action: () => Promise<SstapState>, success: string): Promise<boolean> {
    setBusy(true);
    setError('');
    try {
      const next = await action();
      applyState(next, success);
      return true;
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function importClipboard() {
    if (!importText.trim()) return;
    const success = await runAction(() => window.sstap.importText(importText), '剪贴板导入完成');
    if (success) setImportText('');
  }

  async function pasteFromClipboard() {
    try {
      const value = await navigator.clipboard.readText();
      setImportText((current) => current ? `${current}\n${value}` : value);
      setNotice('已读取剪贴板内容；确认后点击“解析并导入”');
    } catch {
      setError('无法读取剪贴板。请在输入框中使用 Ctrl+V 粘贴。');
    }
  }

  async function addSubscription() {
    if (!subscriptionUrl.trim()) return;
    setBusy(true);
    setError('');
    try {
      const next = await window.sstap.addSubscription(subscriptionUrl.trim(), subscriptionName.trim());
      applyState(next, '订阅添加完成');
      setSubscriptionUrl('');
      setSubscriptionName('');
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSubscription(id: string) {
    await runAction(() => window.sstap.refreshSubscription(id), '订阅更新完成');
  }

  async function deleteSubscription(id: string, name: string) {
    if (!window.confirm(`删除订阅“${name}”？仅删除该订阅独有的节点；仍由其他来源提供的节点会保留。`)) return;
    await runAction(() => window.sstap.deleteSubscription(id), '订阅已删除');
  }

  async function removeNode(id: string) {
    if (coreStatus.connected && coreStatus.nodeId === id) {
      setError('该节点正在连接中，请先断开代理，再删除节点。');
      return;
    }
    await runAction(() => window.sstap.deleteNode(id), '节点已删除');
  }

  async function saveBatchSettings() {
    await runAction(() => window.sstap.saveSettings({
      batchTestConcurrency: Number(batchConcurrency),
      speedTestThreads: Number(threads),
    }), '批量测速参数已保存');
  }

  function toggleBatchNodeSelection(nodeId: string, selected: boolean) {
    setBatchSelectedNodeIds((current) => selected
      ? (current.includes(nodeId) ? current : [...current, nodeId])
      : current.filter((id) => id !== nodeId));
  }

  async function startBatchNodeTest(scope: 'all' | 'selected') {
    if (!state || batchTestBusy) return;
    const nodeIds = scope === 'all'
      ? state.nodes.map((node) => node.id)
      : batchSelectedNodeIds.filter((id) => state.nodes.some((node) => node.id === id));
    if (nodeIds.length === 0) {
      setError(scope === 'all' ? '当前没有可检测的节点。' : '请先勾选需要检测的节点。');
      return;
    }
    setBatchTestBusy(true);
    setError('');
    setBatchTestProgress({ status: 'starting', total: nodeIds.length, completed: 0, failed: 0, active: 0, concurrency: Number(batchConcurrency) });
    try {
      const savedSettings = await window.sstap.saveSettings({
        batchTestConcurrency: Number(batchConcurrency),
        speedTestThreads: Number(threads),
      });
      setState(savedSettings);
      const result = await window.sstap.startBatchNodeTest({ nodeIds, concurrency: Number(batchConcurrency) });
      const latest = await window.sstap.getState();
      setState(latest);
      setNotice(result.status === 'cancelled'
        ? '批量检测已取消：完成 ' + result.completed + '/' + result.total + ' 个节点'
        : '批量检测完成：' + result.completed + '/' + result.total + ' 个节点；失败/部分结果 ' + result.failed + ' 个；每节点实际下载线程 ' + result.effectiveDownloadThreads);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setBatchTestBusy(false);
    }
  }

  async function cancelBatchNodeTest() {
    try { await window.sstap.cancelBatchNodeTest(); }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
  }

  async function saveSpeedSettings() {
    await runAction(() => window.sstap.saveSettings({
      speedTestUrl: speedUrl,
      speedTestBytes: Number(speedBytes),
      speedTestThreads: Number(threads),
    }), '测速参数已保存');
  }

  async function saveMode(mode: SstapState['settings']['mode']) {
    await runAction(() => window.sstap.saveSettings({ mode }), '分流模式已保存');
  }


  async function updateRuleLibrary() {
    setRuleLibraryBusy(true);
    setError('');
    try {
      const next = await window.sstap.updateRuleLibrary();
      setRuleLibrary(next);
      if (state) {
        const installedIds = new Set(next.rules.map((item) => item.id));
        const selected = state.settings.enabledRuleIds || [];
        const kept = selected.filter((id) => installedIds.has(id));
        if (kept.length !== selected.length) setState(await window.sstap.saveSettings({ enabledRuleIds: kept }));
      }
      setNotice(next.unchanged
        ? 'SSTap 规则库已是最新版本（' + next.ruleCount + ' 条规则）'
        : '规则库更新完成：转换 ' + next.ruleCount + ' 条规则，共 ' + next.totalCidrs.toLocaleString() + ' 条 IP 网段' + (next.skipped.length ? '；跳过 ' + next.skipped.length + ' 个不兼容文件' : ''));
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setRuleLibraryBusy(false);
    }
  }

  async function toggleSstapRule(ruleId: string, enabled: boolean) {
    if (!state) return;
    const current = new Set(state.settings.enabledRuleIds || []);
    if (enabled) current.add(ruleId);
    else current.delete(ruleId);
    await runAction(() => window.sstap.saveSettings({ enabledRuleIds: [...current] }), enabled ? '已启用 SSTap 规则' : '已停用 SSTap 规则');
  }

  async function saveDnsStrategy(dnsStrategy: SstapState['settings']['dnsStrategy']) {
    if (tunRulesLocked || ruleLibraryBusy) {
      setError('系统 TUN 尚未确认完全停止，或 SSTap 规则库正在更新；当前不能修改 DNS 地址族策略。');
      return;
    }
    const messages = { ipv4_only: '已切换为 IPv4-only DNS', prefer_ipv4: '已启用双栈 DNS（IPv4 优先）', prefer_ipv6: '已启用双栈 DNS（IPv6 优先）' };
    await runAction(() => window.sstap.saveSettings({ dnsStrategy }), messages[dnsStrategy]);
  }

  async function openCoreFolder() {
    try {
      const directory = await window.sstap.openCoreFolder();
      setNotice(`已打开 sing-box 内核目录：${directory}`);
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    }
  }

  async function saveCustomRules() {
    const success = await runAction(() => window.sstap.saveSettings({ customRulesText }), '自定义规则已保存');
    if (success && state) setState({ ...state, settings: { ...state.settings, customRulesText } });
  }

  async function recheckCore() {
    setCoreBusy(true);
    try {
      const result = await window.sstap.checkCore();
      setCoreInfo(result);
      if (result.installed) setNotice(`已检测到 ${result.version || 'sing-box'}`);
      else setError(result.error || '未找到 sing-box 核心');
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
    } finally {
      setCoreBusy(false);
    }
  }

  async function toggleConnection() {
    setCoreBusy(true);
    setError('');
    try {
      const next = coreStatus.connected
        ? await window.sstap.disconnectCore()
        : await window.sstap.connectNode(selectedNodeId);
      setCoreStatus(next);
      setNotice(next.connected ? `本地代理已启动：127.0.0.1:${next.proxyPort}` : '本地代理已断开');
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
      window.sstap.getCoreStatus().then(setCoreStatus).catch(() => {});
    } finally {
      setCoreBusy(false);
    }
  }

  async function toggleTunConnection() {
    setTunBusy(true);
    setError('');
    try {
      const next = tunStatus.connected
        ? await window.sstap.disconnectTun()
        : await window.sstap.connectTun(selectedNodeId);
      setTunStatus(next);
      setNotice(next.connected ? `系统 TUN 已启动：${next.mode || state?.settings.mode || 'global'}（节点公网连通性尚未验证）` : '系统 TUN 已断开');
    } catch (reason) {
      setError(String(reason instanceof Error ? reason.message : reason));
      window.sstap.getTunStatus().then(setTunStatus).catch(() => {});
    } finally {
      setTunBusy(false);
    }
  }

  async function cancelSelectedSpeedTest() {
    try { await window.sstap.cancelSpeedTest(); }
    catch (reason) { setError(String(reason instanceof Error ? reason.message : reason)); }
  }

  async function runSelectedSpeedTest() {
    if (!selectedNodeId) return;
    setSpeedTestBusy(true);
    setError('');
    setSpeedProgress({ status: 'starting', ratio: 0, receivedBytes: 0, totalBytes: Number(speedBytes) || 0 });
    try {
      const result = await window.sstap.runSpeedTest(selectedNodeId);
      setState(result.state);
      setLatestSpeedResult(result.result);
      setNotice(`测速完成：${result.result.averageMbps.toFixed(2)} Mbps，HTTP 延迟 ${result.result.latencyMs} ms`);
      setCoreStatus(await window.sstap.getCoreStatus());
    } catch (reason) {
      const message = String(reason instanceof Error ? reason.message : reason);
      if (message.includes('测速已取消')) {
        setNotice('测速已取消');
        setSpeedProgress((current) => ({ ...current, status: 'cancelled', message }));
      } else {
        setError(message);
        setSpeedProgress((current) => ({ ...current, status: 'error', message }));
      }
      window.sstap.getCoreStatus().then(setCoreStatus).catch(() => {});
    } finally {
      setSpeedTestBusy(false);
    }
  }

  if (loading) return <div className="boot-screen"><div className="brand-mark">S</div><div className="boot-title">SSTap Next</div><div className="boot-subtitle">正在读取本地配置…</div></div>;
  if (!state) return <div className="boot-screen"><div className="boot-title">无法读取本地数据</div><p>{error}</p></div>;

  const coreLabel = tunStatus.connected ? `系统 TUN 运行中 · ${tunStatus.mode || 'global'}` : coreStatus.connected ? `本地代理运行中 · ${coreStatus.proxyPort}`
    : coreStatus.status === 'starting' ? '核心正在启动…'
      : coreStatus.status === 'stopping' ? '正在断开…'
        : coreStatus.status === 'error' ? '核心连接失败'
          : (coreInfo.installed ? '核心已安装' : '尚未安装 sing-box');

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">S</div><div><div className="brand-title">SSTap Next</div><div className="brand-sub">WINDOWS TUN CLIENT</div></div></div>
        <div className="side-label">工作台</div>
        <nav>
          {(['home', 'nodes', 'rules', 'speed', 'settings'] as Page[]).map((item) => {
            const labels: Record<Page, string> = { home: '连接中心', nodes: '节点管理', rules: '分流模式', speed: '节点测速', settings: '软件设置' };
            return <button key={item} className={`nav-item ${page === item ? 'active' : ''}`} onClick={() => setPage(item)}><span className="nav-icon">{icons[item]}</span>{labels[item]}</button>;
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-build"><span className="build-dot" />系统接管版</div>
          <div className="sidebar-version">版本 <strong>v{__APP_VERSION__}</strong></div>
          <div className="sidebar-muted">本地代理 + Windows TUN Agent</div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar"><div><div className="eyebrow">SSTAP NEXT / WINDOWS</div><div className="page-title">{{ home: '连接中心', nodes: '节点管理', rules: '分流模式', speed: '节点测速', settings: '软件设置' }[page]}</div></div><div className="topbar-right"><span className={`core-status ${coreStatus.connected ? 'connected' : ''} ${coreStatus.status === 'error' ? 'error' : ''}`}><i />{coreLabel}</span><div className="avatar">SN</div></div></header>

        {notice && <div className="notice"><span>✓</span><div>{notice}</div><button onClick={() => setNotice('')}>×</button></div>}
        {error && <div className="error-banner"><span>!</span><div>{error}</div><button onClick={() => setError('')}>×</button></div>}

        {page === 'home' && <HomePage state={state} traffic={traffic} selectedNode={selectedNode} onPage={setPage} coreStatus={coreStatus} tunStatus={tunStatus} tunBusy={tunBusy} toggleTun={toggleTunConnection} coreInfo={coreInfo} coreBusy={coreBusy} speedTestBusy={speedTestBusy || batchTestBusy} toggleConnection={toggleConnection} runSpeedTest={runSelectedSpeedTest} recheckCore={recheckCore} ruleLibraryBusy={ruleLibraryBusy} />}
        {page === 'nodes' && <NodesPage state={state} importErrors={importErrors} busy={busy || coreBusy || speedTestBusy || batchTestBusy} importText={importText} setImportText={setImportText} pasteFromClipboard={pasteFromClipboard} importClipboard={importClipboard} subscriptionUrl={subscriptionUrl} setSubscriptionUrl={setSubscriptionUrl} subscriptionName={subscriptionName} setSubscriptionName={setSubscriptionName} addSubscription={addSubscription} refreshSubscription={refreshSubscription} deleteSubscription={deleteSubscription} selectedNodeId={selectedNodeId} setSelectedNodeId={setSelectedNodeId} activeNodeId={coreStatus.connected ? coreStatus.nodeId || '' : tunStatus.connected ? tunStatus.nodeId || '' : ''} removeNode={removeNode} batchSelectedNodeIds={batchSelectedNodeIds} toggleBatchNodeSelection={toggleBatchNodeSelection} batchConcurrency={batchConcurrency} setBatchConcurrency={setBatchConcurrency} downloadThreads={threads} setDownloadThreads={setThreads} saveBatchSettings={saveBatchSettings} batchTesting={batchTestBusy} batchProgress={batchTestProgress} startBatchNodeTest={startBatchNodeTest} cancelBatchNodeTest={cancelBatchNodeTest} />}
        {page === 'rules' && <RulesPage mode={state.settings.mode} saveMode={saveMode} busy={busy} customRulesText={customRulesText} setCustomRulesText={setCustomRulesText} saveCustomRules={saveCustomRules} tunConnected={tunStatus.connected || false} tunLocked={tunRulesLocked || ruleLibraryBusy} ruleLibrary={ruleLibrary} ruleLibraryBusy={ruleLibraryBusy} ruleSearch={ruleSearch} setRuleSearch={setRuleSearch} updateRuleLibrary={updateRuleLibrary} enabledRuleIds={state.settings.enabledRuleIds || []} toggleSstapRule={toggleSstapRule} />}
        {page === 'speed' && <SpeedPage speedUrl={speedUrl} setSpeedUrl={setSpeedUrl} speedBytes={speedBytes} setSpeedBytes={setSpeedBytes} threads={threads} setThreads={setThreads} save={saveSpeedSettings} busy={busy || batchTestBusy} selectedNode={selectedNode} runTest={runSelectedSpeedTest} testing={speedTestBusy} progress={speedProgress} latestResult={latestSpeedResult || state.speedResults?.[0] || null} history={state.speedResults || []} cancelTest={cancelSelectedSpeedTest} />}
        {page === 'settings' && <SettingsPage state={state} coreInfo={coreInfo} tunLocked={tunRulesLocked || ruleLibraryBusy} saveDnsStrategy={saveDnsStrategy} openCoreFolder={openCoreFolder} />}
      </main>
    </div>
  );
}

function HomePage(props: {
  state: SstapState;
  traffic: SstapTrafficSample | null;
  selectedNode: SstapNode | null;
  onPage: (page: Page) => void;
  coreStatus: SstapCoreStatus;
  tunStatus: SstapTunStatus;
  tunBusy: boolean;
  toggleTun: () => void;
  coreInfo: SstapCoreInfo;
  coreBusy: boolean;
  speedTestBusy: boolean;
  toggleConnection: () => void;
  runSpeedTest: () => void;
  recheckCore: () => void;
  ruleLibraryBusy: boolean;
}) {
  const connected = props.coreStatus.connected;
  const tunConnected = Boolean(props.tunStatus.connected);
  const activeNode = connected
    ? props.state.nodes.find((node) => node.id === props.coreStatus.nodeId) || null
    : tunConnected
      ? props.state.nodes.find((node) => node.id === props.tunStatus.nodeId) || null
      : null;
  const shownNode = activeNode || props.selectedNode;
  const activeNodeId = connected ? props.coreStatus.nodeId : tunConnected ? props.tunStatus.nodeId : undefined;
  const activeSessionId = connected ? props.coreStatus.sessionId : tunConnected ? props.tunStatus.sessionId : null;
  const trafficSample = props.traffic && (!activeSessionId || props.traffic.sessionId === activeSessionId) ? props.traffic : null;
  const trafficIsLive = Boolean(trafficSample?.active && trafficSample.status === 'ok');
  const trafficRateUnavailable = Boolean(trafficSample?.active && trafficSample.status === 'unavailable');
  const trafficCaption = connected ? '本地代理 · 当前节点' : tunConnected ? '系统 TUN · 本次流量含直连' : trafficSample ? '最近一次会话' : '连接成功后开始统计';
  const trafficMessage = !trafficSample
    ? (connected || tunConnected ? '等待首次统计数据…' : '连接成功后开始统计实时速度')
    : trafficRateUnavailable ? '统计暂不可用，已保留累计数据，正在重试'
      : trafficSample.active ? '正在实时统计本次会话流量' : '会话已结束，显示最终累计';
  const trafficDuration = trafficSample ? formatSessionDuration(trafficSample.startedAt, trafficSample.sampledAt, trafficSample.active) : '—';
  const selectedDiffersFromActive = Boolean(activeNodeId && props.selectedNode && props.selectedNode.id !== activeNodeId);
  const actionLabel = connected ? '断开本地代理' : props.coreStatus.status === 'starting' ? '正在启动…' : '连接本地代理';
  const tunActionLabel = tunConnected ? '断开系统 TUN' : props.tunBusy || props.tunStatus.status === 'awaiting_uac' || props.tunStatus.status === 'starting' ? '正在启动系统接管…' : '启动系统级接管';
  const tunBlockedByCleanup = props.tunStatus.status === 'cleanup_error';
  const tunBlockedByMissingCore = !props.coreInfo.installed && !tunConnected;
  const tunButtonDisabled = props.tunBusy || props.coreBusy || props.speedTestBusy || props.ruleLibraryBusy || (!props.selectedNode && !tunConnected)
    || tunBlockedByCleanup || tunBlockedByMissingCore
    || ['starting', 'stopping', 'awaiting_uac'].includes(props.tunStatus.status || '') || (connected && !tunConnected);
  const tunButtonTitle = tunBlockedByCleanup
    ? '上一次 TUN 会话清理异常；为保护系统网络，暂时禁止再次接管。请查看错误和 Agent 日志。'
    : props.ruleLibraryBusy ? 'SSTap 规则库正在下载和转换；完成后再启动系统 TUN。'
      : tunBlockedByMissingCore ? '未找到 sing-box 核心，请先安装或修复核心。'
        : tunButtonDisabled
          ? (!props.selectedNode && !tunConnected ? '请先导入并选择一个节点' : connected && !tunConnected ? '请先断开本地代理，再启动系统接管' : '当前有操作正在进行，请稍后重试')
        : tunConnected ? '断开系统 TUN 接管' : '启动 Windows 系统级流量接管';
  return <div className="content-grid">
    <section className="hero-card">
      <div className="hero-top"><div><div className="hero-kicker">SING-BOX CORE / WINDOWS TUN</div><h1>让节点接管，<br /><span>整个系统的流量。</span></h1><p>系统级接管通过 sing-box TUN + Wintun 完成；启动时会请求 UAC，退出前主动清理，并由 Agent 心跳看门狗防止桌面端崩溃后留下隧道。</p></div><div className="hero-orbit"><div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/><div className="orbit-core">S</div></div></div>
      <div className="connect-panel"><div><div className="muted-label">{connected ? '当前已连接节点' : '当前选择节点'}</div><div className="selected-node">{shownNode ? shownNode.name : (props.coreStatus.nodeName || '尚未选择节点')}</div><div className="node-subline">{shownNode ? `${shownNode.type.toUpperCase()} · ${shownNode.server}:${shownNode.server_port}` : '请先导入或选择一个节点'}</div>{selectedDiffersFromActive && <div className="next-node-hint">下一次连接目标：{props.selectedNode!.name}</div>}{tunConnected && <div className="local-proxy-address">系统 TUN 已启动：{props.tunStatus.mode || 'global'} · {props.tunStatus.interfaceName || 'SSTap Next'} · 节点公网连通性尚未验证</div>}{connected && <div className="local-proxy-address">SOCKS5 / HTTP：127.0.0.1:{props.coreStatus.proxyPort}</div>}</div><div className="connect-actions"><button className={`connect-button ${tunConnected ? 'connected' : 'ready'}`} disabled={tunButtonDisabled} title={tunButtonTitle} onClick={props.toggleTun}>{tunActionLabel} <span>{tunConnected ? '×' : '↗'}</span></button><button className={`button ${connected ? 'button-primary' : 'button-quiet'}`} disabled={props.coreBusy || props.tunBusy || props.speedTestBusy || (!props.selectedNode && !connected) || ['starting', 'stopping'].includes(props.coreStatus.status) || tunConnected} onClick={props.toggleConnection}>{actionLabel}</button><button className="button button-quiet" disabled={!props.selectedNode || props.coreBusy || props.tunBusy || props.speedTestBusy || !props.coreInfo.installed || (connected && props.coreStatus.nodeId !== props.selectedNode.id) || tunConnected} title={tunConnected ? '系统 TUN 已接管流量，无需另行测试本地代理' : undefined} onClick={props.runSpeedTest}>{props.speedTestBusy ? '测速中…' : '测试节点'}</button></div></div>{tunButtonDisabled && !tunConnected && <div className="connect-disabled-reason">{tunBlockedByCleanup ? '检测到上次 TUN 清理异常，已保护性锁定系统接管。请先处理错误状态。' : tunBlockedByMissingCore ? '尚未找到 sing-box 核心，请在软件设置中检查内核目录。' : !props.selectedNode ? '先导入并选择一个节点，系统接管按钮即可启动。' : connected ? '请先断开本地代理，再启动系统级接管。' : '当前操作尚未结束，请稍候再试。'}</div>}
      <div className="hero-foot"><span className={`status-pulse ${connected ? 'running' : ''}`}/>{connected ? `本机代理已监听 127.0.0.1:${props.coreStatus.proxyPort}；不会自动接管其他程序` : props.coreInfo.installed ? `核心已就绪：${props.coreInfo.version || 'sing-box'}` : '未找到 sing-box.exe；请先运行 scripts\\Fetch-SingBox.ps1'}</div>
      {props.coreStatus.status === 'error' && props.coreStatus.lastError && <div className="core-error-text">{props.coreStatus.lastError}</div>}{props.tunStatus.lastError && <div className="core-error-text">系统 TUN：{props.tunStatus.lastError}</div>}{props.tunStatus.logPath && <div className="helper-text">Agent 日志：{props.tunStatus.logPath}</div>}{!props.coreInfo.installed && <button className="button button-quiet core-recheck-button" disabled={props.coreBusy} onClick={props.recheckCore}>{props.coreBusy ? '正在检查…' : '重新检查 sing-box 核心'}</button>}{(props.coreStatus.logs?.length || 0) > 0 && <details className="core-log-details"><summary>查看核心日志（最近 {Math.min(props.coreStatus.logs?.length || 0, 12)} 行）</summary><pre>{props.coreStatus.logs?.slice(-12).join('\n')}</pre></details>}
    </section>
    <section className="traffic-card">
      <div className="traffic-card-heading">
        <div><div className="panel-title">本次流量</div><div className="panel-desc">{trafficCaption}</div></div>
        <span className={`traffic-live-state ${trafficIsLive ? 'live' : trafficRateUnavailable ? 'unavailable' : ''}`}><i />{trafficIsLive ? '实时统计' : trafficRateUnavailable ? '统计暂不可用' : trafficSample?.active ? '正在连接' : trafficSample ? '已结束' : '等待连接'}</span>
      </div>
      <div className="traffic-rate-grid">
        <div className="traffic-value-card"><span className="traffic-value-label"><i className="traffic-arrow download">↓</i>下载速度</span><b>{trafficIsLive ? formatTrafficRate(trafficSample!.downloadBps) : trafficRateUnavailable ? "暂不可用" : "—"}</b></div>
        <div className="traffic-value-card"><span className="traffic-value-label"><i className="traffic-arrow upload">↑</i>上传速度</span><b>{trafficIsLive ? formatTrafficRate(trafficSample!.uploadBps) : trafficRateUnavailable ? "暂不可用" : "—"}</b></div>
      </div>
      <div className="traffic-total-grid">
        <div><span>本次下载累计</span><b>{trafficSample ? formatTrafficBytes(trafficSample.downloadBytes) : "—"}</b></div>
        <div><span>本次上传累计</span><b>{trafficSample ? formatTrafficBytes(trafficSample.uploadBytes) : "—"}</b></div>
        <div><span>会话时长</span><b>{trafficDuration}</b></div>
      </div>
      <div className="traffic-card-foot">{trafficMessage}{trafficSample?.mode === "tun" ? " · TUN 总量包含直连流量" : trafficSample?.mode === "proxy" ? " · 本地代理节点流量" : ""}</div>
    </section>
    <section className="stats-grid">
      <div className="stat-card"><div className="stat-label">节点总数</div><div className="stat-number">{props.state.nodes.length}</div><div className="stat-foot">包含手动导入与订阅节点</div></div>
      <div className="stat-card"><div className="stat-label">订阅数量</div><div className="stat-number">{props.state.subscriptions.length}</div><div className="stat-foot">支持手动更新，失败保留旧节点</div></div>
      <div className="stat-card"><div className="stat-label">最近测速</div><div className="stat-number small">{props.state.speedResults?.[0] ? `${props.state.speedResults[0].averageMbps.toFixed(1)} Mbps` : '—'}</div><div className="stat-foot">{props.state.speedResults?.[0] ? `${props.state.speedResults[0].nodeName} · ${props.state.speedResults[0].latencyMs} ms` : '尚无测速记录'}</div></div>
    </section>
    <section className="panel-card quick-card"><div className="panel-heading"><div><div className="panel-title">快速操作</div><div className="panel-desc">本地代理、节点测速与 Windows TUN 控制链路已接入；首次使用必须先完成下方 Windows 验收清单。</div></div></div><div className="quick-actions"><button onClick={() => props.onPage('nodes')}><b>＋</b><span>导入节点</span><small>支持多条链接粘贴</small></button><button onClick={() => props.onPage('nodes')}><b>↻</b><span>管理订阅</span><small>更新并管理节点来源</small></button><button onClick={() => props.onPage('speed')}><b>⇧</b><span>节点测速</span><small>真实经节点下载测试</small></button></div></section>
    <section className="panel-card roadmap-card"><div className="panel-heading"><div><div className="panel-title">开发验证状态</div><div className="panel-desc">区分已经运行的功能与尚未在 Windows 实机验证的网络功能。</div></div><span className="pill pill-blue">TUN 清理恢复已加固</span></div><div className="roadmap"><div className="roadmap-row done"><span className="roadmap-check">✓</span><div><b>节点解析、订阅和加密存储</b><small>VLESS / Hysteria2 / SS / VMess / Trojan</small></div><em>已完成</em></div><div className="roadmap-row done"><span className="roadmap-check">✓</span><div><b>sing-box 本地代理与节点测速</b><small>多测速源回退、HTTP Range 单/多线程下载</small></div><em>已接入</em></div><div className="roadmap-row active"><span className="roadmap-check">3</span><div><b>Windows TUN / Wintun 系统接管</b><small>双栈 DNS 可选、管理员 Agent、路由和异常恢复</small></div><em>待实机验证</em></div></div></section>
  </div>;
}

function formatNodeMetric(metric: SstapNodeTestMetric | undefined, kind: 'ping' | 'tcping' | 'proxy' | 'download'): string {
  if (!metric) return '—';
  if (metric.status === 'testing') return '检测中…';
  if (metric.status === 'not-applicable') return '不适用';
  if (metric.status === 'timeout') return '超时';
  if (metric.status === 'error') return '失败';
  if (kind === 'download') return Number.isFinite(metric.averageMbps) ? Number(metric.averageMbps).toFixed(1) + ' Mbps' : '—';
  const value = kind === 'proxy' ? metric.latencyMs : metric.averageMs;
  if (!Number.isFinite(value)) return '—';
  const loss = kind === 'ping' && Number.isFinite(metric.lossPercent) && (metric.lossPercent || 0) > 0
    ? ' · 丢包 ' + metric.lossPercent + '%'
    : '';
  return Math.round(Number(value)) + ' ms' + loss;
}

function NodesPage(props: {
  state: SstapState; importErrors: Array<{ line: number; message: string }>; busy: boolean; importText: string; setImportText: (v: string) => void; pasteFromClipboard: () => void; importClipboard: () => void;
  subscriptionUrl: string; setSubscriptionUrl: (v: string) => void; subscriptionName: string; setSubscriptionName: (v: string) => void; addSubscription: () => void; refreshSubscription: (id: string) => void; deleteSubscription: (id: string, name: string) => void;
  selectedNodeId: string; setSelectedNodeId: (v: string) => void; activeNodeId: string; removeNode: (id: string) => void;
  batchSelectedNodeIds: string[]; toggleBatchNodeSelection: (id: string, selected: boolean) => void;
  batchConcurrency: string; setBatchConcurrency: (value: string) => void;
  downloadThreads: string; setDownloadThreads: (value: string) => void; saveBatchSettings: () => void;
  batchTesting: boolean; batchProgress: SstapBatchTestProgress;
  startBatchNodeTest: (scope: 'all' | 'selected') => void; cancelBatchNodeTest: () => void;
}) {
  const allSelected = props.state.nodes.length > 0 && props.state.nodes.every((node) => props.batchSelectedNodeIds.includes(node.id));
  return <div className="page-stack">
    <div className="page-intro"><div><h2>节点管理</h2><p>把浏览器或订阅软件里的分享链接复制过来即可，不需要手动编辑配置文件。</p></div><span className="pill pill-green">已支持 5 类链接</span></div>
    <div className="two-column">
      <section className="panel-card import-card"><div className="panel-heading"><div><div className="panel-title">批量粘贴导入</div><div className="panel-desc">每行一条，支持直接 Ctrl+V 粘贴多节点。</div></div><span className="shortcut">CTRL + V</span></div><textarea className="import-textarea" placeholder={'vless://...\nhy2://...\nss://...\nvmess://...\ntrojan://...'} value={props.importText} onChange={(event) => props.setImportText(event.target.value)} /><div className="form-row between"><button className="button button-quiet" onClick={props.pasteFromClipboard}>从系统剪贴板读取</button><button className="button button-primary" disabled={props.busy || !props.importText.trim()} onClick={props.importClipboard}>{props.busy ? '处理中…' : '解析并导入'}</button></div><div className="supported-tags"><span>VLESS</span><span>Hysteria2</span><span>Shadowsocks</span><span>VMess</span><span>Trojan</span><i>支持 Base64 节点列表</i></div></section>
      <section className="panel-card subscription-card"><div className="panel-heading"><div><div className="panel-title">添加订阅</div><div className="panel-desc">订阅更新失败时保留上次成功导入的节点。</div></div><div className="subscription-symbol">↻</div></div><label>订阅名称（可选）</label><input className="text-input" placeholder="例如：机场 A / 自建节点" value={props.subscriptionName} onChange={(event) => props.setSubscriptionName(event.target.value)} /><label>订阅 URL</label><input className="text-input" placeholder="https://example.com/subscription" value={props.subscriptionUrl} onChange={(event) => props.setSubscriptionUrl(event.target.value)} /><button className="button button-primary full-width" disabled={props.busy || !props.subscriptionUrl.trim()} onClick={props.addSubscription}>{props.busy ? '正在获取…' : '获取订阅并导入'}</button><div className="security-note">订阅内容限制 4 MB，单次请求超时 20 秒；节点凭据通过 Windows 安全存储加密保存。</div></section>
    </div>
    {props.importErrors.length > 0 && <section className="panel-card parse-errors"><div className="panel-title">未能识别的内容（{props.importErrors.length} 条）</div>{props.importErrors.map((item, index) => <div className="parse-error-row" key={`${item.line}-${index}`}><b>第 {item.line} 行</b><span>{item.message}</span></div>)}</section>}
    <section className="panel-card">
      <div className="panel-heading">
        <div><div className="panel-title">我的节点 <span className="count-badge">{props.state.nodes.length}</span></div><div className="panel-desc">批量检测结果直接显示在这里；勾选节点可单独检测。</div></div>
        <button className="button button-quiet" disabled={props.busy || props.state.nodes.length === 0} onClick={() => props.state.nodes.forEach((node) => props.toggleBatchNodeSelection(node.id, !allSelected))}>{allSelected ? '全不选' : '全选节点'}</button>
      </div>
      <div className="batch-toolbar">
        <div className="batch-setting"><label>同时测速节点数</label><select className="text-input" value={props.batchConcurrency} disabled={props.busy} onChange={(event) => props.setBatchConcurrency(event.target.value)}>{['1','2','4','8','16','32'].map((value) => <option key={value} value={value}>{value} 个节点</option>)}</select></div>
        <div className="batch-setting"><label>每节点下载线程</label><select className="text-input" value={props.downloadThreads} disabled={props.busy} onChange={(event) => props.setDownloadThreads(event.target.value)}>{['1','2','4','8','16','32'].map((value) => <option key={value} value={value}>{value} 线程</option>)}</select></div>
        <button className="button button-quiet" disabled={props.busy} onClick={props.saveBatchSettings}>保存参数</button>
        <div className="batch-actions">
          <button className="button button-primary" disabled={props.busy || props.state.nodes.length === 0} onClick={() => props.startBatchNodeTest('all')}>一键全部测速</button>
          <button className="button button-quiet" disabled={props.busy || props.batchSelectedNodeIds.length === 0} onClick={() => props.startBatchNodeTest('selected')}>测速选中（{props.batchSelectedNodeIds.length}）</button>
          {props.batchTesting && <button className="button button-quiet danger-text" onClick={props.cancelBatchNodeTest}>取消检测</button>}
        </div>
      </div>
      <div className="batch-explain">本次下载量：{formatBytes(props.state.settings.speedTestBytes)}；测速地址和下载量沿用“节点测速”页设置。PING = ICMP；TCPING = TCP 端口连接；代理延迟和下载速度通过节点自身代理链路测试。Hysteria2 不适用 TCPING。系统代理不会被修改。</div>
      {props.batchTesting && <div className="batch-progress-card">
        <div className="batch-progress-top"><b>正在批量检测</b><span>{props.batchProgress.completed || 0} / {props.batchProgress.total || props.state.nodes.length} 完成 · {props.batchProgress.failed || 0} 个失败/部分结果</span></div>
        <div className="speed-progress-track"><div className="speed-progress-value" style={{ width: ((props.batchProgress.total || 0) > 0 ? Math.min(100, ((props.batchProgress.completed || 0) / (props.batchProgress.total || 1)) * 100) : 0) + '%' }} /></div>
        <small>同时运行 {props.batchProgress.active || 0} 个节点 · 有效并发 {props.batchProgress.effectiveConcurrency || props.batchProgress.concurrency || 0} · 每节点 {props.batchProgress.effectiveDownloadThreads || 1} 个 Range 线程（总预算 64）</small>
        {props.batchProgress.nodeName && <small>当前节点：{props.batchProgress.nodeName} · {props.batchProgress.metric || '准备中'}</small>}
        {props.batchProgress.downloadProgress && <small>当前节点下载：{Math.round(props.batchProgress.downloadProgress.ratio * 100)}% · {formatBytes(props.batchProgress.downloadProgress.receivedBytes)} / {formatBytes(props.batchProgress.downloadProgress.totalBytes)}</small>}
      </div>}
      {props.state.nodes.length === 0 ? <div className="empty-state"><div className="empty-icon">◈</div><b>还没有节点</b><p>粘贴分享链接，或添加一条订阅开始使用。</p></div> : <div className="node-list batch-node-list">
        <div className="batch-node-head"><span></span><span></span><span>节点</span><span>PING</span><span>TCPING</span><span>代理延迟</span><span>下载</span><span>最近检测</span><span></span><span></span></div>
        {props.state.nodes.map((node) => {
          const result = props.state.nodeTestResults?.[node.id];
          return <div key={node.id} className={`node-row batch-node-row ${props.selectedNodeId === node.id ? 'selected' : ''} ${props.activeNodeId === node.id ? 'connected-node' : ''}`} onClick={() => props.setSelectedNodeId(node.id)}>
            <input className="batch-node-checkbox" type="checkbox" checked={props.batchSelectedNodeIds.includes(node.id)} disabled={props.busy} onClick={(event) => event.stopPropagation()} onChange={(event) => props.toggleBatchNodeSelection(node.id, event.target.checked)} />
            <div className="node-type-icon">{node.type === 'vless' ? 'V' : node.type === 'hysteria2' ? 'H' : node.type === 'shadowsocks' ? 'S' : node.type === 'vmess' ? 'M' : 'T'}</div>
            <div className="node-info"><b>{node.name}</b><span>{node.type.toUpperCase()} · {node.server}:{node.server_port}</span>{props.activeNodeId === node.id && <span className="node-active-tag">正在连接</span>}</div>
            <div className="node-test-value"><small>PING</small><b>{formatNodeMetric(result?.ping, 'ping')}</b></div>
            <div className="node-test-value"><small>TCPING</small><b>{formatNodeMetric(result?.tcping, 'tcping')}</b></div>
            <div className="node-test-value"><small>代理延迟</small><b>{formatNodeMetric(result?.proxyLatency, 'proxy')}</b></div>
            <div className="node-test-value"><small>下载速度</small><b>{formatNodeMetric(result?.download, 'download')}</b></div>
            <div className="node-test-value node-test-time"><small>最近检测</small><b>{result?.testedAt ? new Date(result.testedAt).toLocaleString() : '—'}</b></div>
            <div className="node-source">{node.sources?.some((source) => source.startsWith('subscription:')) ? (node.sources.includes('clipboard') ? '订阅 + 手动' : '订阅') : '手动'}</div>
            <button className="icon-button danger" title="删除节点" disabled={props.busy} onClick={(event) => { event.stopPropagation(); props.removeNode(node.id); }}>×</button>
          </div>;
        })}
      </div>}
    </section>
    <section className="panel-card"><div className="panel-heading"><div><div className="panel-title">订阅管理 <span className="count-badge">{props.state.subscriptions.length}</span></div><div className="panel-desc">手动更新订阅；只有解析成功后才会合并新节点。</div></div></div>{props.state.subscriptions.length === 0 ? <div className="sub-empty">尚未添加订阅地址。</div> : <div className="subscription-list">{props.state.subscriptions.map((sub) => <div className="subscription-row" key={sub.id}><div className="sub-icon">↻</div><div className="sub-info"><b>{sub.name}</b><span>{sub.url}</span><small>{sub.nodeCount} 个节点 · 最近更新 {new Date(sub.updatedAt).toLocaleString()}</small>{sub.lastError && <small className="sub-error">上次更新失败：{sub.lastError}</small>}</div><div className="subscription-actions"><button className="button button-quiet" disabled={props.busy} onClick={() => props.refreshSubscription(sub.id)}>更新</button><button className="button button-quiet danger-text" disabled={props.busy} onClick={() => props.deleteSubscription(sub.id, sub.name)}>删除</button></div></div>)}</div>}</section>
  </div>;
}

function RulesPage({ mode, saveMode, busy, customRulesText, setCustomRulesText, saveCustomRules, tunConnected, tunLocked, ruleLibrary, ruleLibraryBusy, ruleSearch, setRuleSearch, updateRuleLibrary, enabledRuleIds, toggleSstapRule }: {
  mode: SstapState['settings']['mode'];
  saveMode: (mode: SstapState['settings']['mode']) => void;
  busy: boolean;
  customRulesText: string;
  setCustomRulesText: (value: string) => void;
  saveCustomRules: () => void;
  tunConnected: boolean;
  tunLocked: boolean;
  ruleLibrary: SstapRuleLibrary;
  ruleLibraryBusy: boolean;
  ruleSearch: string;
  setRuleSearch: (value: string) => void;
  updateRuleLibrary: () => void;
  enabledRuleIds: string[];
  toggleSstapRule: (id: string, enabled: boolean) => void;
}) {
  const options: Array<{ id: SstapState['settings']['mode']; title: string; desc: string; icon: string }> = [
    { id: 'global', title: '全局代理', desc: '所有公网 IPv4 / IPv6 TCP、UDP 默认通过代理；私有局域网网段直连。', icon: '◎' },
    { id: 'bypass-cn', title: '绕过中国大陆', desc: '使用 GeoSite / GeoIP 中国规则集直连；未命中流量通过代理。', icon: '⌖' },
    { id: 'rule', title: '自定义规则', desc: '按域名、IP 网段、进程、目标端口或 TCP/UDP 协议分流；未匹配规则默认代理。', icon: '⌘' },
  ];
  const enabled = new Set(enabledRuleIds);
  const filteredRules = ruleLibrary.rules.filter((rule) => (rule.fileName + ' ' + rule.displayName + ' ' + rule.author).toLowerCase().includes(ruleSearch.trim().toLowerCase()));
  const autoChinaRule = ruleLibrary.rules.find((rule) => rule.fileName.toLowerCase() === 'bypasscnandlan.rules');
  return <div className="page-stack">
    <div className="page-intro"><div><h2>分流模式</h2><p>基础流量策略与可叠加的规则库独立配置；所选规则会在下一次启动系统 TUN 时生效。</p></div><span className={'pill ' + (tunConnected ? 'pill-green' : 'pill-blue')}>{tunConnected ? '当前 TUN 正在使用此策略' : tunLocked ? 'TUN 清理未确认：分流设置已锁定' : '下次连接生效'}</span></div>
    <div className="mode-list">{options.map((option) => <button key={option.id} className={'mode-card ' + (mode === option.id ? 'chosen' : '')} onClick={() => saveMode(option.id)} disabled={busy || tunLocked || ruleLibraryBusy}><span className="mode-icon">{option.icon}</span><span className="mode-copy"><b>{option.title}</b><small>{option.desc}</small></span><span className="radio-indicator">{mode === option.id ? '✓' : ''}</span></button>)}</div>
    {mode === 'rule' && <section className="panel-card"><div className="panel-heading"><div><div className="panel-title">自定义规则</div><div className="panel-desc">每行一条，格式与常见代理规则相似；自上而下匹配。</div></div></div><textarea className="import-textarea" value={customRulesText} onChange={(event) => setCustomRulesText(event.target.value)} placeholder={'DOMAIN-SUFFIX,example.com,proxy\nDOMAIN,internal.example,direct\nIP-CIDR,10.0.0.0/8,direct,no-resolve\nPROCESS-NAME,game.exe,proxy\nDST-PORT,5000-6000,proxy\nNETWORK,udp,proxy'} disabled={tunLocked || ruleLibraryBusy} /><div className="helper-text">支持 DOMAIN、DOMAIN-SUFFIX、DOMAIN-KEYWORD、IP-CIDR、IP-CIDR6、PROCESS-NAME、PROCESS-PATH、DST-PORT、NETWORK。目标：proxy / direct / block。</div><button className="button button-primary" onClick={saveCustomRules} disabled={busy || tunLocked || ruleLibraryBusy}>保存并校验规则</button></section>}
    <section className="panel-card sstap-rule-library">
      <div className="panel-heading"><div><div className="panel-title">SSTap 经典游戏规则库</div><div className="panel-desc">兼容 FQrabbit/SSTap-Rule 原始 .rules 文件；下载后自动解析头部动作、去重并转换为 sing-box 本地 JSON 规则集。</div></div><button className="button button-primary" onClick={updateRuleLibrary} disabled={ruleLibraryBusy || tunLocked}>{ruleLibraryBusy ? '正在下载并转换…' : ruleLibrary.installed ? '检查并更新规则库' : '下载并安装规则库'}</button></div>
      <div className="rule-library-meta">
        <span className={ruleLibrary.installed ? 'pill pill-green' : 'pill pill-blue'}>{ruleLibrary.installed ? '规则库已安装' : '尚未安装'}</span>
        <span>{ruleLibrary.ruleCount} 条规则</span><span>{ruleLibrary.totalCidrs.toLocaleString()} 个 IP 网段</span>
        {ruleLibrary.revision && <span>版本 {ruleLibrary.revision.slice(0, 12)}</span>}
        {ruleLibrary.updatedAt && <span>更新于 {new Date(ruleLibrary.updatedAt).toLocaleString()}</span>}
        {ruleLibrary.skipped.length > 0 && <span className="rule-skipped">{ruleLibrary.skipped.length} 个文件未兼容</span>}
      </div>
      <div className="helper-text">规则数据与软件版本分开存储。今后点击更新即可重新下载并转换，不需要重新安装或编译 SSTap Next。规则库来源：Apache-2.0 · FQrabbit/SSTap-Rule。</div>
      {mode === 'bypass-cn' && <div className="rule-auto-note"><b>中国大陆规则：</b>{autoChinaRule ? autoChinaRule.displayName + '（' + autoChinaRule.cidrCount.toLocaleString() + ' 个网段）自动加载' : '当前使用内置 GeoSite / GeoIP 远程规则'}；其他 GEO 规则仍保留。</div>}
      {ruleLibrary.installed && <>
        <input className="text-input rule-search" value={ruleSearch} onChange={(event) => setRuleSearch(event.target.value)} placeholder="搜索游戏名称、规则文件或作者…" disabled={tunLocked} />
        <div className="sstap-rule-list">
          {filteredRules.length === 0 && <div className="sub-empty">没有匹配的规则。</div>}
          {filteredRules.map((rule) => {
            const automatic = mode === 'bypass-cn' && rule.id === autoChinaRule?.id;
            const checked = automatic || enabled.has(rule.id);
            return <label className="sstap-rule-row" key={rule.id}>
              <input type="checkbox" checked={checked} disabled={busy || tunLocked || automatic || ruleLibraryBusy} onChange={(event) => toggleSstapRule(rule.id, event.target.checked)} />
              <span className="sstap-rule-name"><b>{rule.displayName}</b><small>{rule.fileName}{rule.author ? ' · ' + rule.author : ''}</small></span>
              <span className={'sstap-rule-action ' + (rule.routeAction === 'proxy' ? 'route-proxy' : 'route-direct')}>{rule.routeAction === 'proxy' ? '代理' : '直连'}</span>
              <span className="sstap-rule-count">{rule.cidrCount.toLocaleString()} IP{rule.ipv6Count ? ' · IPv6 ' + rule.ipv6Count : ''}</span>
              {automatic && <span className="sstap-rule-auto">大陆模式自动</span>}
            </label>;
          })}
        </div>
        <div className="helper-text">原版 SSTap 规则头部的 0=代理、1=直连会被保留。选中的游戏规则排在中国 GEO 规则之前，因此可以覆盖较宽泛的中国大陆直连规则。</div>
      </>}
    </section>
    <div className="warning-card"><b>系统接管说明</b><p>Windows TUN 会接管系统 IPv4/IPv6 路由，并启用 DNS 劫持。启动需要 UAC 管理员权限。系统 Agent 通过心跳监控桌面端，退出或崩溃后会尝试停止 sing-box；若状态显示清理异常，请勿再次连接，先核查日志和网卡。</p></div>
  </div>;
}

function SpeedPage(props: {
  speedUrl: string;
  setSpeedUrl: (v: string) => void;
  speedBytes: string;
  setSpeedBytes: (v: string) => void;
  threads: string;
  setThreads: (v: string) => void;
  save: () => void;
  busy: boolean;
  selectedNode: SstapNode | null;
  runTest: () => void;
  testing: boolean;
  progress: SstapSpeedProgress;
  latestResult: SstapSpeedResult | null;
  history: SstapSpeedResult[];
  cancelTest: () => void;
}) {
  const ratio = Math.max(0, Math.min(1, props.progress.ratio || 0));
  return <div className="page-stack"><div className="page-intro"><div><h2>节点测速</h2><p>通过所选节点的本地 SOCKS5 代理下载，不会绕过节点直接测速；结果按节点保存。</p></div><span className="pill pill-green">真实下载已接入</span></div><div className="two-column"><section className="panel-card"><div className="panel-heading"><div><div className="panel-title">测速参数</div><div className="panel-desc">所有节点使用相同的测速源、下载量和线程数。</div></div></div><label>测速文件 URL</label><input className="text-input" value={props.speedUrl} onChange={(event) => props.setSpeedUrl(event.target.value)} placeholder="https://example.com/1GB.bin" /><div className="helper-text">默认 Hetzner 1 GB 测试文件；主测速源被拒绝或不可用时，会自动尝试其他官方镜像。自定义地址建议支持 HTTP Range。</div><label>目标下载量</label><div className="preset-row"><button className={props.speedBytes === '10000000' ? 'preset active' : 'preset'} onClick={() => props.setSpeedBytes('10000000')}>10 MB</button><button className={props.speedBytes === '100000000' ? 'preset active' : 'preset'} onClick={() => props.setSpeedBytes('100000000')}>100 MB</button><button className={props.speedBytes === '500000000' ? 'preset active' : 'preset'} onClick={() => props.setSpeedBytes('500000000')}>500 MB</button></div><input className="text-input" type="number" min="1000000" max="1000000000" value={props.speedBytes} onChange={(event) => props.setSpeedBytes(event.target.value)} /><div className="helper-text">范围 1 MB 至 1 GB；测速流式读取，文件不会写入磁盘。</div><label>并发线程</label><select className="text-input" value={props.threads} onChange={(event) => props.setThreads(event.target.value)}><option value="1">单线程（推荐，观察单连接表现）</option><option value="2">2 线程</option><option value="4">4 线程</option><option value="8">8 线程</option><option value="16">16 线程</option><option value="32">32 线程</option></select><div className="form-row speed-action-row"><button className="button button-quiet" disabled={props.busy} onClick={props.save}>保存测速设置</button><button className="button button-primary" disabled={props.busy || props.testing || !props.selectedNode} onClick={props.runTest}>{props.testing ? '正在测速…' : '测试当前节点'}</button>{props.testing && <button className="button button-quiet danger-text" onClick={props.cancelTest}>取消测速</button>}</div><div className="security-note">测试期间如未连接该节点，软件会临时启动核心，完成后自动停止；若已连接同一节点则复用当前连接。</div></section><section className="panel-card speed-info"><div className="panel-heading"><div><div className="panel-title">测速结果</div><div className="panel-desc">{props.selectedNode ? `当前选择：${props.selectedNode.name}` : '请先选择一个节点'}</div></div></div>{props.testing && <div className="speed-progress-wrap"><div className="speed-progress-label"><span>{formatBytes(props.progress.receivedBytes || 0)} / {formatBytes(props.progress.totalBytes || Number(props.speedBytes) || 0)}</span><b>{Math.round(ratio * 100)}%</b></div><div className="speed-progress-track"><div className="speed-progress-value" style={{ width: `${ratio * 100}%` }} /></div><small>{props.progress.completedWorkers || 0} / {props.progress.threads || Number(props.threads) || 1} 个下载线程完成</small>{props.progress.message && <small className="speed-fallback-message">{props.progress.message}</small>}</div>}{props.latestResult ? <><div className="speed-result-hero"><div><span>平均下载速度</span><b>{props.latestResult.averageMbps.toFixed(2)} <small>Mbps</small></b></div><div className="speed-result-badge">{props.latestResult.threads} 线程</div></div><div className="metric-list"><div><span>峰值采样速度</span><b>{props.latestResult.peakMbps.toFixed(2)} Mbps</b></div><div><span>HTTP 响应延迟</span><b>{props.latestResult.latencyMs} ms</b></div><div><span>实际下载量</span><b>{formatBytes(props.latestResult.bytes)}</b></div><div><span>下载耗时</span><b>{(props.latestResult.elapsedMs / 1000).toFixed(2)} 秒</b></div><div><span>测速节点</span><b>{props.latestResult.nodeName}</b></div><div><span>测试源</span><b>{new URL(props.latestResult.url).hostname}</b></div><div><span>测试时间</span><b>{new Date(props.latestResult.testedAt).toLocaleString()}</b></div></div></> : <div className="empty-state speed-empty"><div className="empty-icon">↗</div><b>还没有测速结果</b><p>保存参数后，点击“测试当前节点”开始实际下载。</p></div>}{(props.progress.status === 'error' || props.progress.status === 'cancelled') && props.progress.message && <div className={props.progress.status === 'error' ? 'speed-error-text' : 'speed-cancel-text'}>{props.progress.message}</div>}{props.history.length > 0 && <div className="speed-history"><div className="panel-title">最近测速记录</div>{props.history.slice(0, 8).map((item, index) => <div className="speed-history-row" key={`${item.testedAt}-${item.nodeId}-${index}`}><div><b>{item.nodeName}</b><small>{new Date(item.testedAt).toLocaleString()} · {item.threads} 线程 · {formatBytes(item.bytes)}</small></div><div><strong>{item.averageMbps.toFixed(2)} Mbps</strong><small>{item.latencyMs} ms</small></div></div>)}</div>}</section></div></div>;
}

function SettingsPage({ state, coreInfo, tunLocked, saveDnsStrategy, openCoreFolder }: {
  state: SstapState;
  coreInfo: SstapCoreInfo;
  tunLocked: boolean;
  saveDnsStrategy: (strategy: SstapState['settings']['dnsStrategy']) => void;
  openCoreFolder: () => void;
}) {
  return <div className="page-stack"><div className="page-intro"><div><h2>软件设置</h2><p>管理 DNS 地址族、sing-box 内核和本机数据存储。</p></div></div><section className="panel-card settings-card">
    <div className="setting-row"><div><b>DNS 地址族策略</b><small>IPv4-only 适合没有 IPv6 出口的节点；双栈模式允许 A/AAAA，要求本地网络和节点出口都支持 IPv6。修改后需重新启动系统 TUN。</small></div><select className="text-input setting-select" value={state.settings.dnsStrategy || 'ipv4_only'} disabled={tunLocked} onChange={(event) => saveDnsStrategy(event.target.value as SstapState['settings']['dnsStrategy'])}><option value="ipv4_only">IPv4 only（当前推荐）</option><option value="prefer_ipv4">IPv4 + IPv6 双栈（IPv4 优先）</option><option value="prefer_ipv6">IPv4 + IPv6 双栈（IPv6 优先）</option></select></div>
    <div className="setting-row"><div><b>sing-box 核心版本</b><small>{coreInfo.installed ? coreInfo.version : coreInfo.error || '尚未找到 sing-box.exe'}<br/><code className="core-path">{coreInfo.executable || '未安装'}</code></small></div><div className="setting-control"><span className={`pill ${coreInfo.installed ? 'pill-green' : 'pill-blue'}`}>{coreInfo.installed ? '核心已就绪' : '未找到核心'}</span><button className="button button-quiet" disabled={!coreInfo.installed} onClick={openCoreFolder}>打开内核目录</button></div></div>
    <div className="setting-row"><div><b>手动升级 sing-box</b><small>关闭 SSTap Next 和系统 TUN 后，从官方 GitHub 下载 Windows amd64 Release。备份旧文件，再将压缩包内 sing-box.exe 和同目录 DLL 覆盖到上方目录。重新启动后会读取新版本；软件不会自动覆盖你手动更新的核心。</small></div><span className="pill pill-blue">手动管理</span></div>
    <div className="setting-row"><div><b>本地节点凭据</b><small>通过 Electron safeStorage 在 Windows 上加密保存；不可用时拒绝明文降级。</small></div><span className="pill pill-green">加密存储</span></div>
    <div className="setting-row"><div><b>数据文件</b><small>位于当前 Windows 用户的应用数据目录。</small></div><span className="setting-value">state.enc.json</span></div>
    <div className="setting-row"><div><b>订阅更新间隔偏好</b><small>当前配置为 {state.settings.autoRefreshHours} 小时；当前仅保存刷新间隔设置；自动后台刷新暂未启用。</small></div><span className="setting-value">{state.settings.autoRefreshHours} h</span></div>
    <div className="setting-row"><div><b>系统网络状态</b><small>仅在点击“系统 TUN 接管”并确认 UAC 后才由 sing-box 管理 TUN 路由和 DNS；断开时由 Agent 验证网卡移除。</small></div><span className="pill pill-blue">安全模式</span></div>
  </section></div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
