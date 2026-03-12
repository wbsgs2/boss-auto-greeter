const FALLBACK_MODELS = [
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'deepseek-ai/DeepSeek-V2.5'
];

const state = {
  loginQrSrc: '',
  availableModels: FALLBACK_MODELS.slice(),
  silentSaveTimer: null,
  silentSaveSeq: 0,
  appliedSilentSaveSeq: 0,
  loginPollingTimer: null,
  loginPollingCount: 0,
  runnerLogEntries: []
};

const elements = {
  tabButtons: document.querySelectorAll('.tab-button'),
  panels: document.querySelectorAll('.tab-panel'),
  appVersion: document.querySelector('#app-version'),

  aiConfigForm: document.querySelector('#ai-config-form'),
  apiKey: document.querySelector('#api-key'),
  model: document.querySelector('#model'),
  testConnectionBtn: document.querySelector('#test-connection-btn'),
  aiStatus: document.querySelector('#ai-status'),
  apiKeyMask: document.querySelector('#api-key-mask'),
  installNotice: document.querySelector('#install-notice'),

  loginStartBtn: document.querySelector('#login-start-btn'),
  loginRefreshBtn: document.querySelector('#login-refresh-btn'),
  loginPhaseBadge: document.querySelector('#login-phase-badge'),
  loginStatusText: document.querySelector('#login-status-text'),
  loginQrImage: document.querySelector('#login-qr-image'),
  loginQrPlaceholder: document.querySelector('#login-qr-placeholder'),

  searchForm: document.querySelector('#search-form'),
  searchKeyword: document.querySelector('#search-keyword'),
  searchCity: document.querySelector('#search-city'),
  searchSalary: document.querySelector('#search-salary'),
  searchExperience: document.querySelector('#search-experience'),
  searchEducation: document.querySelector('#search-education'),
  searchStatus: document.querySelector('#search-status'),
  searchMeta: document.querySelector('#search-meta'),
  searchResults: document.querySelector('#search-results')
,
  runnerPhase: document.querySelector('#runner-phase'),
  runnerLastAction: document.querySelector('#runner-last-action'),
  runnerSearchCalls: document.querySelector('#runner-search-calls'),
  runnerSelectedJobs: document.querySelector('#runner-selected-jobs'),
  runnerGreetSuccess: document.querySelector('#runner-greet-success'),
  runnerGreetFailed: document.querySelector('#runner-greet-failed'),
  runnerStartBtn: document.querySelector('#runner-start-btn'),
  runnerPauseBtn: document.querySelector('#runner-pause-btn'),
  runnerStopBtn: document.querySelector('#runner-stop-btn'),
  runnerCycleBtn: document.querySelector('#runner-cycle-btn'),
  runnerClearLogBtn: document.querySelector('#runner-clear-log'),
  runnerLog: document.querySelector('#runner-log')
};

function switchTab(tabId) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tabId);
  });
  elements.panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabId);
  });
}

function setStatus(element, text, type = 'normal') {
  if (!element) {
    return;
  }

  element.textContent = text;
  element.classList.remove('success', 'error');

  if (type === 'success') {
    element.classList.add('success');
  }

  if (type === 'error') {
    element.classList.add('error');
  }
}

function reportError(context, error) {
  console.error(`[renderer] ${context}`, error);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function toBoundedInteger(value, min, max, fallback) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numberValue)));
}

function collectSearchPayload() {
  return {
    keyword: elements.searchKeyword.value.trim(),
    city: elements.searchCity.value.trim(),
    salaryRange: elements.searchSalary.value.trim(),
    experience: elements.searchExperience.value.trim(),
    education: elements.searchEducation.value.trim(),
    page: 1,
    pageSize: 20,
    sortBy: 'default'
  };
}

function validateApiKey(apiKey) {
  if (!apiKey) {
    return '';
  }

  if (/\s/.test(apiKey)) {
    return 'API Key 格式不正确，请检查是否包含空格。';
  }

  if (apiKey.length < 10) {
    return 'API Key 看起来不完整，请检查后再试。';
  }

  return '';
}

