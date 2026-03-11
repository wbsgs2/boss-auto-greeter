const state = {
  unsubscribeMcpLog: null,
  unsubscribeMcpStatus: null,
  unsubscribeRunnerLog: null,
  unsubscribeRunnerState: null
};

const MAX_LOG_LINES = 500;

const elements = {
  tabButtons: document.querySelectorAll('.tab-button'),
  panels: document.querySelectorAll('.tab-panel'),
  appVersion: document.querySelector('#app-version'),

  apiKey: document.querySelector('#api-key'),
  model: document.querySelector('#model'),
  baseUrl: document.querySelector('#base-url'),
  aiConfigForm: document.querySelector('#ai-config-form'),
  testConnectionBtn: document.querySelector('#test-connection-btn'),
  aiStatus: document.querySelector('#ai-status'),
  apiKeyMask: document.querySelector('#api-key-mask'),

  mcpConfigForm: document.querySelector('#mcp-config-form'),
  mcpCommand: document.querySelector('#mcp-command'),
  mcpArgs: document.querySelector('#mcp-args'),
  mcpCwd: document.querySelector('#mcp-cwd'),
  mcpStartBtn: document.querySelector('#mcp-start-btn'),
  mcpStopBtn: document.querySelector('#mcp-stop-btn'),
  mcpRefreshBtn: document.querySelector('#mcp-refresh-btn'),
  mcpStatusText: document.querySelector('#mcp-status-text'),
  mcpCapabilitiesBtn: document.querySelector('#mcp-capabilities-btn'),
  mcpCapabilitiesText: document.querySelector('#mcp-capabilities-text'),
  mcpLoginStatusBtn: document.querySelector('#mcp-login-status-btn'),
  mcpLoginQrBtn: document.querySelector('#mcp-login-qr-btn'),
  mcpLoginText: document.querySelector('#mcp-login-text'),

  searchForm: document.querySelector('#search-form'),
  searchKeyword: document.querySelector('#search-keyword'),
  searchCity: document.querySelector('#search-city'),
  searchSalary: document.querySelector('#search-salary'),
  searchExperience: document.querySelector('#search-experience'),
  searchEducation: document.querySelector('#search-education'),
  searchPage: document.querySelector('#search-page'),
  searchPageSize: document.querySelector('#search-page-size'),
  searchSort: document.querySelector('#search-sort'),
  searchOnceBtn: document.querySelector('#search-once-btn'),
  searchStatus: document.querySelector('#search-status'),
  searchResults: document.querySelector('#search-results'),

  runConfigForm: document.querySelector('#run-config-form'),
  runDailyLimit: document.querySelector('#run-daily-limit'),
  runIntervalMin: document.querySelector('#run-interval-min'),
  runIntervalMax: document.querySelector('#run-interval-max'),
  runMaxJobs: document.querySelector('#run-max-jobs'),
  runTemplate: document.querySelector('#run-template'),
  runDryRun: document.querySelector('#run-dry-run'),
  runAutoPause: document.querySelector('#run-auto-pause'),
  runAutoStartAfterSearch: document.querySelector('#run-auto-start-after-search'),
  runConfigStatus: document.querySelector('#run-config-status'),

  runStartBtn: document.querySelector('#run-start-btn'),
  runPauseBtn: document.querySelector('#run-pause-btn'),
  runStopBtn: document.querySelector('#run-stop-btn'),
  runCycleBtn: document.querySelector('#run-cycle-btn'),
  runGreetingPreviewBtn: document.querySelector('#run-greeting-preview-btn'),
  runnerState: document.querySelector('#runner-state'),

  statSearchCalls: document.querySelector('#stat-search-calls'),
  statSearchJobs: document.querySelector('#stat-search-jobs'),
  statSelectedJobs: document.querySelector('#stat-selected-jobs'),
  statGreetSuccess: document.querySelector('#stat-greet-success'),
  statGreetFailed: document.querySelector('#stat-greet-failed'),
  statLastAction: document.querySelector('#stat-last-action'),

  greetingPreview: document.querySelector('#greeting-preview'),
  logs: document.querySelector('#logs')
};

