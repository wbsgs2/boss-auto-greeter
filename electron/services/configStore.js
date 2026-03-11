const fs = require('node:fs');
const path = require('node:path');
const { safeStorage } = require('electron');

const ALLOWED_ENCRYPTION_MODES = new Set(['none', 'safeStorage', 'insecurePlaintext']);

const DEFAULT_CONFIG = {
  version: 1,
  ai: {
    provider: 'siliconflow',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEncrypted: '',
    apiKeyInsecure: '',
    encryptionMode: 'none',
    hasApiKey: false
  },
  preferences: {
    keyword: '',
    city: '',
    dailyGreetingLimit: 30,
    sendIntervalMinSec: 20,
    sendIntervalMaxSec: 45,
    autoPauseOnCaptcha: true
  },
  jobSearch: {
    keyword: '',
    city: '',
    salaryRange: '',
    experience: '',
    education: '',
    page: 1,
    pageSize: 20,
    sortBy: 'default'
  },
  runConfig: {
    dailyGreetingLimit: 30,
    sendIntervalMinSec: 20,
    sendIntervalMaxSec: 45,
    autoPauseOnCaptcha: true,
    dryRun: true,
    autoStartAfterSearch: false,
    maxJobsPerRun: 20,
    greetingTemplate: 'default'
  },
  mcpBoss: {
    remoteUrl: 'http://127.0.0.1:8000/mcp',
    command: '',
    args: [],
    cwd: ''
  }
};