function setModelOptions(models, selectedModel = '') {
  const options = Array.from(new Set(
    (Array.isArray(models) && models.length > 0 ? models : FALLBACK_MODELS)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));
  const safeOptions = options.length > 0 ? options : FALLBACK_MODELS.slice();

  state.availableModels = safeOptions.slice();

  elements.model.innerHTML = options
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join('');

  if (options.length === 0) {
    elements.model.innerHTML = safeOptions
      .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
      .join('');
  }

  elements.model.value = safeOptions.includes(selectedModel)
    ? selectedModel
    : safeOptions[0];
}

function applyConfig(config, { preserveModelSelection = false } = {}) {
  const ai = config?.ai || {};
  const jobSearch = config?.jobSearch || {};
  const preferences = config?.preferences || {};

  elements.searchKeyword.value = jobSearch.keyword ?? preferences.keyword ?? '';
  elements.searchCity.value = jobSearch.city ?? preferences.city ?? '';
  elements.searchSalary.value = jobSearch.salaryRange || '';
  elements.searchExperience.value = jobSearch.experience || '';
  elements.searchEducation.value = jobSearch.education || '';
  setModelOptions(
    state.availableModels,
    preserveModelSelection ? elements.model.value : (ai.model || elements.model.value || FALLBACK_MODELS[0])
  );

  const masked = ai.apiKeyMasked || '';
  elements.apiKeyMask.textContent = masked
    ? `当前已保存：${masked}`
    : '当前还没有保存 API Key。';
}

function normalizeQrSrc(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  // 支持 HTTP/HTTPS URL
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw;
  }
  if (raw.startsWith('data:image/')) {
    return raw;
  }
  return `data:image/png;base64,${raw}`;
}

function humanizeLoginPhase(phase) {
  const key = String(phase || '').trim().toLowerCase();

  if (!key) {
    return { label: '未登录', tone: '', text: '准备就绪，随时可以开始登录。' };
  }

  if (key.includes('logged-in') || key.includes('logged_in') || key.includes('success')) {
    return { label: '已登录', tone: 'success', text: '登录成功，现在可以去开始求职。' };
  }

  if (
    key.includes('qr') ||
    key.includes('scan') ||
    key.includes('pending') ||
    key.includes('submitted') ||
    key.includes('waiting')
  ) {
    return { label: '等待扫码', tone: 'waiting', text: '请打开手机扫码，完成登录。' };
  }

  if (key.includes('not') || key.includes('idle') || key.includes('logout')) {
    return { label: '未登录', tone: '', text: '还没有登录，请点击“开始登录”。' };
  }

  if (key.includes('error') || key.includes('fail')) {
    return { label: '稍后重试', tone: 'error', text: '暂时无法获取登录状态，请稍后重试。' };
  }

  return { label: '状态更新中', tone: 'waiting', text: '登录状态正在更新，请稍候。' };
}

function renderLoginState(result = {}) {
  // 如果后端返回 isLoggedIn/is_logged_in，优先使用
  const actualPhase = result.isLoggedIn || result.is_logged_in ? 'logged-in' : result.phase;
  const phaseInfo = humanizeLoginPhase(actualPhase);
  const qrSrc = normalizeQrSrc(result.qrImageBase64) || state.loginQrSrc;

  if (normalizeQrSrc(result.qrImageBase64)) {
    state.loginQrSrc = normalizeQrSrc(result.qrImageBase64);
  }

  elements.loginPhaseBadge.textContent = phaseInfo.label;
  elements.loginPhaseBadge.className = 'status-badge';
  if (phaseInfo.tone) {
    elements.loginPhaseBadge.classList.add(phaseInfo.tone);
  }

  elements.loginStatusText.textContent = phaseInfo.text;

  if (phaseInfo.tone === 'success') {
    stopLoginPolling();
    elements.loginQrImage.hidden = true;
    elements.loginQrImage.removeAttribute('src');
    elements.loginQrPlaceholder.hidden = false;
    elements.loginQrPlaceholder.textContent = '已完成登录。';
    return;
  }

  if (qrSrc) {
    elements.loginQrImage.src = qrSrc;
    elements.loginQrImage.hidden = false;
    elements.loginQrPlaceholder.hidden = true;
    return;
  }

  elements.loginQrImage.hidden = true;
  elements.loginQrImage.removeAttribute('src');
  elements.loginQrPlaceholder.hidden = false;
  elements.loginQrPlaceholder.textContent = '点击“开始登录”获取二维码';
}

