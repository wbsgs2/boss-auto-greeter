const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApi', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (payload) => ipcRenderer.invoke('config:save', payload),
  testSiliconFlowConnection: (payload) => ipcRenderer.invoke('siliconflow:testConnection', payload),
  buildGreetingDraft: (payload) => ipcRenderer.invoke('siliconflow:buildGreetingDraft', payload),
  getMcpBossStatus: () => ipcRenderer.invoke('mcpBoss:getStatus'),
  getMcpBossCapabilities: () => ipcRenderer.invoke('mcpBoss:getCapabilities'),
  getMcpBossLoginStatus: () => ipcRenderer.invoke('mcpBoss:getLoginStatus'),
  requestMcpBossLoginQr: () => ipcRenderer.invoke('mcpBoss:requestLoginQr'),
  searchMcpBossJobs: (payload) => ipcRenderer.invoke('mcpBoss:searchJobs', payload),
  startMcpBoss: () => ipcRenderer.invoke('mcpBoss:start'),
  stopMcpBoss: () => ipcRenderer.invoke('mcpBoss:stop'),
  getRunnerSnapshot: () => ipcRenderer.invoke('runner:getSnapshot'),
  startRunner: () => ipcRenderer.invoke('runner:start'),
  pauseRunner: () => ipcRenderer.invoke('runner:pause'),
  stopRunner: () => ipcRenderer.invoke('runner:stop'),
  runnerSearchOnce: (payload) => ipcRenderer.invoke('runner:searchOnce', payload),
  runnerBuildGreetingPreview: (payload) => ipcRenderer.invoke('runner:buildGreetingPreview', payload),
  runnerRunCycle: (payload) => ipcRenderer.invoke('runner:runCycle', payload),
  onMcpBossLog: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('mcpBoss:log', wrapped);
    return () => ipcRenderer.removeListener('mcpBoss:log', wrapped);
  },
  onMcpBossStatus: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('mcpBoss:status', wrapped);
    return () => ipcRenderer.removeListener('mcpBoss:status', wrapped);
  },
  onRunnerLog: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('runner:log', wrapped);
    return () => ipcRenderer.removeListener('runner:log', wrapped);
  },
  onRunnerState: (listener) => {
    const wrapped = (_event, payload) => listener(payload);
    ipcRenderer.on('runner:state', wrapped);
    return () => ipcRenderer.removeListener('runner:state', wrapped);
  }
});