function cloneDefaultConfig() {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function mergeConfig(base, incoming) {
  return {
    ...base,
    ...incoming,
    ai: { ...base.ai, ...(incoming?.ai || {}) },
    preferences: { ...base.preferences, ...(incoming?.preferences || {}) },
    jobSearch: { ...base.jobSearch, ...(incoming?.jobSearch || {}) },
    runConfig: { ...base.runConfig, ...(incoming?.runConfig || {}) },
    mcpBoss: { ...base.mcpBoss, ...(incoming?.mcpBoss || {}) }
  };
}

class ConfigStore {
  constructor(app) {
    this.app = app;
    this.config = cloneDefaultConfig();
    this.configPath = path.join(this.app.getPath('userData'), 'config.json');
  }

  load() {
    this.ensureDir();
    if (!fs.existsSync(this.configPath)) {
      this.config = cloneDefaultConfig();
      this.persist();
      return this.getPublicConfig();
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);
      this.config = this.normalizeConfig(parsed);
      this.persist();
    } catch (error) {
      const brokenPath = `${this.configPath}.broken-${Date.now()}.json`;
      try {
        fs.copyFileSync(this.configPath, brokenPath);
      } catch (copyError) {
        console.warn('[ConfigStore] Failed to backup broken config:', copyError);
      }
      this.config = cloneDefaultConfig();
      this.persist();
      console.warn('[ConfigStore] Config parse failed, reset to default:', error);
    }

    return this.getPublicConfig();
  }

  getPublicConfig() {
    const cloned = JSON.parse(JSON.stringify(this.config));
    const apiKey = this.getApiKey();
    cloned.ai.apiKeyMasked = this.maskApiKey(apiKey);
    delete cloned.ai.apiKey;
    delete cloned.ai.apiKeyEncrypted;
    delete cloned.ai.apiKeyInsecure;
    return cloned;
  }

  getFullConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  getApiKey() {
    if (!this.config.ai.hasApiKey) {
      return '';
    }

    if (this.config.ai.encryptionMode === 'safeStorage' && this.config.ai.apiKeyEncrypted) {
      try {
        const encrypted = Buffer.from(this.config.ai.apiKeyEncrypted, 'base64');
        return safeStorage.decryptString(encrypted);
      } catch (error) {
        console.error('[ConfigStore] Failed to decrypt API key:', error);
        return '';
      }
    }

    if (this.config.ai.encryptionMode === 'insecurePlaintext') {
      return this.config.ai.apiKeyInsecure || '';
    }

    return '';
  }

  save(payload = {}) {
    const incomingPayload = payload && typeof payload === 'object' ? payload : {};
    const hasApiKeyField = Boolean(
      incomingPayload.ai && Object.prototype.hasOwnProperty.call(incomingPayload.ai, 'apiKey')
    );
    const apiKeyValue = hasApiKeyField ? incomingPayload.ai.apiKey : undefined;
    const sanitizedPayload = this.pickAllowedPayload(incomingPayload);

    this.config = this.normalizeConfig(mergeConfig(this.config, sanitizedPayload));

    if (hasApiKeyField) {
      this.saveApiKey(apiKeyValue);
    }

    this.persist();
    return this.getPublicConfig();
  }

  pickAllowedPayload(payload) {
    const next = {};

    if (payload.ai && typeof payload.ai === 'object') {
      next.ai = {};
      if (Object.prototype.hasOwnProperty.call(payload.ai, 'provider')) {
        next.ai.provider = payload.ai.provider;
      }
      if (Object.prototype.hasOwnProperty.call(payload.ai, 'model')) {
        next.ai.model = payload.ai.model;
      }
      if (Object.prototype.hasOwnProperty.call(payload.ai, 'baseUrl')) {
        next.ai.baseUrl = payload.ai.baseUrl;
      }
    }

    if (payload.preferences && typeof payload.preferences === 'object') {
      next.preferences = {};
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'keyword')) {
        next.preferences.keyword = payload.preferences.keyword;
      }
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'city')) {
        next.preferences.city = payload.preferences.city;
      }
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'dailyGreetingLimit')) {
        next.preferences.dailyGreetingLimit = payload.preferences.dailyGreetingLimit;
      }
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'sendIntervalMinSec')) {
        next.preferences.sendIntervalMinSec = payload.preferences.sendIntervalMinSec;
      }
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'sendIntervalMaxSec')) {
        next.preferences.sendIntervalMaxSec = payload.preferences.sendIntervalMaxSec;
      }
      if (Object.prototype.hasOwnProperty.call(payload.preferences, 'autoPauseOnCaptcha')) {
        next.preferences.autoPauseOnCaptcha = payload.preferences.autoPauseOnCaptcha;
      }
    }

    if (payload.mcpBoss && typeof payload.mcpBoss === 'object') {
      next.mcpBoss = {};
      if (Object.prototype.hasOwnProperty.call(payload.mcpBoss, 'remoteUrl')) {
        next.mcpBoss.remoteUrl = payload.mcpBoss.remoteUrl;
      }
      if (Object.prototype.hasOwnProperty.call(payload.mcpBoss, 'command')) {
        next.mcpBoss.command = payload.mcpBoss.command;
      }
      if (Object.prototype.hasOwnProperty.call(payload.mcpBoss, 'args')) {
        next.mcpBoss.args = payload.mcpBoss.args;
      }
      if (Object.prototype.hasOwnProperty.call(payload.mcpBoss, 'cwd')) {
        next.mcpBoss.cwd = payload.mcpBoss.cwd;
      }
    }

    if (payload.jobSearch && typeof payload.jobSearch === 'object') {
      next.jobSearch = {};
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'keyword')) {
        next.jobSearch.keyword = payload.jobSearch.keyword;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'city')) {
        next.jobSearch.city = payload.jobSearch.city;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'salaryRange')) {
        next.jobSearch.salaryRange = payload.jobSearch.salaryRange;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'experience')) {
        next.jobSearch.experience = payload.jobSearch.experience;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'education')) {
        next.jobSearch.education = payload.jobSearch.education;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'page')) {
        next.jobSearch.page = payload.jobSearch.page;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'pageSize')) {
        next.jobSearch.pageSize = payload.jobSearch.pageSize;
      }
      if (Object.prototype.hasOwnProperty.call(payload.jobSearch, 'sortBy')) {
        next.jobSearch.sortBy = payload.jobSearch.sortBy;
      }
    }

    if (payload.runConfig && typeof payload.runConfig === 'object') {
      next.runConfig = {};
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'dailyGreetingLimit')) {
        next.runConfig.dailyGreetingLimit = payload.runConfig.dailyGreetingLimit;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'sendIntervalMinSec')) {
        next.runConfig.sendIntervalMinSec = payload.runConfig.sendIntervalMinSec;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'sendIntervalMaxSec')) {
        next.runConfig.sendIntervalMaxSec = payload.runConfig.sendIntervalMaxSec;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'autoPauseOnCaptcha')) {
        next.runConfig.autoPauseOnCaptcha = payload.runConfig.autoPauseOnCaptcha;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'dryRun')) {
        next.runConfig.dryRun = payload.runConfig.dryRun;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'autoStartAfterSearch')) {
        next.runConfig.autoStartAfterSearch = payload.runConfig.autoStartAfterSearch;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'maxJobsPerRun')) {
        next.runConfig.maxJobsPerRun = payload.runConfig.maxJobsPerRun;
      }
      if (Object.prototype.hasOwnProperty.call(payload.runConfig, 'greetingTemplate')) {
        next.runConfig.greetingTemplate = payload.runConfig.greetingTemplate;
      }
    }

    return next;
  }

  normalizeConfig(config = {}) {
    const merged = mergeConfig(cloneDefaultConfig(), config && typeof config === 'object' ? config : {});

    const ai = merged.ai || {};
    const preferences = merged.preferences || {};
    const jobSearch = merged.jobSearch || {};
    const runConfig = merged.runConfig || {};
    const mcpBoss = merged.mcpBoss || {};

    const normalized = {
      version: this.toBoundedInteger(merged.version, 1, 1, DEFAULT_CONFIG.version),
      ai: {
        provider: this.toSafeText(ai.provider, DEFAULT_CONFIG.ai.provider, 64),
        model: this.toSafeText(ai.model, DEFAULT_CONFIG.ai.model, 256),
        baseUrl: this.toSafeText(ai.baseUrl, DEFAULT_CONFIG.ai.baseUrl, 512),
        apiKeyEncrypted: typeof ai.apiKeyEncrypted === 'string' ? ai.apiKeyEncrypted : '',
        apiKeyInsecure: typeof ai.apiKeyInsecure === 'string' ? ai.apiKeyInsecure : '',
        encryptionMode: ALLOWED_ENCRYPTION_MODES.has(ai.encryptionMode) ? ai.encryptionMode : 'none',
        hasApiKey: Boolean(ai.hasApiKey)
      },
      preferences: {
        keyword: this.toOptionalText(preferences.keyword, 128),
        city: this.toOptionalText(preferences.city, 64),
        dailyGreetingLimit: this.toBoundedInteger(
          preferences.dailyGreetingLimit,
          1,
          500,
          DEFAULT_CONFIG.preferences.dailyGreetingLimit
        ),
        sendIntervalMinSec: this.toBoundedInteger(
          preferences.sendIntervalMinSec,
          1,
          120,
          DEFAULT_CONFIG.preferences.sendIntervalMinSec
        ),
        sendIntervalMaxSec: this.toBoundedInteger(
          preferences.sendIntervalMaxSec,
          1,
          300,
          DEFAULT_CONFIG.preferences.sendIntervalMaxSec
        ),
        autoPauseOnCaptcha: Boolean(preferences.autoPauseOnCaptcha)
      },
      jobSearch: {
        keyword: this.toOptionalText(
          jobSearch.keyword ?? preferences.keyword,
          128
        ),
        city: this.toOptionalText(
          jobSearch.city ?? preferences.city,
          64
        ),
        salaryRange: this.toOptionalText(jobSearch.salaryRange, 64),
        experience: this.toOptionalText(jobSearch.experience, 64),
        education: this.toOptionalText(jobSearch.education, 64),
        page: this.toBoundedInteger(jobSearch.page, 1, 100, DEFAULT_CONFIG.jobSearch.page),
        pageSize: this.toBoundedInteger(jobSearch.pageSize, 1, 100, DEFAULT_CONFIG.jobSearch.pageSize),
        sortBy: this.toSafeText(jobSearch.sortBy, DEFAULT_CONFIG.jobSearch.sortBy, 32)
      },
      runConfig: {
        dailyGreetingLimit: this.toBoundedInteger(
          runConfig.dailyGreetingLimit ?? preferences.dailyGreetingLimit,
          1,
          500,
          DEFAULT_CONFIG.runConfig.dailyGreetingLimit
        ),
        sendIntervalMinSec: this.toBoundedInteger(
          runConfig.sendIntervalMinSec ?? preferences.sendIntervalMinSec,
          1,
          120,
          DEFAULT_CONFIG.runConfig.sendIntervalMinSec
        ),
        sendIntervalMaxSec: this.toBoundedInteger(
          runConfig.sendIntervalMaxSec ?? preferences.sendIntervalMaxSec,
          1,
          300,
          DEFAULT_CONFIG.runConfig.sendIntervalMaxSec
        ),
        autoPauseOnCaptcha: Boolean(
          runConfig.autoPauseOnCaptcha ?? preferences.autoPauseOnCaptcha
        ),
        dryRun: Boolean(runConfig.dryRun ?? DEFAULT_CONFIG.runConfig.dryRun),
        autoStartAfterSearch: Boolean(
          runConfig.autoStartAfterSearch ?? DEFAULT_CONFIG.runConfig.autoStartAfterSearch
        ),
        maxJobsPerRun: this.toBoundedInteger(
          runConfig.maxJobsPerRun,
          1,
          200,
          DEFAULT_CONFIG.runConfig.maxJobsPerRun
        ),
        greetingTemplate: this.toSafeText(
          runConfig.greetingTemplate,
          DEFAULT_CONFIG.runConfig.greetingTemplate,
          32
        )
      },
      mcpBoss: {
        remoteUrl: this.toSafeText(mcpBoss.remoteUrl, DEFAULT_CONFIG.mcpBoss.remoteUrl, 512),
        command: this.toOptionalText(mcpBoss.command, 512),
        args: this.toStringArray(mcpBoss.args, 256, 50),
        cwd: this.toOptionalText(mcpBoss.cwd, 512)
      }
    };

    normalized.preferences.sendIntervalMaxSec = this.toBoundedInteger(
      normalized.preferences.sendIntervalMaxSec,
      normalized.preferences.sendIntervalMinSec,
      300,
      DEFAULT_CONFIG.preferences.sendIntervalMaxSec
    );
    normalized.runConfig.sendIntervalMaxSec = this.toBoundedInteger(
      normalized.runConfig.sendIntervalMaxSec,
      normalized.runConfig.sendIntervalMinSec,
      300,
      DEFAULT_CONFIG.runConfig.sendIntervalMaxSec
    );

    // Keep legacy `preferences` in sync to avoid breaking existing callers.
    normalized.preferences.keyword = normalized.jobSearch.keyword;
    normalized.preferences.city = normalized.jobSearch.city;
    normalized.preferences.dailyGreetingLimit = normalized.runConfig.dailyGreetingLimit;
    normalized.preferences.sendIntervalMinSec = normalized.runConfig.sendIntervalMinSec;
    normalized.preferences.sendIntervalMaxSec = normalized.runConfig.sendIntervalMaxSec;
    normalized.preferences.autoPauseOnCaptcha = normalized.runConfig.autoPauseOnCaptcha;

    if (!normalized.ai.hasApiKey || normalized.ai.encryptionMode === 'none') {
      normalized.ai.apiKeyEncrypted = '';
      normalized.ai.apiKeyInsecure = '';
      normalized.ai.encryptionMode = 'none';
      normalized.ai.hasApiKey = false;
      return normalized;
    }

    if (normalized.ai.encryptionMode === 'safeStorage') {
      normalized.ai.apiKeyInsecure = '';
      normalized.ai.hasApiKey = Boolean(normalized.ai.apiKeyEncrypted);
    }

    if (normalized.ai.encryptionMode === 'insecurePlaintext') {
      normalized.ai.apiKeyEncrypted = '';
      normalized.ai.hasApiKey = Boolean(normalized.ai.apiKeyInsecure);
    }

    if (!normalized.ai.hasApiKey) {
      normalized.ai.apiKeyEncrypted = '';
      normalized.ai.apiKeyInsecure = '';
      normalized.ai.encryptionMode = 'none';
    }

    return normalized;
  }

  saveApiKey(apiKeyRaw) {
    const apiKey = String(apiKeyRaw || '').trim();
    if (!apiKey) {
      this.config.ai.apiKeyEncrypted = '';
      this.config.ai.apiKeyInsecure = '';
      this.config.ai.encryptionMode = 'none';
      this.config.ai.hasApiKey = false;
      return;
    }

    let canUseSafeStorage = false;
    try {
      canUseSafeStorage = safeStorage.isEncryptionAvailable();
    } catch (error) {
      console.warn('[ConfigStore] Failed to check safeStorage availability:', error);
      canUseSafeStorage = false;
    }

    if (canUseSafeStorage) {
      try {
        const encryptedBuffer = safeStorage.encryptString(apiKey);
        this.config.ai.apiKeyEncrypted = encryptedBuffer.toString('base64');
        this.config.ai.apiKeyInsecure = '';
        this.config.ai.encryptionMode = 'safeStorage';
        this.config.ai.hasApiKey = true;
        return;
      } catch (error) {
        console.warn('[ConfigStore] safeStorage encrypt failed, fallback to plaintext:', error);
      }
    }

    // Linux/headless dev fallback: allow running, but mark it insecure explicitly.
    this.config.ai.apiKeyEncrypted = '';
    this.config.ai.apiKeyInsecure = apiKey;
    this.config.ai.encryptionMode = 'insecurePlaintext';
    this.config.ai.hasApiKey = true;
  }

  toBoundedInteger(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  toSafeText(value, fallback, maxLength) {
    if (typeof value !== 'string') {
      return fallback;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }
    return trimmed.slice(0, maxLength);
  }

  toOptionalText(value, maxLength) {
    if (typeof value !== 'string') {
      return '';
    }
    return value.trim().slice(0, maxLength);
  }

  toStringArray(value, maxItemLength, maxItems) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => this.toOptionalText(String(item), maxItemLength))
      .filter(Boolean)
      .slice(0, maxItems);
  }

  ensureDir() {
    fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
  }

  persist() {
    this.ensureDir();
    fs.writeFileSync(this.configPath, `${JSON.stringify(this.config, null, 2)}\n`, 'utf-8');
  }

  maskApiKey(apiKey) {
    if (!apiKey) {
      return '';
    }

    if (apiKey.length <= 8) {
      return `${apiKey.slice(0, 2)}****`;
    }

    return `${apiKey.slice(0, 4)}****${apiKey.slice(-4)}`;
  }
}

module.exports = {
  ConfigStore
};