function renderLoginUnavailable() {
  elements.loginPhaseBadge.textContent = '稍后重试';
  elements.loginPhaseBadge.className = 'status-badge error';
  elements.loginStatusText.textContent = '暂时无法获取登录状态，请稍后再试。';
  elements.loginQrImage.hidden = true;
  elements.loginQrImage.removeAttribute('src');
  elements.loginQrPlaceholder.hidden = false;
  elements.loginQrPlaceholder.textContent = '二维码暂时不可用';
}

function applyManagerStatus(status) {
  const phase = String(status?.phase || '');
  const message = String(status?.message || '').trim();
  const visibleMessage = message || '暂时无法完成准备，请稍后重试。';

  if (elements.installNotice) {
    elements.installNotice.hidden = !(
      phase === 'not-installed' ||
      phase === 'installing' ||
      (phase === 'error' && message.includes('安装'))
    );
  }

  if (!message) {
    return;
  }

  if (phase === 'installing') {
    setStatus(elements.aiStatus, message);
    elements.loginPhaseBadge.textContent = '准备中';
    elements.loginPhaseBadge.className = 'status-badge waiting';
    elements.loginStatusText.textContent = visibleMessage;
    return;
  }

  if (phase === 'starting') {
    elements.loginPhaseBadge.textContent = '准备中';
    elements.loginPhaseBadge.className = 'status-badge waiting';
    elements.loginStatusText.textContent = visibleMessage;
    return;
  }

  if (phase === 'not-installed') {
    elements.loginPhaseBadge.textContent = '需要安装';
    elements.loginPhaseBadge.className = 'status-badge error';
    setStatus(elements.aiStatus, visibleMessage, 'error');
    elements.loginStatusText.textContent = visibleMessage;
    return;
  }

  if (phase === 'error') {
    setStatus(elements.aiStatus, visibleMessage, 'error');
    elements.loginPhaseBadge.textContent = '稍后重试';
    elements.loginPhaseBadge.className = 'status-badge error';
    elements.loginStatusText.textContent = visibleMessage;
  }
}

function pickJobValue(job, keys, fallback = '') {
  for (const key of keys) {
    const value = job?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return fallback;
}

function renderSearchResults(result) {
  const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
  const total = toBoundedInteger(result?.total, 0, 999999, jobs.length);

  if (jobs.length === 0) {
    elements.searchMeta.textContent = '暂时没有找到合适的岗位。';
    elements.searchResults.innerHTML = '<div class="empty-state">换一个关键词或城市，再试一次。</div>';
    return;
  }

  elements.searchMeta.textContent = `共找到 ${total} 个岗位，这里展示 ${jobs.length} 个。`;
  elements.searchResults.innerHTML = jobs.map((job) => {
    const title = escapeHtml(pickJobValue(job, ['title', 'jobName'], '职位信息待补充'));
    const company = escapeHtml(pickJobValue(job, ['companyName', 'company'], '公司信息待补充'));
    const salary = escapeHtml(pickJobValue(job, ['salaryRange', 'salary'], '薪资面议'));
    const tags = [
      pickJobValue(job, ['city'], ''),
      pickJobValue(job, ['experience'], ''),
      pickJobValue(job, ['education'], '')
    ].filter(Boolean);

    const tagHtml = tags.length > 0
      ? tags.map((tag) => `<span class="job-tag">${escapeHtml(tag)}</span>`).join('')
      : '<span class="job-tag">更多信息可进入详情页查看</span>';

    return `
      <article class="job-card">
        <div class="job-card-header">
          <div>
            <h4>${title}</h4>
            <p class="job-company">${company}</p>
          </div>
          <div class="job-salary">${salary}</div>
        </div>
        <div class="job-tags">${tagHtml}</div>
      </article>
    `;
  }).join('');
}

function formatRunnerTime(raw) {
  try {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleTimeString();
    }
  } catch (_error) {
    // ignore
  }
  return new Date().toLocaleTimeString();
}

