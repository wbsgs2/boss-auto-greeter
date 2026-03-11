function registerHandlers({
  ipcMain,
  app,
  configStore,
  mcpBossManager,
  siliconFlowClient,
  runnerManager,
  getMainWindow
}) {
  ipcMain.handle('config:get', () => {
    return configStore.getPublicConfig();
  });

  ipcMain.handle('config:save', (_event, payload) => {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid config payload');
    }

    const saved = configStore.save(payload);

    if (payload.mcpBoss) {
      mcpBossManager.configure(saved.mcpBoss);
    }

    return saved;
  });

  ipcMain.handle('siliconflow:testConnection', async (_event, payload) => {
    return siliconFlowClient.testConnection(payload || {});
  });

  ipcMain.handle('siliconflow:getModels', async (_event, payload) => {
    return siliconFlowClient.getAvailableModels(payload || {});
  });

  ipcMain.handle('siliconflow:buildGreetingDraft', (_event, payload) => {
    return siliconFlowClient.buildGreetingDraft(payload || {});
  });

  ipcMain.handle('mcpBoss:getStatus', () => {
    return mcpBossManager.getStatus();
  });

  ipcMain.handle('mcpBoss:getCapabilities', () => {
    return mcpBossManager.getAdapterCapabilities();
  });

  ipcMain.handle('mcpBoss:getLoginStatus', () => {
    return mcpBossManager.getLoginStatus();
  });

  ipcMain.handle('mcpBoss:requestLoginQr', () => {
    return mcpBossManager.requestLoginQr();
  });

  ipcMain.handle('mcpBoss:searchJobs', (_event, payload) => {
    return mcpBossManager.searchJobs(payload || {});
  });

  ipcMain.handle('mcpBoss:start', () => {
    return mcpBossManager.start();
  });

  ipcMain.handle('mcpBoss:stop', () => {
    return mcpBossManager.stop();
  });

  ipcMain.handle('runner:getSnapshot', () => {
    return runnerManager.getSnapshot();
  });

  ipcMain.handle('runner:start', () => {
    return runnerManager.start();
  });

  ipcMain.handle('runner:pause', () => {
    return runnerManager.pause();
  });

  ipcMain.handle('runner:stop', () => {
    return runnerManager.stop();
  });

  ipcMain.handle('runner:searchOnce', (_event, payload) => {
    return runnerManager.searchOnce(payload || {});
  });

  ipcMain.handle('runner:buildGreetingPreview', (_event, payload) => {
    return runnerManager.buildGreetingPreview(payload || {});
  });

  ipcMain.handle('runner:runCycle', (_event, payload) => {
    return runnerManager.runCycle(payload || {});
  });

  ipcMain.handle('app:getVersion', () => {
    if (typeof app?.getVersion === 'function') {
      return app.getVersion();
    }
    return process.env.npm_package_version || '0.1.0';
  });

  mcpBossManager.on('log', (payload) => {
    const window = getMainWindow();
    if (!window?.isDestroyed()) {
      window.webContents.send('mcpBoss:log', payload);
    }
  });

  mcpBossManager.on('status', (payload) => {
    const window = getMainWindow();
    if (!window?.isDestroyed()) {
      window.webContents.send('mcpBoss:status', payload);
    }
  });

  runnerManager.on('log', (payload) => {
    const window = getMainWindow();
    if (!window?.isDestroyed()) {
      window.webContents.send('runner:log', payload);
    }
  });

  runnerManager.on('state', (payload) => {
    const window = getMainWindow();
    if (!window?.isDestroyed()) {
      window.webContents.send('runner:state', payload);
    }
  });
}

module.exports = {
  registerHandlers
};
