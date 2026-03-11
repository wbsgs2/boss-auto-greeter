const { EventEmitter } = require('node:events');

const DEFAULT_STATS = Object.freeze({
  searchCalls: 0,
  searchedJobs: 0,
  selectedJobs: 0,
  greetSuccess: 0,
  greetFailed: 0,
  lastAction: '-'
});

class RunnerManager extends EventEmitter {
  constructor({ configStore, mcpBossManager, siliconFlowClient }) {
    super();
    this.configStore = configStore;
    this.mcpBossManager = mcpBossManager;
    this.siliconFlowClient = siliconFlowClient;

    this.phase = 'idle';
    this.stats = this.cloneStats();
    this.lastSearchResult = null;
    this.lastGreetingPreview = null;
    this.updatedAt = new Date().toISOString();
  }

  cloneStats() {
    return {
      searchCalls: DEFAULT_STATS.searchCalls,
      searchedJobs: DEFAULT_STATS.searchedJobs,
      selectedJobs: DEFAULT_STATS.selectedJobs,
      greetSuccess: DEFAULT_STATS.greetSuccess,
      greetFailed: DEFAULT_STATS.greetFailed,
      lastAction: DEFAULT_STATS.lastAction
    };
  }

  getSnapshot() {
    const clone = (value) => {
      if (value === null || value === undefined) {
        return null;
      }
      return JSON.parse(JSON.stringify(value));
    };

    return {
      phase: this.phase,
      stats: { ...this.stats },
      lastSearchResult: clone(this.lastSearchResult),
      lastGreetingPreview: clone(this.lastGreetingPreview),
      updatedAt: this.updatedAt
    };
  }

  start() {
    this.setPhase('running', '任务状态切换为 running');
    return this.getSnapshot();
  }

  pause() {
    this.setPhase('paused', '任务状态切换为 paused');
    return this.getSnapshot();
  }

  stop() {
    this.setPhase('stopped', '任务状态切换为 stopped');
    return this.getSnapshot();
  }

  async searchOnce(payload = {}) {
    const { jobSearch } = this.resolvePayload(payload);
    const result = await this.mcpBossManager.searchJobs(jobSearch);
    const jobs = Array.isArray(result.jobs) ? result.jobs : [];

    this.lastSearchResult = result;
    this.stats.searchCalls += 1;
    this.stats.searchedJobs += jobs.length;
    this.stats.lastAction = '搜索调用完成';

    this.touchState();
    this.emitState();
    this.emitLog('info', result.message || '搜索调用完成');

    return {
      ok: true,
      result,
      snapshot: this.getSnapshot()
    };
  }

  buildGreetingPreview(payload = {}) {
    const { jobSearch, runConfig } = this.resolvePayload(payload);
    const company = this.lastSearchResult?.jobs?.[0]?.companyName || '';

    const result = this.siliconFlowClient.buildGreetingDraft({
      keyword: jobSearch.keyword,
      city: jobSearch.city,
      greetingTemplate: runConfig.greetingTemplate,
      company
    });

    this.lastGreetingPreview = result;
    this.stats.lastAction = '打招呼预览生成完成';

    this.touchState();
    this.emitState();
    this.emitLog('info', `打招呼预览已生成（template=${result.template}）`);

    return {
      ok: true,
      result,
      snapshot: this.getSnapshot()
    };
  }

  async runCycle(payload = {}) {
    if (this.phase !== 'running') {
      return {
        ok: false,
        code: 'not-running',
        error: '当前状态不是 running，请先点击“开始”。',
        snapshot: this.getSnapshot()
      };
    }

    const { runConfig } = this.resolvePayload(payload);
    this.emitLog(
      'info',
      `执行骨架任务：dryRun=${runConfig.dryRun} maxJobsPerRun=${runConfig.maxJobsPerRun}`
    );

    const searchResponse = await this.searchOnce(payload);
    const searchResult = searchResponse.result;
    const jobs = Array.isArray(searchResult.jobs) ? searchResult.jobs : [];
    const selectedJobs = Math.min(jobs.length, runConfig.maxJobsPerRun);

    this.stats.selectedJobs += selectedJobs;
    this.stats.greetSuccess += runConfig.dryRun ? selectedJobs : 0;
    this.stats.greetFailed += runConfig.dryRun ? 0 : selectedJobs;
    this.stats.lastAction = '完成一轮骨架任务';

    const greetingResponse = this.buildGreetingPreview(payload);
    this.stats.lastAction = '完成一轮骨架任务';

    if (runConfig.autoStartAfterSearch) {
      this.emitLog('info', '已开启“搜索后自动进入发送阶段（预留）”，当前仍为骨架流程。');
    }

    this.touchState();
    this.emitState();

    return {
      ok: true,
      result: {
        searchResult,
        greetingPreview: greetingResponse.result
      },
      snapshot: this.getSnapshot()
    };
  }

  resolvePayload(payload = {}) {
    const fullConfig = this.configStore.getFullConfig();
    const input = payload && typeof payload === 'object' ? payload : {};

    const baseJobSearch = this.normalizeSearch(fullConfig.jobSearch || {});
    const baseRunConfig = this.normalizeRunConfig(fullConfig.runConfig || {});

    return {
      jobSearch: this.normalizeSearch({ ...baseJobSearch, ...(input.jobSearch || {}) }),
      runConfig: this.normalizeRunConfig({ ...baseRunConfig, ...(input.runConfig || {}) })
    };
  }

  normalizeSearch(input = {}) {
    return {
      keyword: this.toOptionalText(input.keyword, 128),
      city: this.toOptionalText(input.city, 64),
      salaryRange: this.toOptionalText(input.salaryRange, 64),
      experience: this.toOptionalText(input.experience, 64),
      education: this.toOptionalText(input.education, 64),
      page: this.toBoundedInteger(input.page, 1, 100, 1),
      pageSize: this.toBoundedInteger(input.pageSize, 1, 100, 20),
      sortBy: this.toSafeText(input.sortBy, 'default', 32)
    };
  }

  normalizeRunConfig(input = {}) {
    const minSec = this.toBoundedInteger(input.sendIntervalMinSec, 1, 120, 20);
    return {
      dailyGreetingLimit: this.toBoundedInteger(input.dailyGreetingLimit, 1, 500, 30),
      sendIntervalMinSec: minSec,
      sendIntervalMaxSec: this.toBoundedInteger(input.sendIntervalMaxSec, minSec, 300, 45),
      autoPauseOnCaptcha: Boolean(input.autoPauseOnCaptcha),
      dryRun: Boolean(input.dryRun ?? true),
      autoStartAfterSearch: Boolean(input.autoStartAfterSearch),
      maxJobsPerRun: this.toBoundedInteger(input.maxJobsPerRun, 1, 200, 20),
      greetingTemplate: this.toSafeText(input.greetingTemplate, 'default', 32)
    };
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

  setPhase(nextPhase, logMessage) {
    if (this.phase !== nextPhase) {
      this.phase = nextPhase;
      this.stats.lastAction = `状态切换为 ${nextPhase}`;
      this.touchState();
      this.emitState();
    }
    if (logMessage) {
      this.emitLog('info', logMessage);
    }
  }

  touchState() {
    this.updatedAt = new Date().toISOString();
  }

  emitState() {
    this.emit('state', this.getSnapshot());
  }

  emitLog(level, message) {
    this.emit('log', {
      level,
      source: 'runner',
      time: new Date().toISOString(),
      message
    });
  }
}

module.exports = {
  RunnerManager
};
