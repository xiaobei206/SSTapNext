'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, listener) {
  const handler = (_event, payload) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('sstap', Object.freeze({
  getState: () => ipcRenderer.invoke('sstap:get-state'),
  getRuleLibrary: () => ipcRenderer.invoke('sstap:rule-library-get'),
  updateRuleLibrary: () => ipcRenderer.invoke('sstap:rule-library-update'),
  importText: (text) => ipcRenderer.invoke('sstap:import-text', text),
  addSubscription: (url, name) => ipcRenderer.invoke('sstap:subscription-add', url, name),
  refreshSubscription: (id) => ipcRenderer.invoke('sstap:subscription-refresh', id),
  deleteSubscription: (id) => ipcRenderer.invoke('sstap:subscription-delete', id),
  saveSettings: (settings) => ipcRenderer.invoke('sstap:settings-save', settings),
  deleteNode: (id) => ipcRenderer.invoke('sstap:node-delete', id),
  checkCore: () => ipcRenderer.invoke('sstap:core-check'),
  openCoreFolder: () => ipcRenderer.invoke('sstap:core-open-folder'),
  getCoreStatus: () => ipcRenderer.invoke('sstap:core-status'),
  connectNode: (id) => ipcRenderer.invoke('sstap:core-connect', id),
  disconnectCore: () => ipcRenderer.invoke('sstap:core-disconnect'),
  getTunStatus: () => ipcRenderer.invoke('sstap:tun-status'),
  connectTun: (id) => ipcRenderer.invoke('sstap:tun-connect', id),
  disconnectTun: () => ipcRenderer.invoke('sstap:tun-disconnect'),
  runSpeedTest: (id) => ipcRenderer.invoke('sstap:speed-test', id),
  cancelSpeedTest: () => ipcRenderer.invoke('sstap:speed-cancel'),
  startBatchNodeTest: (options) => ipcRenderer.invoke('sstap:batch-test-start', options),
  cancelBatchNodeTest: () => ipcRenderer.invoke('sstap:batch-test-cancel'),
  onCoreEvent: (listener) => subscribe('sstap:core-event', listener),
  onTunEvent: (listener) => subscribe('sstap:tun-event', listener),
  onTrafficEvent: (listener) => subscribe('sstap:traffic-event', listener),
  onSpeedProgress: (listener) => subscribe('sstap:speed-progress', listener),
  onBatchTestProgress: (listener) => subscribe('sstap:batch-test-progress', listener),
}));