function setStatus(el, text, type = 'normal') {
  if (!el) {
    return;
  }
  el.textContent = text;
  el.classList.remove('success', 'error');
  if (type === 'success') {
    el.classList.add('success');
  }
  if (type === 'error') {
    el.classList.add('error');
  }
}

function getErrorMessage(error) {
  if (error && typeof error.message === 'string') {
    return error.message;
  }
  return String(error || 'unknown error');
}

function appendLog(line) {
  const timestamp = new Date().toLocaleTimeString();
  const hasPlaceholder = elements.logs.textContent === '等待日志...';
  if (hasPlaceholder) {
    elements.logs.textContent = '';
  }

  const lines = elements.logs.textContent.split('\n').filter(Boolean);
  lines.push(`[${timestamp}] ${line}`);
  if (lines.length > MAX_LOG_LINES) {
    lines.splice(0, lines.length - MAX_LOG_LINES);
  }

  elements.logs.textContent = `${lines.join('\n')}\n`;
  elements.logs.scrollTop = elements.logs.scrollHeight;
}

function bindGlobalErrorHandlers() {
  window.addEventListener('error', (event) => {
    const message = event?.error ? getErrorMessage(event.error) : getErrorMessage(event?.message);
    appendLog(`全局异常: ${message}`);
  });

  window.addEventListener('unhandledrejection', (event) => {
    appendLog(`未处理 Promise 异常: ${getErrorMessage(event?.reason)}`);
  });
}

function switchTab(tabId) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  elements.panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function parseArgs(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function toBoundedInteger(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(n)));
}

function collectSearchPayload() {
  return {
    keyword: elements.searchKeyword.value.trim(),
    city: elements.searchCity.value.trim(),
    salaryRange: elements.searchSalary.value.trim(),
    experience: elements.searchExperience.value.trim(),
    education: elements.searchEducation.value.trim(),
    page: toBoundedInteger(elements.searchPage.value, 1, 100, 1),
    pageSize: toBoundedInteger(elements.searchPageSize.value, 1, 100, 20),
    sortBy: elements.searchSort.value.trim() || 'default'
  };
}

function collectRunConfigPayload() {
  const minSec = toBoundedInteger(elements.runIntervalMin.value, 1, 120, 20);
  const maxSec = toBoundedInteger(elements.runIntervalMax.value, minSec, 300, 45);

  return {
    dailyGreetingLimit: toBoundedInteger(elements.runDailyLimit.value, 1, 500, 30),
    sendIntervalMinSec: minSec,
    sendIntervalMaxSec: maxSec,
    autoPauseOnCaptcha: elements.runAutoPause.checked,
    dryRun: elements.runDryRun.checked,
    autoStartAfterSearch: elements.runAutoStartAfterSearch.checked,
    maxJobsPerRun: toBoundedInteger(elements.runMaxJobs.value, 1, 200, 20),
    greetingTemplate: elements.runTemplate.value.trim() || 'default'
  };
}

