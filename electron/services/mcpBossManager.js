const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

class McpBossManager extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.status = {
      phase: 'stopped',
      message: 'mcp-boss not started',
      pid: null,
      startedAt: null,
      commandSummary: ''
    };
    this.lastConfig = {
      command: '',
      args: [],
      cwd: ''
    };
  }

  configure(config = {}) {
    this.lastConfig = {
      command: String(config.command || '').trim(),
      args: Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
      cwd: String(config.cwd || '').trim()
    };
    this.updateStatus({
      ...this.status,
      commandSummary: this.describeCommand(this.lastConfig)
    });
  }

  describeCommand(config) {
    if (!config.command) {
      return '未配置 mcp-boss 命令';
    }

    return [config.command, ...config.args].join(' ');
  }

  getStatus() {
    return {
      ...this.status,
      commandSummary: this.describeCommand(this.lastConfig)
    };
  }

  start() {
    if (this.child) {
      return this.getStatus();
    }

    if (!this.lastConfig.command) {
      this.updateStatus({
        phase: 'not-configured',
        message: '请先在 BOSS 登录页配置 mcp-boss 启动命令',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      return this.getStatus();
    }

    this.updateStatus({
      phase: 'starting',
      message: 'mcp-boss starting...',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    const spawnOptions = {
      cwd: this.lastConfig.cwd || process.cwd(),
      shell: process.platform === 'win32',
      env: process.env
    };

    try {
      this.child = spawn(this.lastConfig.command, this.lastConfig.args, spawnOptions);
      this.bindProcessEvents(this.child);
      this.updateStatus({
        phase: 'running',
        message: 'mcp-boss is running',
        pid: this.child.pid || null,
        startedAt: new Date().toISOString(),
        commandSummary: this.describeCommand(this.lastConfig)
      });
    } catch (error) {
      this.child = null;
      this.updateStatus({
        phase: 'error',
        message: `mcp-boss start failed: ${error.message}`,
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
    }

    return this.getStatus();
  }

  bindProcessEvents(child) {
    child.stdout?.on('data', (chunk) => {
      this.emit('log', {
        level: 'info',
        source: 'mcp-boss',
        time: new Date().toISOString(),
        message: chunk.toString().trim()
      });
    });

    child.stderr?.on('data', (chunk) => {
      this.emit('log', {
        level: 'error',
        source: 'mcp-boss',
        time: new Date().toISOString(),
        message: chunk.toString().trim()
      });
    });

    child.on('error', (error) => {
      if (this.child !== child) {
        return;
      }
      this.updateStatus({
        phase: 'error',
        message: `mcp-boss process error: ${error.message}`,
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      this.child = null;
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) {
        return;
      }
      const message = signal
        ? `mcp-boss exited by signal: ${signal}`
        : `mcp-boss exited with code: ${code}`;
      this.updateStatus({
        phase: 'stopped',
        message,
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      this.child = null;
    });
  }

  stop() {
    if (!this.child) {
      this.updateStatus({
        phase: 'stopped',
        message: 'mcp-boss is already stopped',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      return this.getStatus();
    }

    const child = this.child;

    this.updateStatus({
      phase: 'stopping',
      message: 'mcp-boss stopping...',
      pid: child.pid || null,
      startedAt: this.status.startedAt,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    try {
      const signal = process.platform === 'win32' ? undefined : 'SIGTERM';
      if (signal) {
        child.kill(signal);
      } else {
        child.kill();
      }
    } catch (error) {
      this.updateStatus({
        phase: 'error',
        message: `mcp-boss stop failed: ${error.message}`,
        pid: child.pid || null,
        startedAt: this.status.startedAt,
        commandSummary: this.describeCommand(this.lastConfig)
      });
    }

    return this.getStatus();
  }

  getAdapterCapabilities() {
    return {
      login: {
        implemented: false,
        methods: ['getLoginStatus', 'requestLoginQr']
      },
      search: {
        implemented: false,
        methods: ['searchJobs']
      },
      greeting: {
        implemented: false,
        methods: []
      }
    };
  }

  getLoginStatus() {
    return {
      ok: true,
      implemented: false,
      phase: 'pending-integration',
      message: '登录状态查询接口已预留，待接入 mcp-boss login_full_auto() 相关流程。',
      managerStatus: this.getStatus()
    };
  }

  requestLoginQr() {
    return {
      ok: true,
      implemented: false,
      phase: 'pending-integration',
      qrImageBase64: '',
      expiresInSec: 0,
      message: '二维码请求接口已预留，当前仅返回占位结果。'
    };
  }

  searchJobs(params = {}) {
    const query = this.normalizeSearchParams(params);
    const mockResult = this.buildMockJobs(query);

    return {
      ok: true,
      implemented: false,
      jobs: mockResult.jobs,
      total: mockResult.total,
      query,
      message: '岗位搜索接口为占位实现，当前返回本地模拟数据（未调用 mcp-boss search_jobs()）。'
    };
  }

  buildMockJobs(query) {
    const total = 37;
    const start = (query.page - 1) * query.pageSize;

    if (start >= total) {
      return {
        total,
        jobs: []
      };
    }

    const end = Math.min(total, start + query.pageSize);
    const jobs = [];

    for (let i = start; i < end; i += 1) {
      jobs.push(this.buildMockJob(i, query));
    }

    return {
      total,
      jobs
    };
  }

  buildMockJob(index, query) {
    const companyPool = ['星河科技', '北辰数据', '跃迁智能', '云帆网络', '火花系统'];
    const expPool = ['不限', '1-3年', '3-5年', '5-10年'];
    const eduPool = ['大专', '本科', '硕士'];

    const titleKeyword = query.keyword || '产品工程师';
    const city = query.city || '全国';
    const salaryRange = query.salaryRange || `${14 + (index % 10)}-${24 + (index % 12)}K`;
    const experience = query.experience || expPool[index % expPool.length];
    const education = query.education || eduPool[index % eduPool.length];
    const companyName = `${companyPool[index % companyPool.length]}${(index % 3) + 1}号团队`;
    const seq = index + 1;

    return {
      id: this.buildMockId(seq, query),
      title: `${titleKeyword}（占位）`,
      companyName,
      city,
      salaryRange,
      experience,
      education,
      source: 'mcp-boss-placeholder',
      createdAt: new Date(Date.now() - index * 45 * 60 * 1000).toISOString()
    };
  }

  buildMockId(seq, query) {
    const keyword = this.toSlug(query.keyword, 'job', 24);
    const city = this.toSlug(query.city, 'city', 16);
    return `mock-${city}-${keyword}-${seq}`;
  }

  toSlug(value, fallback, maxLength) {
    const raw = String(value || '').trim();
    const normalized = raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength);

    if (normalized) {
      return normalized;
    }

    const hash = Array.from(raw || fallback).reduce((acc, char) => {
      return ((acc * 31) + char.charCodeAt(0)) >>> 0;
    }, 7).toString(36);

    return `${fallback}-${hash}`.slice(0, maxLength);
  }

  normalizeSearchParams(params = {}) {
    const input = params && typeof params === 'object' ? params : {};
    return {
      keyword: String(input.keyword || '').trim(),
      city: String(input.city || '').trim(),
      salaryRange: String(input.salaryRange || '').trim(),
      experience: String(input.experience || '').trim(),
      education: String(input.education || '').trim(),
      page: this.toBoundedInteger(input.page, 1, 100, 1),
      pageSize: this.toBoundedInteger(input.pageSize, 1, 100, 20),
      sortBy: String(input.sortBy || 'default').trim() || 'default'
    };
  }

  toBoundedInteger(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  updateStatus(nextStatus) {
    this.status = { ...nextStatus };
    this.emit('status', this.getStatus());
  }
}

module.exports = {
  McpBossManager
};