function renderRunnerSnapshot(snapshot) {
  if (!snapshot) {
    return;
  }

  const { phase, stats = {}, lastAction, updatedAt } = snapshot;
  if (elements.runnerPhase) {
    elements.runnerPhase.textContent = `状态：${phase || '未运行'}`;
  }
  if (elements.runnerLastAction) {
    elements.runnerLastAction.textContent = stats.lastAction || lastAction || '无';
  }
  if (elements.runnerSearchCalls) {
    elements.runnerSearchCalls.textContent = String(stats.searchCalls ?? 0);
  }
  if (elements.runnerSelectedJobs) {
    elements.runnerSelectedJobs.textContent = String(stats.selectedJobs ?? 0);
  }
  if (elements.runnerGreetSuccess) {
    elements.runnerGreetSuccess.textContent = String(stats.greetSuccess ?? 0);
  }
  if (elements.runnerGreetFailed) {
    elements.runnerGreetFailed.textContent = String(stats.greetFailed ?? 0);
  }

}

function renderRunnerLogs() {
  if (!elements.runnerLog) {
    return;
  }

  if (state.runnerLogEntries.length === 0) {
    elements.runnerLog.innerHTML = '<p class="helper-text">启动任务后日志会在这里实时出现。</p>';
    return;
  }

  elements.runnerLog.innerHTML = state.runnerLogEntries.map((entry) => {
    const level = entry.level || 'info';
    const time = escapeHtml(formatRunnerTime(entry.time));
    const source = escapeHtml(entry.source || 'runner');
    const message = escapeHtml(entry.message || '-');
    return `<div class="runner-log-entry ${level}"><strong>${time}</strong> [${source}] ${message}</div>`;
  }).join('');
}

function appendRunnerLog(entry = {}) {
  const normalized = {
    level: String(entry.level || 'info').toLowerCase(),
    message: entry.message || entry.msg || '',
    source: entry.source || 'runner',
    time: entry.time || new Date().toISOString()
  };

  state.runnerLogEntries.unshift(normalized);
  state.runnerLogEntries = state.runnerLogEntries.slice(0, 40);
  renderRunnerLogs();
}

function clearRunnerLog() {
  state.runnerLogEntries = [];
  renderRunnerLogs();
}

function collectRunnerPayload() {
  return {
    jobSearch: collectSearchPayload()
  };
}

async function refreshRunnerSnapshot() {
  if (!window.desktopApi || typeof window.desktopApi.getRunnerSnapshot !== 'function') {
    return;
  }
  try {
    const snapshot = await window.desktopApi.getRunnerSnapshot();
    renderRunnerSnapshot(snapshot);
  } catch (error) {
    appendRunnerLog({
      level: 'error',
      message: `刷新 runner 状态失败：${error?.message || error}`,
      source: 'runner'
    });
  }
}

async function callRunnerApi(label, fn, payload) {
  if (!fn) {
    appendRunnerLog({
      level: 'error',
      message: `${label} 接口不可用`,
      source: 'renderer'
    });
    return;
  }

  try {
    const response = payload ? await fn(payload) : await fn();
    const snapshot = response?.snapshot || response;
    if (snapshot) {
      renderRunnerSnapshot(snapshot);
    }
    appendRunnerLog({
      level: 'info',
      message: `${label} 成功`,
      source: 'renderer'
    });
  } catch (error) {
    appendRunnerLog({
      level: 'error',
      message: `${label} 失败：${error?.message || error}`,
      source: 'renderer'
    });
  }
}

