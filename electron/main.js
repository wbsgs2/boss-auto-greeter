const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { ConfigStore } = require('./services/configStore');
const { McpBossManager } = require('./services/mcpBossManager');
const { SiliconFlowClient } = require('./services/siliconFlowClient');
const { RunnerManager } = require('./services/runnerManager');
const { registerHandlers } = require('./ipc/registerHandlers');

let mainWindow = null;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Stage-1 keeps sandbox disabled for preload compatibility and easier local debugging.
      // Revisit and enable after IPC surface is further tightened.
      sandbox: false
    },
    title: 'BOSS Auto Greeter'
  });

  mainWindow.loadFile(path.join(__dirname, '../src/renderer/index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function bootstrap() {
  const configStore = new ConfigStore(app);
  configStore.load();

  const mcpBossManager = new McpBossManager();
  mcpBossManager.configure(configStore.getFullConfig().mcpBoss);

  const siliconFlowClient = new SiliconFlowClient(configStore);
  const runnerManager = new RunnerManager({
    configStore,
    mcpBossManager,
    siliconFlowClient
  });

  // Stage-2: include reserved login/search skeleton IPC surface for future mcp-boss integration.
  registerHandlers({
    ipcMain,
    app,
    configStore,
    mcpBossManager,
    siliconFlowClient,
    runnerManager,
    getMainWindow: () => mainWindow
  });

  createMainWindow();

  mcpBossManager.ensureServiceAvailable({ autoStart: true }).catch((error) => {
    console.warn('[main] auto start mcp-boss skipped:', error?.message || error);
  });

  app.on('before-quit', () => {
    mcpBossManager.stop();
  });
}

app.whenReady().then(bootstrap).catch((error) => {
  console.error('[main] bootstrap failed:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});
