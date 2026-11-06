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

  type SstapSpeedProgress = {
    status: 'starting' | 'running' | 'completed' | 'cancelled' | 'error';
    receivedBytes?: number;
    totalBytes?: number;
    ratio?: number;
    completedWorkers?: number;
    threads?: number;
    message?: string;
  };

  type SstapState = {
    schemaVersion: number;
    nodes: SstapNode[];
    subscriptions: SstapSubscription[];
    speedResults: SstapSpeedResult[];
    settings: {
      mode: 'global' | 'bypass-cn' | 'rule';
      speedTestUrl: string;
      speedTestBytes: number;
      speedTestThreads: number;
      autoRefreshHours: number;
      customRulesText: string;
      dnsStrategy: 'ipv4_only' | 'prefer_ipv4' | 'prefer_ipv6';
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
      onCoreEvent(listener: (status: SstapCoreStatus) => void): () => void;
      onTunEvent(listener: (status: SstapTunStatus) => void): () => void;
      onSpeedProgress(listener: (progress: SstapSpeedProgress) => void): () => void;
    };
  }
}
