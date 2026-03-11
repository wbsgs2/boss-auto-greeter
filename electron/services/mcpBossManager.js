const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');

class McpBossManager extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.remoteUrl = 'http://127.0.0.1:8000/mcp';
    this.requestTimeoutMs = 30 * 1000;
    this.requestId = 0;
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
    const remoteUrl = String(config.remoteUrl || '').trim();
    this.lastConfig = {
      command: String(config.command || '').trim(),
      args: Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
      cwd: String(config.cwd || '').trim()
    };
    this.remoteUrl = remoteUrl || 'http://127.0.0.1:8000/mcp';
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
        implemented: true,
        methods: ['getLoginStatus', 'requestLoginQr']
      },
      search: {
        implemented: true,
        methods: ['searchJobs']
      },
      greeting: {
        implemented: false,
        methods: []
      }
    };
  }

  async getLoginStatus() {
    const payload = await this.callRemoteMethod('get_login_info');
    const phase = this.inferLoginPhase(payload, 'unknown');
    const message = this.pickText(
      [payload.message, payload.detail, payload.summary],
      '已调用 get_login_info()'
    );

    return {
      ok: this.isRemoteSuccess(payload),
      implemented: true,
      phase,
      message,
      managerStatus: this.getStatus(),
      raw: payload
    };
  }

  async requestLoginQr() {
    const payload = await this.callRemoteMethod('login_full_auto');
    const phase = this.inferLoginPhase(payload, 'submitted');
    const message = this.pickText(
      [payload.message, payload.detail, payload.summary],
      '已调用 login_full_auto()'
    );

    return {
      ok: this.isRemoteSuccess(payload),
      implemented: true,
      phase,
      qrImageBase64: this.pickText(
        [
          payload.qrImageBase64,
          payload.qrCodeBase64,
          payload.qrcodeBase64,
          payload.qr_code_base64,
          payload.qr_code,
          payload.qrcode,
          payload.qrBase64
        ],
        ''
      ),
      expiresInSec: this.pickNumber(
        [payload.expiresInSec, payload.expireSec, payload.expires_in, payload.ttl],
        0
      ),
      message,
      managerStatus: this.getStatus(),
      raw: payload
    };
  }

  async searchJobs(params = {}) {
    const query = this.normalizeSearchParams(params);
    const payload = await this.callRemoteMethod('search_jobs', query);
    const jobs = this.extractJobs(payload);
    const total = this.extractTotal(payload, jobs.length);

    return {
      ok: this.isRemoteSuccess(payload),
      implemented: true,
      jobs,
      total,
      query,
      message: this.pickText(
        [payload.message, payload.detail, payload.summary],
        `已调用 search_jobs()，返回 ${jobs.length} 条岗位`
      ),
      raw: payload
    };
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

  async callRemoteMethod(name, params = {}) {
    const toolPayload = {
      jsonrpc: '2.0',
      id: this.nextRequestId(),
      method: 'tools/call',
      params: {
        name,
        arguments: params
      }
    };

    let response = await this.postRemote(toolPayload, name);
    let rpcError = this.extractRpcError(response);

    if (this.isMethodNotFoundError(rpcError)) {
      response = await this.postRemote({
        jsonrpc: '2.0',
        id: this.nextRequestId(),
        method: name,
        params
      }, name);
      rpcError = this.extractRpcError(response);
    }

    if (rpcError) {
      throw new Error(`mcp-boss ${name} 调用失败: ${rpcError.message || 'unknown rpc error'}`);
    }

    return this.extractResponseData(response, name);
  }

  async postRemote(body, methodName) {
    let response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);

    try {
      response = await fetch(this.remoteUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream'
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`请求 ${this.remoteUrl} 超时（>${this.requestTimeoutMs}ms）`);
      }
      throw new Error(`无法连接 ${this.remoteUrl}: ${error.message}`);
    } finally {
      clearTimeout(timeoutId);
    }

    const text = await response.text();
    const json = this.safeJsonParse(text);

    if (!response.ok) {
      const detail = this.extractErrorText(json) || text || `HTTP ${response.status}`;
      throw new Error(`mcp-boss ${methodName} HTTP ${response.status}: ${detail}`);
    }

    if (json === null) {
      throw new Error(`mcp-boss ${methodName} 返回了非 JSON 响应`);
    }

    return json;
  }

  extractRpcError(payload) {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (payload.error && typeof payload.error === 'object') {
      return payload.error;
    }

    if (payload.result?.isError) {
      return {
        message: this.extractErrorText(payload.result) || 'mcp-boss 返回了错误结果'
      };
    }

    return null;
  }

  isMethodNotFoundError(error) {
    if (!error) {
      return false;
    }

    const code = Number(error.code);
    const message = String(error.message || '').toLowerCase();
    return code === -32601 || message.includes('method not found') || message.includes('unknown method');
  }

  extractResponseData(payload, methodName) {
    const base = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')
      ? payload.result
      : payload;

    if (base && typeof base === 'object') {
      if (base.structuredContent && typeof base.structuredContent === 'object') {
        return base.structuredContent;
      }

      if (base.data && typeof base.data === 'object') {
        return base.data;
      }

      if (Array.isArray(base.content)) {
        const jsonEntry = base.content.find((item) => item?.json && typeof item.json === 'object');
        if (jsonEntry) {
          return jsonEntry.json;
        }

        const textEntry = base.content.find((item) => typeof item?.text === 'string' && item.text.trim());
        if (textEntry) {
          const parsed = this.safeJsonParse(textEntry.text);
          if (parsed !== null) {
            return parsed;
          }
          return { message: textEntry.text };
        }
      }
    }

    if (base === null || base === undefined) {
      throw new Error(`mcp-boss ${methodName} 返回为空`);
    }

    return base;
  }

  extractJobs(payload) {
    const source = Array.isArray(payload)
      ? payload
      : payload.jobs || payload.items || payload.list || payload.results || payload.data || [];

    if (!Array.isArray(source)) {
      return [];
    }

    return source.map((job, index) => this.normalizeJob(job, index));
  }

  normalizeJob(job, index) {
    if (!job || typeof job !== 'object') {
      return {
        id: `job-${index + 1}`,
        title: String(job || ''),
        companyName: '',
        city: '',
        salaryRange: '',
        experience: '',
        education: '',
        source: 'mcp-boss'
      };
    }

    return {
      ...job,
      id: this.pickText([job.id, job.jobId, job.job_id], `job-${index + 1}`),
      title: this.pickText([job.title, job.jobName, job.job_name, job.positionName, job.position_name], ''),
      companyName: this.pickText(
        [job.companyName, job.company_name, job.company, job.brandName, job.brand_name],
        ''
      ),
      city: this.pickText([job.city, job.cityName, job.city_name, job.location], ''),
      salaryRange: this.pickText(
        [job.salaryRange, job.salary_range, job.salary, job.salaryDesc, job.salary_desc],
        ''
      ),
      experience: this.pickText([job.experience, job.experienceName, job.experience_name], ''),
      education: this.pickText([job.education, job.educationName, job.education_name], ''),
      source: this.pickText([job.source], 'mcp-boss')
    };
  }

  extractTotal(payload, fallback) {
    return this.pickNumber(
      [payload.total, payload.totalCount, payload.total_count, payload.count],
      fallback
    );
  }

  inferLoginPhase(payload, fallback) {
    if (this.pickBoolean([payload.loggedIn, payload.logged_in, payload.isLoggedIn], null) === true) {
      return 'logged-in';
    }

    if (this.pickBoolean([payload.loggedIn, payload.logged_in, payload.isLoggedIn], null) === false) {
      return 'not-logged-in';
    }

    if (this.pickText(
      [
        payload.phase,
        payload.status,
        payload.loginStatus,
        payload.login_status,
        payload.state
      ],
      ''
    )) {
      return this.pickText(
        [
          payload.phase,
          payload.status,
          payload.loginStatus,
          payload.login_status,
          payload.state
        ],
        fallback
      );
    }

    const hasQr = Boolean(this.pickText(
      [
        payload.qrImageBase64,
        payload.qrCodeBase64,
        payload.qrcodeBase64,
        payload.qr_code_base64,
        payload.qr_code,
        payload.qrcode
      ],
      ''
    ));

    if (hasQr) {
      return 'qr-ready';
    }

    return fallback;
  }

  isRemoteSuccess(payload) {
    if (payload === null || payload === undefined) {
      return false;
    }

    if (Array.isArray(payload)) {
      return true;
    }

    if (typeof payload !== 'object') {
      return true;
    }

    if (payload.ok === false || payload.success === false) {
      return false;
    }

    if (Object.keys(payload).length === 0) {
      return false;
    }

    return true;
  }

  extractErrorText(payload) {
    if (!payload || typeof payload !== 'object') {
      return '';
    }

    return this.pickText(
      [
        payload.message,
        payload.detail,
        payload.error_description,
        payload.error?.message,
        payload.result?.message
      ],
      ''
    );
  }

  safeJsonParse(text) {
    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }

    try {
      return JSON.parse(text);
    } catch (_error) {
      return null;
    }
  }

  nextRequestId() {
    this.requestId += 1;
    return `boss-auto-greeter-${this.requestId}`;
  }

  pickText(candidates, fallback) {
    for (const value of candidates) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          return trimmed;
        }
      }
    }
    return fallback;
  }

  pickNumber(candidates, fallback) {
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n)) {
        return n;
      }
    }
    return fallback;
  }

  pickBoolean(candidates, fallback) {
    for (const value of candidates) {
      if (typeof value === 'boolean') {
        return value;
      }
    }
    return fallback;
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