async function loadConfig() {
  try {
    const config = await window.desktopApi.getConfig();
    applyConfig(config);
  } catch (error) {
    reportError('loadConfig', error);
    setStatus(elements.aiStatus, '暂时无法读取本地设置。', 'error');
  }
}

async function saveAIConfig(event) {
  event?.preventDefault?.();
  if (state.silentSaveTimer) {
    clearTimeout(state.silentSaveTimer);
    state.silentSaveTimer = null;
  }

  const apiKey = elements.apiKey.value.trim();
  const apiKeyError = validateApiKey(apiKey);
  if (apiKeyError) {
    setStatus(elements.aiStatus, apiKeyError, 'error');
    return;
  }

  const payload = {
    ai: {
      model: elements.model.value
    }
  };

  if (apiKey) {
    payload.ai.apiKey = apiKey;
  }

  try {
    const saved = await window.desktopApi.saveConfig(payload);

    applyConfig(saved, { preserveModelSelection: true });
    await loadAvailableModels(elements.model.value);
    elements.apiKey.value = '';
    setStatus(elements.aiStatus, '已保存。', 'success');
  } catch (error) {
    reportError('saveAIConfig', error);
    setStatus(elements.aiStatus, '保存失败，请稍后重试。', 'error');
  }
}

function scheduleSilentSave() {
  if (state.silentSaveTimer) {
    clearTimeout(state.silentSaveTimer);
  }

  state.silentSaveTimer = setTimeout(() => {
    state.silentSaveTimer = null;
    saveAIConfigSilently();
  }, 120);
}

async function saveAIConfigSilently() {
  const apiKey = elements.apiKey.value.trim();
  const apiKeyError = validateApiKey(apiKey);
  if (apiKeyError) {
    setStatus(elements.aiStatus, apiKeyError, 'error');
    return;
  }

  const saveSeq = state.silentSaveSeq + 1;
  state.silentSaveSeq = saveSeq;

  try {
    const payload = {
      ai: {
        model: elements.model.value
      }
    };

    if (apiKey) {
      payload.ai.apiKey = apiKey;
    }

    await window.desktopApi.saveConfig(payload);
    const refreshed = await window.desktopApi.getConfig();
    if (saveSeq < state.appliedSilentSaveSeq) {
      return;
    }

    state.appliedSilentSaveSeq = saveSeq;
    applyConfig(refreshed, { preserveModelSelection: true });
    await loadAvailableModels(elements.model.value);
    setStatus(elements.aiStatus, '已自动保存。', 'success');
  } catch (error) {
    reportError('saveAIConfigSilently', error);
    setStatus(elements.aiStatus, '自动保存失败，请点击“保存”重试。', 'error');
  }
}

async function loadAvailableModels(preferredModel = '') {
  try {
    const currentModel = preferredModel || elements.model.value || FALLBACK_MODELS[0];
    const result = await window.desktopApi.getSiliconFlowModels();
    setModelOptions(result?.models || FALLBACK_MODELS, currentModel);
  } catch (error) {
    reportError('loadAvailableModels', error);
    setModelOptions(FALLBACK_MODELS, preferredModel || elements.model.value || FALLBACK_MODELS[0]);
  }
}

async function testConnection() {
  const payload = {
    model: elements.model.value
  };

  const apiKey = elements.apiKey.value.trim();
  if (apiKey) {
    payload.apiKey = apiKey;
  }

  setStatus(elements.aiStatus, '正在测试连接...');

  try {
    const result = await window.desktopApi.testSiliconFlowConnection(payload);
    if (result?.ok) {
      setStatus(elements.aiStatus, `连接成功，响应 ${result.latencyMs}ms。`, 'success');
      return;
    }

    setStatus(elements.aiStatus, result?.error || '连接失败，请稍后再试。', 'error');
  } catch (error) {
    reportError('testConnection', error);
    setStatus(elements.aiStatus, '连接失败，请检查 API Key。', 'error');
  }
}

