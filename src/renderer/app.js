const state = {
  loginQrSrc: ''
};

const FALLBACK_MODELS = [
  'Qwen/Qwen2.5-7B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'deepseek-ai/DeepSeek-V2.5'
];

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

function setModelOptions(models, selectedModel = '') {
  const options = Array.from(new Set(
    (Array.isArray(models) && models.length > 0 ? models : FALLBACK_MODELS)
      .map((item) => String(item || '').trim())
      .filter(Boolean)
  ));

  elements.model.innerHTML = options
    .map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`)
    .join('');

  elements.model.value = options.includes(selectedModel) ? selectedModel : (options[0] || FALLBACK_MODELS[0]);
}

function applyConfig(config) {
  const ai = config?.ai || {};
  const jobSearch = config?.jobSearch || {};
  const preferences = config?.preferences || {};

  elements.searchKeyword.value = jobSearch.keyword ?? preferences.keyword ?? '';
  elements.searchCity.value = jobSearch.city ?? preferences.city ?? '';
  elements.searchSalary.value = jobSearch.salaryRange || '';
  elements.searchExperience.value = jobSearch.experience || '';
  elements.searchEducation.value = jobSearch.education || '';
  setModelOptions(FALLBACK_MODELS, ai.model || FALLBACK_MODELS[0]);

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
  const phaseInfo = humanizeLoginPhase(result.phase);
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
    elements.loginStatusText.textContent = '首次使用需要准备环境，请稍后。';
    return;
  }

  if (phase === 'starting') {
    elements.loginPhaseBadge.textContent = '准备中';
    elements.loginPhaseBadge.className = 'status-badge waiting';
    elements.loginStatusText.textContent = '正在准备登录环境，请稍后重试。';
    return;
  }

  if (phase === 'not-installed') {
    elements.loginPhaseBadge.textContent = '需要安装';
    elements.loginPhaseBadge.className = 'status-badge error';
    elements.loginStatusText.textContent = '请先安装登录助手，安装链接已显示在 AI 配置页。';
    return;
  }

  if (phase === 'error') {
    setStatus(elements.aiStatus, '暂时无法完成准备，请稍后重试。', 'error');
    elements.loginPhaseBadge.textContent = '稍后重试';
    elements.loginPhaseBadge.className = 'status-badge error';
    elements.loginStatusText.textContent = '暂时无法完成准备，请稍后重试。';
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

  const apiKey = elements.apiKey.value.trim();
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

    applyConfig(saved);
    await loadAvailableModels();
    elements.apiKey.value = '';
    setStatus(elements.aiStatus, '已保存。', 'success');
  } catch (error) {
    reportError('saveAIConfig', error);
    setStatus(elements.aiStatus, '保存失败，请稍后重试。', 'error');
  }
}

async function saveAIConfigSilently() {
  try {
    const payload = {
      ai: {
        model: elements.model.value
      }
    };

    if (elements.apiKey.value.trim()) {
      payload.ai.apiKey = elements.apiKey.value.trim();
    }

    await window.desktopApi.saveConfig(payload);
    const refreshed = await window.desktopApi.getConfig();
    applyConfig(refreshed);
    await loadAvailableModels();

    if (elements.apiKey.value.trim()) {
      elements.apiKey.value = '';
    }
  } catch (error) {
    reportError('saveAIConfigSilently', error);
  }
}

async function loadAvailableModels() {
  try {
    const currentModel = elements.model.value || FALLBACK_MODELS[0];
    const result = await window.desktopApi.getSiliconFlowModels();
    setModelOptions(result?.models || FALLBACK_MODELS, currentModel);
  } catch (error) {
    reportError('loadAvailableModels', error);
    setModelOptions(FALLBACK_MODELS, elements.model.value || FALLBACK_MODELS[0]);
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
      return;
    }
    renderLoginState(result || {});
  } catch (error) {
    reportError('refreshLoginStatus', error);
    if (!silent) {
      renderLoginUnavailable();
    }
  }
}

async function startLogin() {
  elements.loginPhaseBadge.textContent = '等待扫码';
  elements.loginPhaseBadge.className = 'status-badge waiting';
  elements.loginStatusText.textContent = '正在获取二维码，请稍候...';

  try {
    const result = await window.desktopApi.requestMcpBossLoginQr();
    renderLoginState(result || {});
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
    saveAIConfigSilently();
  });
  elements.model.addEventListener('change', () => {
    saveAIConfigSilently();
  });
  elements.loginStartBtn.addEventListener('click', startLogin);
  elements.loginRefreshBtn.addEventListener('click', () => refreshLoginStatus());
  elements.searchForm.addEventListener('submit', runSearch);

  if (typeof window.desktopApi.onMcpBossStatus === 'function') {
    window.desktopApi.onMcpBossStatus((status) => {
      applyManagerStatus(status);
    });
  }
}

async function init() {
  if (!window.desktopApi) {
    document.body.textContent = '当前页面暂时不可用。';
    return;
  }

  bindEvents();

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
}

init().catch((error) => {
  reportError('init', error);
});