function applyConfig(config) {
  const ai = config?.ai || {};
  const preferences = config?.preferences || {};
  const mcpBoss = config?.mcpBoss || {};
  const jobSearch = config?.jobSearch || {};
  const runConfig = config?.runConfig || {};

  elements.model.value = ai.model || '';
  elements.baseUrl.value = ai.baseUrl || '';
  elements.mcpCommand.value = mcpBoss.command || '';
  elements.mcpArgs.value = Array.isArray(mcpBoss.args) ? mcpBoss.args.join(' ') : '';
  elements.mcpCwd.value = mcpBoss.cwd || '';

  elements.searchKeyword.value = jobSearch.keyword ?? preferences.keyword ?? '';
  elements.searchCity.value = jobSearch.city ?? preferences.city ?? '';
  elements.searchSalary.value = jobSearch.salaryRange || '';
  elements.searchExperience.value = jobSearch.experience || '';
  elements.searchEducation.value = jobSearch.education || '';
  elements.searchPage.value = String(jobSearch.page || 1);
  elements.searchPageSize.value = String(jobSearch.pageSize || 20);
  elements.searchSort.value = jobSearch.sortBy || 'default';

  elements.runDailyLimit.value = String(runConfig.dailyGreetingLimit ?? preferences.dailyGreetingLimit ?? 30);
  elements.runIntervalMin.value = String(runConfig.sendIntervalMinSec ?? preferences.sendIntervalMinSec ?? 20);
  elements.runIntervalMax.value = String(runConfig.sendIntervalMaxSec ?? preferences.sendIntervalMaxSec ?? 45);
  elements.runMaxJobs.value = String(runConfig.maxJobsPerRun ?? 20);
  elements.runTemplate.value = runConfig.greetingTemplate || 'default';
  elements.runDryRun.checked = Boolean(runConfig.dryRun ?? true);
  elements.runAutoPause.checked = Boolean(runConfig.autoPauseOnCaptcha ?? preferences.autoPauseOnCaptcha ?? true);
  elements.runAutoStartAfterSearch.checked = Boolean(runConfig.autoStartAfterSearch);

  const masked = ai.apiKeyMasked || '';
  elements.apiKeyMask.textContent = masked ? `当前已保存 Key：${masked}` : '当前未保存 API Key';
}

function renderMcpStatus(status) {
  if (!status || typeof status !== 'object') {
    elements.mcpStatusText.textContent = 'unknown | 无法读取 mcp-boss 状态';
    return;
  }

  const phase = status.phase || 'unknown';
  const message = status.message || '';
  const pid = status.pid ? ` PID=${status.pid}` : '';
  const cmd = status.commandSummary ? ` 命令=${status.commandSummary}` : '';
  elements.mcpStatusText.textContent = `${phase} | ${message}${pid}${cmd}`.trim();
}

function renderSearchResult(result) {
  if (!result || typeof result !== 'object') {
    elements.searchResults.textContent = '搜索结果异常：空响应';
    return;
  }

  const jobs = Array.isArray(result.jobs) ? result.jobs : [];
  const total = Number.isFinite(Number(result.total)) ? Number(result.total) : jobs.length;
  const lines = [];
  lines.push(`implemented: ${Boolean(result.implemented)}`);
  lines.push(`message: ${result.message || ''}`);
  lines.push(`query: ${JSON.stringify(result.query || {}, null, 2)}`);
  lines.push(`total: ${total}`);
  lines.push(`jobs: ${jobs.length}`);

  if (jobs.length > 0) {
    lines.push('preview:');
    jobs.slice(0, 5).forEach((job, index) => {
      lines.push(`${index + 1}. ${JSON.stringify(job)}`);
    });
  } else {
    lines.push('preview: (空结果)');
  }

  elements.searchResults.textContent = `${lines.join('\n')}\n`;
}

function renderGreetingPreview(result) {
  if (!result || typeof result !== 'object') {
    elements.greetingPreview.textContent = '打招呼预览异常：空响应';
    return;
  }

  elements.greetingPreview.textContent = `${result.draft || ''}\n\nmessage: ${result.message || ''}\nimplemented: ${Boolean(result.implemented)}`;
}

function renderRunnerSnapshot(snapshot) {
  const phase = snapshot?.phase || 'idle';
  const stats = snapshot?.stats || {};

  elements.runnerState.textContent = `当前状态：${phase}`;
  elements.statSearchCalls.textContent = String(stats.searchCalls || 0);
  elements.statSearchJobs.textContent = String(stats.searchedJobs || 0);
  elements.statSelectedJobs.textContent = String(stats.selectedJobs || 0);
  elements.statGreetSuccess.textContent = String(stats.greetSuccess || 0);
  elements.statGreetFailed.textContent = String(stats.greetFailed || 0);
  elements.statLastAction.textContent = stats.lastAction || '-';
}

async function loadConfig() {
  try {
    const config = await window.desktopApi.getConfig();
    applyConfig(config);
  } catch (error) {
    const message = `加载配置失败: ${getErrorMessage(error)}`;
    setStatus(elements.aiStatus, message, 'error');
    appendLog(message);
  }
}