async function refreshLoginStatus({ silent = false } = {}) {
  if (!silent) {
    elements.loginStatusText.textContent = '正在刷新登录状态...';
  }

  try {
    const result = await window.desktopApi.getMcpBossLoginStatus();
    if (result?.ok === false && result?.message) {
      applyManagerStatus({
        phase: result.phase,
        message: result.message
      });
      return result;
    }
    renderLoginState(result || {});
    return result;
  } catch (error) {
    reportError('refreshLoginStatus', error);
    if (!silent) {
      renderLoginUnavailable();
    }
    return null;
  }
}

function startLoginPolling() {
  stopLoginPolling();
  state.loginPollingCount = 0;

  state.loginPollingTimer = setInterval(async () => {
    state.loginPollingCount += 1;

    // 最多轮询 40 次（约 2 分钟）
    if (state.loginPollingCount > 40) {
      stopLoginPolling();
      elements.loginStatusText.textContent = '登录超时，请重新点击"开始登录"。';
      return;
    }

    try {
      const result = await window.desktopApi.getMcpBossLoginStatus();
      if (result?.ok === false && result?.message) {
        return;
      }

      const phase = String(result?.phase || '').toLowerCase();

      // 如果已登录成功，停止轮询
      if (phase.includes('logged-in') || phase.includes('logged_in') || phase.includes('success') || result?.isLoggedIn) {
        stopLoginPolling();
        renderLoginState(result || {});
        return;
      }

      // 如果状态变化，更新显示
      if (result?.qrImageBase64 && result.qrImageBase64 !== state.loginQrSrc) {
        renderLoginState(result || {});
      }
    } catch (error) {
      reportError('loginPolling', error);
    }
  }, 3000);
}

function stopLoginPolling() {
  if (state.loginPollingTimer) {
    clearInterval(state.loginPollingTimer);
    state.loginPollingTimer = null;
  }
  state.loginPollingCount = 0;
}

async function startLogin() {
  stopLoginPolling();
  elements.loginPhaseBadge.textContent = '等待扫码';
  elements.loginPhaseBadge.className = 'status-badge waiting';
  elements.loginStatusText.textContent = '正在获取二维码，请稍候...';

  try {
    const result = await window.desktopApi.requestMcpBossLoginQr();
    renderLoginState(result || {});

    // 如果二维码获取成功，开始自动轮询登录状态
    if (result?.qrImageBase64 || result?.phase) {
      startLoginPolling();
    }
  } catch (error) {
    reportError('startLogin', error);
    const message = error?.message || '暂时无法获取二维码，请稍后再试。';
    applyManagerStatus({
      phase: message.includes('安装') ? 'not-installed' : 'error',
      message
    });
    elements.loginQrImage.hidden = true;
    elements.loginQrImage.removeAttribute('src');
    elements.loginQrPlaceholder.hidden = false;
    elements.loginQrPlaceholder.textContent = '二维码暂时不可用';
  }
}

