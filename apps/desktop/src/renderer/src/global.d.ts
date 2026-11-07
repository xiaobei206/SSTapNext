export {};

declare global {
  type SstapNode = {
    id: string;
    type: string;
    name: string;
    server: string;
    server_port: number;
    source?: string;
    sources?: string[];
    addedAt?: string;
    uuid?: string;
    password?: string;
    method?: string;
  };

  type SstapSubscription = {
    id: string;
    name: string;
    url: string;
    nodeCount: number;
    updatedAt: string;
    lastError?: string | null;
  };

  type SstapSpeedResult = {
    testedAt: string;
    url: string;
    bytes: number;
    elapsedMs: number;
    latencyMs: number;
    averageMbps: number;
    peakMbps: number;
    threads: number;
    statusCode: number;
    nodeId: string;
    nodeName: string;
    server?: string;
    serverPort?: number;
  };

  type SstapCoreStatus = {
    status: 'disconnected' | 'starting' | 'connected' | 'stopping' | 'error';
    connected: boolean;
    nodeId?: string;
    nodeName?: string;
    server?: string;
    serverPort?: number;
    pid?: number | null;
    startedAt?: string | null;
    proxyHost?: string;
    proxyPort?: number;
    socks5Url?: string;
    httpUrl?: string;
    coreVersion?: string;
    logs?: string[];
    lastError?: string | null;
  };

  type SstapTunStatus = {
    status: 'disconnected' | 'requested' | 'awaiting_uac' | 'starting' | 'running' | 'stopping' | 'stopped' | 'stopped_with_warning' | 'error' | 'cleanup_error';
    connected?: boolean;
    sessionId?: string;
    nodeId?: string;
    nodeName?: string;
    mode?: string;
    interfaceName?: string;
    corePid?: number | null;
    startedAt?: string | null;
    updatedAt?: string | null;
    lastError?: string | null;
    logPath?: string | null;
    sessionDirectory?: string | null;
  };

  type SstapCoreInfo = {
    installed: boolean;
    executable: string | null;
    version: string | null;
    error: string | null;
  };

  type SstapNodeTestMetric = {
    status: 'testing' | 'ok' | 'timeout' | 'error' | 'not-applicable';
    averageMs?: number | null;
    latencyMs?: number | null;
    lossPercent?: number | null;
    sent?: number;
    received?: number;
    averageMbps?: number | null;
    peakMbps?: number | null;
    bytes?: number;
    elapsedMs?: number;
    threads?: number;
    statusCode?: number;
    message?: string | null;
  };

  type SstapNodeTestResult = {
    testedAt: string;
    status: 'testing' | 'complete' | 'partial' | 'error';
    ping: SstapNodeTestMetric;
    tcping: SstapNodeTestMetric;
    proxyLatency: SstapNodeTestMetric;
    download: SstapNodeTestMetric;
  };

  type SstapBatchTestProgress = {
    status: 'starting' | 'running' | 'completed' | 'cancelled' | 'error';
    total?: number;
    completed?: number;
    failed?: number;
    active?: number;
    concurrency?: number;
    effectiveConcurrency?: number;
    requestedDownloadThreads?: number;
    effectiveDownloadThreads?: number;
    nodeId?: string;
    nodeName?: string;
    metric?: string;
    result?: Partial<SstapNodeTestResult>;
    downloadProgress?: { receivedBytes: number; totalBytes: number; ratio: number; completedWorkers: number; threads: number; message?: string };
    message?: string;
    batchId?: string;
  };

  type SstapSpeedProgress = {
    status: 'starting' | 'running' | 'completed' | 'cancelled' | 'error';
    receivedBytes?: number;
    totalBytes?: number;
    ratio?: number;
    completedWorkers?: number;
    threads?: number;
    message?: string;
  };

  type SstapRuleEntry = {
    id: string;
    fileName: string;
    displayName: string;
    routeAction: 'proxy' | 'direct';
    cidrCount: number;
    ipv4Count: number;
    ipv6Count: number;
    isReadOnly: boolean;
    author: string;
    sourceSha256: string;
  };

  type SstapRuleLibrary = {
    installed: boolean;
    source: string;
    revision: string | null;
    updatedAt: string | null;
    ruleCount: number;
    totalCidrs: number;
    skipped: Array<{ fileName: string; reason: string }>;
    license?: string;
    unchanged?: boolean;
    rules: SstapRuleEntry[];
  };

  type SstapState = {
    schemaVersion: number;
    nodes: SstapNode[];
    subscriptions: SstapSubscription[];
    speedResults: SstapSpeedResult[];
    nodeTestResults: Record<string, SstapNodeTestResult>;
    settings: {
      mode: 'global' | 'bypass-cn' | 'rule';
      speedTestUrl: string;
      speedTestBytes: number;
      speedTestThreads: number;
      batchTestConcurrency: number;
      autoRefreshHours: number;
      customRulesText: string;
      dnsStrategy: 'ipv4_only' | 'prefer_ipv4' | 'prefer_ipv6';
      enabledRuleIds: string[];
    };
    recoveryNotice?: string;
    importSummary?: { added: number; updated: number; failed: number };
    errors?: Array<{ line: number; message: string; preview: string }>;
    refreshPreserved?: boolean;
    refreshError?: string;
  };

  interface Window {
    sstap: {
      getState(): Promise<SstapState>;
      getRuleLibrary(): Promise<SstapRuleLibrary>;
      updateRuleLibrary(): Promise<SstapRuleLibrary>;
      importText(text: string): Promise<SstapState>;
      addSubscription(url: string, name?: string): Promise<SstapState>;
      refreshSubscription(id: string): Promise<SstapState>;
      deleteSubscription(id: string): Promise<SstapState>;
      saveSettings(settings: Partial<SstapState['settings']>): Promise<SstapState>;
      deleteNode(id: string): Promise<SstapState>;
      checkCore(): Promise<SstapCoreInfo>;
      openCoreFolder(): Promise<string>;
      getCoreStatus(): Promise<SstapCoreStatus>;
      connectNode(id: string): Promise<SstapCoreStatus>;
      disconnectCore(): Promise<SstapCoreStatus>;
      getTunStatus(): Promise<SstapTunStatus>;
      connectTun(id: string): Promise<SstapTunStatus>;
      disconnectTun(): Promise<SstapTunStatus>;
      runSpeedTest(id: string): Promise<{ state: SstapState; result: SstapSpeedResult }>;
      cancelSpeedTest(): Promise<boolean>;
      startBatchNodeTest(options: { nodeIds: string[]; concurrency: number }): Promise<{ status: string; total: number; completed: number; failed: number; effectiveDownloadThreads: number }>;
      cancelBatchNodeTest(): Promise<boolean>;
      onBatchTestProgress(listener: (progress: SstapBatchTestProgress) => void): () => void;
      onCoreEvent(listener: (status: SstapCoreStatus) => void): () => void;
      onTunEvent(listener: (status: SstapTunStatus) => void): () => void;
      onSpeedProgress(listener: (progress: SstapSpeedProgress) => void): () => void;
    };
  }
}