async function refreshRunnerSnapshot() {
  try {
    const snapshot = await window.desktopApi.getRunnerSnapshot();
    renderRunnerSnapshot(snapshot);
  } catch (error) {
    appendLog(`读取 runner 状态失败: ${getErrorMessage(error)}`);
  }
}

async function saveAIConfig(event) {
  event.preventDefault();

  const payload = {
    ai: {
      model: elements.model.value.trim(),
      baseUrl: elements.baseUrl.value.trim()
    }
  };

  const apiKey = elements.apiKey.value.trim();
  if (apiKey) {
    payload.ai.apiKey = apiKey;
  }

  try {
    const saved = await window.desktopApi.saveConfig(payload);
    applyConfig(saved);
    elements.apiKey.value = '';

    const encryptionMode = saved.ai.encryptionMode;
    if (encryptionMode === 'insecurePlaintext') {
      setStatus(elements.aiStatus, '配置已保存（当前系统不支持安全加密，API Key 暂以明文保存）', 'error');
    } else {
      setStatus(elements.aiStatus, '配置已保存', 'success');
    }
  } catch (error) {
    setStatus(elements.aiStatus, `保存失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function saveSearchConfig(event) {
  event.preventDefault();

  try {
    const saved = await window.desktopApi.saveConfig({
      jobSearch: collectSearchPayload()
    });
    applyConfig(saved);
    setStatus(elements.searchStatus, '岗位搜索参数已保存', 'success');
  } catch (error) {
    setStatus(elements.searchStatus, `保存失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function saveRunConfig(event) {
  event.preventDefault();

  try {
    const saved = await window.desktopApi.saveConfig({
      runConfig: collectRunConfigPayload()
    });
    applyConfig(saved);
    setStatus(elements.runConfigStatus, '任务运行配置已保存', 'success');
  } catch (error) {
    setStatus(elements.runConfigStatus, `保存失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function testConnection() {
  setStatus(elements.aiStatus, '正在测试连接...');

  const payload = {
    model: elements.model.value.trim(),
    baseUrl: elements.baseUrl.value.trim()
  };

  const inputKey = elements.apiKey.value.trim();
  if (inputKey) {
    payload.apiKey = inputKey;
  }

  try {
    const result = await window.desktopApi.testSiliconFlowConnection(payload);
    if (result.ok) {
      const msg = `连接成功，延迟 ${result.latencyMs}ms，模型 ${result.model}`;
      setStatus(elements.aiStatus, msg, 'success');
    } else {
      setStatus(elements.aiStatus, result.error || '连接失败', 'error');
    }
  } catch (error) {
    setStatus(elements.aiStatus, `连接失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function saveMcpConfig(event) {
  event.preventDefault();

  const payload = {
    mcpBoss: {
      command: elements.mcpCommand.value.trim(),
      args: parseArgs(elements.mcpArgs.value),
      cwd: elements.mcpCwd.value.trim()
    }
  };

  try {
    await window.desktopApi.saveConfig(payload);
    appendLog('mcp-boss 配置已保存');
    await refreshMcpStatus();
  } catch (error) {
    const message = `保存 mcp 配置失败: ${getErrorMessage(error)}`;
    appendLog(message);
    renderMcpStatus({
      phase: 'error',
      message
    });
  }
}

async function refreshMcpStatus() {
  try {
    const status = await window.desktopApi.getMcpBossStatus();
    renderMcpStatus(status);
  } catch (error) {
    const message = `刷新 mcp 状态失败: ${getErrorMessage(error)}`;
    appendLog(message);
    renderMcpStatus({
      phase: 'error',
      message
    });
  }
}

async function startMcpBoss() {
  try {
    const status = await window.desktopApi.startMcpBoss();
    renderMcpStatus(status);
  } catch (error) {
    const message = `启动 mcp-boss 失败: ${getErrorMessage(error)}`;
    appendLog(message);
    renderMcpStatus({
      phase: 'error',
      message
    });
  }
}

async function stopMcpBoss() {
  try {
    const status = await window.desktopApi.stopMcpBoss();
    renderMcpStatus(status);
  } catch (error) {
    const message = `停止 mcp-boss 失败: ${getErrorMessage(error)}`;
    appendLog(message);
    renderMcpStatus({
      phase: 'error',
      message
    });
  }
}

async function readMcpCapabilities() {
  try {
    const capabilities = await window.desktopApi.getMcpBossCapabilities();
    const text = `login=${capabilities.login.implemented}, search=${capabilities.search.implemented}, greeting=${capabilities.greeting.implemented}`;
    setStatus(elements.mcpCapabilitiesText, `MCP 能力：${text}`);
    appendLog(`读取 mcp 能力：${text}`);
  } catch (error) {
    setStatus(elements.mcpCapabilitiesText, `读取失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function readMcpLoginStatus() {
  try {
    const result = await window.desktopApi.getMcpBossLoginStatus();
    const text = `${result.phase} | ${result.message}`;
    setStatus(elements.mcpLoginText, text);
    appendLog(`登录状态接口返回：${text}`);
  } catch (error) {
    setStatus(elements.mcpLoginText, `读取失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function requestMcpLoginQr() {
  try {
    const result = await window.desktopApi.requestMcpBossLoginQr();
    const text = `${result.phase} | ${result.message}`;
    setStatus(elements.mcpLoginText, text);
    appendLog(`登录接口返回：${text}`);
  } catch (error) {
    setStatus(elements.mcpLoginText, `请求失败: ${getErrorMessage(error)}`, 'error');
  }
}

async function runSearchSkeleton() {
  setStatus(elements.searchStatus, '正在调用搜索接口...');

  try {
    const response = await window.desktopApi.runnerSearchOnce({
      jobSearch: collectSearchPayload(),
      runConfig: collectRunConfigPayload()
    });

    if (!response?.ok) {
      const message = response?.error || '搜索调用失败';
      setStatus(elements.searchStatus, message, 'error');
      appendLog(message);
      if (response?.snapshot) {
        renderRunnerSnapshot(response.snapshot);
      }
      return null;
    }

    renderSearchResult(response.result);
    renderRunnerSnapshot(response.snapshot);

    const level = response.result.implemented ? 'success' : 'normal';
    setStatus(elements.searchStatus, response.result.message || '搜索调用完成', level);
    return response.result;
  } catch (error) {
    const message = `搜索调用失败: ${getErrorMessage(error)}`;
    setStatus(elements.searchStatus, message, 'error');
    appendLog(message);
    return null;
  }
}

async function buildGreetingPreview() {
  try {
    const response = await window.desktopApi.runnerBuildGreetingPreview({
      jobSearch: collectSearchPayload(),
      runConfig: collectRunConfigPayload()
    });

    if (!response?.ok) {
      const message = response?.error || '打招呼预览生成失败';
      elements.greetingPreview.textContent = message;
      appendLog(message);
      if (response?.snapshot) {
        renderRunnerSnapshot(response.snapshot);
      }
      return null;
    }

    renderGreetingPreview(response.result);
    renderRunnerSnapshot(response.snapshot);
    return response.result;
  } catch (error) {
    const message = `打招呼预览生成失败: ${getErrorMessage(error)}`;
    elements.greetingPreview.textContent = message;
    appendLog(message);
    return null;
  }
}

async function runOneCycle() {
  try {
    const response = await window.desktopApi.runnerRunCycle({
      jobSearch: collectSearchPayload(),
      runConfig: collectRunConfigPayload()
    });

    if (!response?.ok) {
      const message = response?.error || '执行骨架任务失败';
      appendLog(message);
      if (response?.snapshot) {
        renderRunnerSnapshot(response.snapshot);
      }
      return;
    }

    renderRunnerSnapshot(response.snapshot);

    if (response.result?.searchResult) {
      renderSearchResult(response.result.searchResult);
      const level = response.result.searchResult.implemented ? 'success' : 'normal';
      setStatus(elements.searchStatus, response.result.searchResult.message || '搜索调用完成', level);
    }

    if (response.result?.greetingPreview) {
      renderGreetingPreview(response.result.greetingPreview);
    }
  } catch (error) {
    appendLog(`执行骨架任务失败: ${getErrorMessage(error)}`);
  }
}

async function startRunner() {
  try {
    const snapshot = await window.desktopApi.startRunner();
    renderRunnerSnapshot(snapshot);
  } catch (error) {
    appendLog(`开始任务失败: ${getErrorMessage(error)}`);
  }
}

async function pauseRunner() {
  try {
    const snapshot = await window.desktopApi.pauseRunner();
    renderRunnerSnapshot(snapshot);
  } catch (error) {
    appendLog(`暂停任务失败: ${getErrorMessage(error)}`);
  }
}

async function stopRunner() {
  try {
    const snapshot = await window.desktopApi.stopRunner();
    renderRunnerSnapshot(snapshot);
  } catch (error) {
    appendLog(`停止任务失败: ${getErrorMessage(error)}`);
  }
}

function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  elements.aiConfigForm.addEventListener('submit', saveAIConfig);
  elements.testConnectionBtn.addEventListener('click', testConnection);

  elements.mcpConfigForm.addEventListener('submit', saveMcpConfig);
  elements.mcpStartBtn.addEventListener('click', startMcpBoss);
  elements.mcpStopBtn.addEventListener('click', stopMcpBoss);
  elements.mcpRefreshBtn.addEventListener('click', refreshMcpStatus);
  elements.mcpCapabilitiesBtn.addEventListener('click', readMcpCapabilities);
  elements.mcpLoginStatusBtn.addEventListener('click', readMcpLoginStatus);
  elements.mcpLoginQrBtn.addEventListener('click', requestMcpLoginQr);

  elements.searchForm.addEventListener('submit', saveSearchConfig);
  elements.searchOnceBtn.addEventListener('click', runSearchSkeleton);

  elements.runConfigForm.addEventListener('submit', saveRunConfig);

  elements.runStartBtn.addEventListener('click', startRunner);
  elements.runPauseBtn.addEventListener('click', pauseRunner);
  elements.runStopBtn.addEventListener('click', stopRunner);
  elements.runCycleBtn.addEventListener('click', runOneCycle);
  elements.runGreetingPreviewBtn.addEventListener('click', buildGreetingPreview);

  state.unsubscribeMcpLog = window.desktopApi.onMcpBossLog((payload) => {
    if (!payload?.message) {
      return;
    }
    appendLog(`[mcp-boss][${payload.level}] ${payload.message}`);
  });

  state.unsubscribeMcpStatus = window.desktopApi.onMcpBossStatus((status) => {
    renderMcpStatus(status);
  });

  state.unsubscribeRunnerLog = window.desktopApi.onRunnerLog((payload) => {
    if (!payload?.message) {
      return;
    }
    appendLog(`[runner][${payload.level}] ${payload.message}`);
  });

  state.unsubscribeRunnerState = window.desktopApi.onRunnerState((snapshot) => {
    renderRunnerSnapshot(snapshot);
  });

  window.addEventListener('beforeunload', () => {
    state.unsubscribeMcpLog?.();
    state.unsubscribeMcpStatus?.();
    state.unsubscribeRunnerLog?.();
    state.unsubscribeRunnerState?.();
  });
}

async function init() {
  if (!window.desktopApi) {
    setStatus(elements.aiStatus, 'preload 未注入 desktopApi，请检查 Electron 配置。', 'error');
    return;
  }

  bindGlobalErrorHandlers();
  bindEvents();

  try {
    const version = await window.desktopApi.getAppVersion();
    elements.appVersion.textContent = `v${version}`;
  } catch (error) {
    elements.appVersion.textContent = 'vunknown';
    appendLog(`读取版本失败: ${getErrorMessage(error)}`);
  }

  await loadConfig();
  await refreshMcpStatus();
  await readMcpCapabilities();
  await refreshRunnerSnapshot();
}

init().catch((error) => {
  appendLog(`初始化失败: ${getErrorMessage(error)}`);
});