async function runSearch(event) {
  event.preventDefault();

  const payload = collectSearchPayload();
  setStatus(elements.searchStatus, '正在搜索...', 'normal');

  try {
    await window.desktopApi.saveConfig({
      jobSearch: payload
    });

    const result = await window.desktopApi.searchMcpBossJobs(payload);
    if (result?.ok === false) {
      const errorMessage = result.message || '搜索失败，请稍后重试。';
      reportError('runSearch', new Error(`search_jobs failed: ${errorMessage}`));
      elements.searchMeta.textContent = '暂时无法完成搜索。';
      elements.searchResults.innerHTML = '<div class="empty-state">搜索失败，请稍后再试。</div>';
      setStatus(elements.searchStatus, errorMessage, 'error');
      return;
    }
    renderSearchResults(result || {});

    const jobs = Array.isArray(result?.jobs) ? result.jobs : [];
    if (jobs.length > 0) {
      setStatus(elements.searchStatus, `已为你找到 ${jobs.length} 个岗位。`, 'success');
    } else {
      setStatus(elements.searchStatus, '暂时没有找到合适的岗位。');
    }
  } catch (error) {
    reportError('runSearch', error);
    elements.searchMeta.textContent = '暂时无法完成搜索。';
    elements.searchResults.innerHTML = '<div class="empty-state">搜索失败，请稍后再试。</div>';
    setStatus(elements.searchStatus, error?.message || '搜索失败，请稍后重试。', 'error');
  }
}

function bindEvents() {
  elements.tabButtons.forEach((button) => {
    button.addEventListener('click', () => switchTab(button.dataset.tab));
  });

  elements.aiConfigForm.addEventListener('submit', saveAIConfig);
  elements.testConnectionBtn.addEventListener('click', testConnection);
  elements.apiKey.addEventListener('blur', () => {
    scheduleSilentSave();
  });
  elements.model.addEventListener('change', () => {
    scheduleSilentSave();
  });
  elements.loginStartBtn.addEventListener('click', startLogin);
  elements.loginRefreshBtn.addEventListener('click', () => refreshLoginStatus());
  elements.searchForm.addEventListener('submit', runSearch);

  if (typeof window.desktopApi.onMcpBossStatus === 'function') {
    window.desktopApi.onMcpBossStatus((status) => {
      applyManagerStatus(status);
    });
  }

  if (elements.runnerStartBtn) {
    elements.runnerStartBtn.addEventListener('click', () => {
      callRunnerApi('开始任务', window.desktopApi?.startRunner?.bind(window.desktopApi));
    });
  }
  if (elements.runnerPauseBtn) {
    elements.runnerPauseBtn.addEventListener('click', () => {
      callRunnerApi('暂停任务', window.desktopApi?.pauseRunner?.bind(window.desktopApi));
    });
  }
  if (elements.runnerStopBtn) {
    elements.runnerStopBtn.addEventListener('click', () => {
      callRunnerApi('停止任务', window.desktopApi?.stopRunner?.bind(window.desktopApi));
    });
  }
  if (elements.runnerCycleBtn) {
    elements.runnerCycleBtn.addEventListener('click', () => {
      callRunnerApi(
        '执行一轮',
        window.desktopApi?.runnerRunCycle?.bind(window.desktopApi),
        collectRunnerPayload()
      );
    });
  }
  if (elements.runnerClearLogBtn) {
    elements.runnerClearLogBtn.addEventListener('click', clearRunnerLog);
  }

  if (typeof window.desktopApi?.onRunnerLog === 'function') {
    window.desktopApi.onRunnerLog((payload) => {
      appendRunnerLog(payload);
    });
  }

  if (typeof window.desktopApi?.onRunnerState === 'function') {
    window.desktopApi.onRunnerState((snapshot) => {
      renderRunnerSnapshot(snapshot);
    });
  }
}

async function init() {
  if (!window.desktopApi) {
    document.body.textContent = '当前页面暂时不可用。';
    return;
  }

  bindEvents();
  renderRunnerLogs();

  try {
    const version = await window.desktopApi.getAppVersion();
    elements.appVersion.textContent = `版本 ${version}`;
  } catch (error) {
    reportError('getAppVersion', error);
    elements.appVersion.textContent = '版本信息暂时不可用';
  }

  await loadConfig();
  await loadAvailableModels();
  try {
    const status = await window.desktopApi.getMcpBossStatus();
    applyManagerStatus(status);
  } catch (error) {
    reportError('getMcpBossStatus', error);
  }
  await refreshLoginStatus({ silent: true });
  await refreshRunnerSnapshot();
}

init().catch((error) => {
  reportError('init', error);
});
