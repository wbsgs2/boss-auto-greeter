const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { app } = require('electron');

const SCRIPT_CANDIDATES = ['mcp_boss.py', 'boss_zhipin_fastmcp_v2.py'];
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py';

class McpBossManager extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.remoteUrl = 'http://127.0.0.1:8000/mcp';
    this.requestTimeoutMs = 30 * 1000;
    this.healthcheckTimeoutMs = 3 * 1000;
    this.startupWaitMs = 15 * 1000;
    this.sourceServicePath = '';
    this.servicePath = '';
    this.serviceScript = '';
    this.pythonRuntime = null;
    this.startingPromise = null;
    this.requestId = 0;
    this.mcpSessionId = null;
    this.status = {
      phase: 'stopped',
      message: '服务尚未启动',
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
    const nextRemoteUrl = remoteUrl || 'http://127.0.0.1:8000/mcp';
    if (this.remoteUrl !== nextRemoteUrl) {
      this.mcpSessionId = null;
    }
    this.sourceServicePath = String(config.path ?? config.cwd ?? '').trim();
    this.servicePath = '';
    this.serviceScript = '';
    this.lastConfig = this.buildLaunchConfig(config);
    this.remoteUrl = nextRemoteUrl;
    this.updateStatus({
      ...this.status,
      commandSummary: this.describeCommand(this.lastConfig)
    });
  }

  buildLaunchConfig(config = {}) {
    const detected = this.detectInstalledService(config);
    if (detected) {
      const runtime = this.pythonRuntime || {
        command: 'python',
        baseArgs: []
      };

      return {
        command: runtime.command,
        args: [...runtime.baseArgs, this.serviceScript],
        cwd: this.servicePath
      };
    }

    return {
      command: String(config.command || '').trim(),
      args: Array.isArray(config.args) ? config.args.map((item) => String(item)) : [],
      cwd: String(config.cwd || '').trim()
    };
  }

  describeCommand(config) {
    if (!config.command) {
      return '尚未检测到本地服务';
    }

    return [config.command, ...config.args].join(' ');
  }

  buildMissingServiceMessage(config = {}) {
    const candidates = this.resolveCandidateDirs(config);
    const searched = candidates.length > 0
      ? `已搜索目录：${candidates.join(' | ')}`
      : '未找到可搜索目录';

    return `当前安装包未包含登录服务，请重新安装应用。${searched}`;
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

    this.lastConfig = this.buildLaunchConfig(this.lastConfig);
    this.mcpSessionId = null;

    if (!this.lastConfig.command) {
      this.updateStatus({
        phase: 'not-installed',
        message: this.buildMissingServiceMessage(this.lastConfig),
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      return this.getStatus();
    }

    this.updateStatus({
      phase: 'starting',
      message: 'mcp-boss 服务启动中，请稍后重试',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    const spawnOptions = {
      cwd: this.lastConfig.cwd || process.cwd(),
      shell: process.platform === 'win32',
      env: this.buildProcessEnv()
    };

    try {
      this.child = spawn(this.lastConfig.command, this.lastConfig.args, spawnOptions);
      this.bindProcessEvents(this.child);
      this.updateStatus({
        phase: 'running',
        message: '本地服务已启动，正在等待连接',
        pid: this.child.pid || null,
        startedAt: new Date().toISOString(),
        commandSummary: this.describeCommand(this.lastConfig)
      });
    } catch (error) {
      this.child = null;
      this.updateStatus({
        phase: 'error',
        message: `启动失败：${error.message}`,
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
        message: `服务进程异常：${error.message}`,
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      this.mcpSessionId = null;
      this.child = null;
    });

    child.on('exit', (code, signal) => {
      if (this.child !== child) {
        return;
      }
      const message = signal
        ? `服务已停止（signal=${signal}）`
        : `服务已停止（code=${code}）`;
      this.updateStatus({
        phase: 'stopped',
        message,
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      this.mcpSessionId = null;
      this.child = null;
    });
  }

  stop() {
    if (!this.child) {
      this.mcpSessionId = null;
      this.updateStatus({
        phase: 'stopped',
        message: '服务已停止',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      return this.getStatus();
    }

    const child = this.child;

    this.updateStatus({
      phase: 'stopping',
      message: '正在停止服务...',
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
        message: `停止失败：${error.message}`,
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
    console.log('[mcp-boss] getLoginStatus called');
    const available = await this.ensureServiceAvailable({ autoStart: false });
    if (!available.ok) {
      console.log('[mcp-boss] getLoginStatus: service not available');
      return {
        ok: false,
        implemented: true,
        phase: available.phase || 'not-ready',
        message: available.message,
        managerStatus: this.getStatus()
      };
    }

    console.log('[mcp-boss] getLoginStatus: calling get_login_info_tool');
    const payload = await this.callRemoteMethod('get_login_info_tool');
    console.log('[mcp-boss] getLoginStatus payload:', JSON.stringify(payload, null, 2));

    const isLoggedIn = payload.is_logged_in || payload.isLoggedIn || false;
    const phase = isLoggedIn ? 'logged-in' : this.inferLoginPhase(payload, 'unknown');
    const message = this.pickText(
      [payload.message, payload.detail, payload.summary],
      '已调用 get_login_info()'
    );

    console.log('[mcp-boss] getLoginStatus result: isLoggedIn=', isLoggedIn, 'phase=', phase);

    return {
      ok: this.isRemoteSuccess(payload),
      implemented: true,
      isLoggedIn,
      phase,
      message,
      qrImageBase64: payload.image_url || payload.imageUrl || payload.qrImageBase64 || '',
      managerStatus: this.getStatus(),
      raw: payload
    };
  }

  async requestLoginQr() {
    await this.assertServiceAvailable({ autoStart: true });
    console.log('[mcp-boss] calling login_full_auto...');
    const payload = await this.callRemoteMethod('login_full_auto');
    console.log('[mcp-boss] login_full_auto raw payload type:', typeof payload);
    console.log('[mcp-boss] login_full_auto raw payload:', JSON.stringify(payload, null, 2));

    // 解析嵌套的 JSON 字符串
    let data = payload;

    // 如果 payload 是字符串，解析它
    if (typeof payload === 'string') {
      const parsed = this.safeJsonParse(payload);
      if (parsed !== null) {
        data = parsed;
        console.log('[mcp-boss] payload was string, parsed to:', JSON.stringify(data, null, 2));
      }
    }

    // 如果 payload 有 result 字段且是字符串，解析它
    if (data && typeof data === 'object' && data.result && typeof data.result === 'string') {
      const parsed = this.safeJsonParse(data.result);
      if (parsed !== null) {
        data = parsed;
        console.log('[mcp-boss] payload.result was string, parsed to:', JSON.stringify(data, null, 2));
      }
    }

    const phase = this.inferLoginPhase(data, 'submitted');
    const message = this.pickText(
      [data.message, data.detail, data.summary],
      '已调用 login_full_auto()'
    );

    const qrImageBase64 = this.pickText(
      [
        data.qrImageBase64,
        data.qrCodeBase64,
        data.qrcodeBase64,
        data.qr_code_base64,
        data.qr_code,
        data.qrcode,
        data.qrBase64,
        data.image_url,
        data.imageUrl
      ],
      ''
    );

    console.log('[mcp-boss] final qrImageBase64:', qrImageBase64);

    const result = {
      ok: this.isRemoteSuccess(data),
      implemented: true,
      phase,
      qrImageBase64,
      expiresInSec: this.pickNumber(
        [data.expiresInSec, data.expireSec, data.expires_in, data.ttl],
        0
      ),
      message,
      managerStatus: this.getStatus(),
      raw: data
    };
    console.log('[mcp-boss] requestLoginQr returning:', JSON.stringify(result, null, 2));
    return result;
  }

  async searchJobs(params = {}) {
    await this.assertServiceAvailable({ autoStart: true });
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

  async ensureServiceAvailable({ autoStart = true } = {}) {
    if (await this.isRemoteAccessible()) {
      if (this.status.phase === 'starting' || this.status.phase === 'running') {
        this.updateStatus({
          phase: 'running',
          message: '本地服务已就绪',
          pid: this.child?.pid || this.status.pid || null,
          startedAt: this.status.startedAt,
          commandSummary: this.describeCommand(this.lastConfig)
        });
      }

      return {
        ok: true,
        phase: 'ready',
        message: '本地服务已就绪'
      };
    }

    if (!autoStart) {
      return this.buildUnavailableResult();
    }

    if (!this.startingPromise) {
      this.startingPromise = this.installAndStartIfNeeded();
      this.startingPromise.finally(() => {
        this.startingPromise = null;
      });
    }

    try {
      await this.startingPromise;
      return {
        ok: true,
        phase: 'ready',
        message: '本地服务已就绪'
      };
    } catch (error) {
      return {
        ok: false,
        phase: this.status.phase || 'starting',
        message: error.message || 'mcp-boss 服务启动中，请稍后重试'
      };
    }
  }

  async assertServiceAvailable(options = {}) {
    const result = await this.ensureServiceAvailable(options);
    if (!result.ok) {
      throw new Error(result.message);
    }
  }

  buildUnavailableResult() {
    this.lastConfig = this.buildLaunchConfig(this.lastConfig);

    if (!this.lastConfig.command || !this.lastConfig.cwd) {
      return {
        ok: false,
        phase: 'not-installed',
        message: this.buildMissingServiceMessage(this.lastConfig)
      };
    }

    if (this.status.phase === 'starting') {
      return {
        ok: false,
        phase: 'starting',
        message: 'mcp-boss 服务启动中，请稍后重试'
      };
    }

    return {
      ok: false,
      phase: 'not-running',
      message: '本地服务暂时不可用，请稍后重试'
    };
  }

  async installAndStartIfNeeded() {
    try {
      this.lastConfig = this.buildLaunchConfig(this.lastConfig);

      if (!this.lastConfig.command || !this.lastConfig.cwd) {
        throw new Error(this.buildMissingServiceMessage(this.lastConfig));
      }

      await this.installService();
      this.lastConfig = this.buildLaunchConfig(this.lastConfig);
      return this.startAndWaitUntilAccessible();
    } catch (error) {
      this.updateStatus({
        phase: 'error',
        message: error.message || '准备本地服务失败',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });
      throw error;
    }
  }

  async installService() {
    this.ensureServiceWorkspace();
    this.updateStatus({
      phase: 'installing',
      message: '正在检测 Python...',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    const runtime = await this.detectPythonRuntime();
    await this.ensurePip(runtime);
    if (!(await this.hasRequiredPythonDeps(runtime))) {
      this.updateStatus({
        phase: 'installing',
        message: '正在安装依赖...',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });

      const pipArgs = [...runtime.baseArgs, '-m', 'pip', 'install'];
      if (!this.isEmbeddedRuntime(runtime)) {
        pipArgs.push('--user');
      }
      pipArgs.push('-r', 'requirements.txt');

      await this.runCommand(runtime.command, pipArgs, {
        cwd: this.servicePath,
        label: '安装依赖'
      });
    }

    if (!this.hasInstalledChromium()) {
      this.updateStatus({
        phase: 'installing',
        message: '正在安装浏览器组件...',
        pid: null,
        startedAt: null,
        commandSummary: this.describeCommand(this.lastConfig)
      });

      await this.runCommand(runtime.command, [...runtime.baseArgs, '-m', 'playwright', 'install', 'chromium'], {
        cwd: this.servicePath,
        label: '安装浏览器组件'
      });
    }

    this.pythonRuntime = runtime;
  }

  async startAndWaitUntilAccessible() {
    const current = this.start();
    if (current.phase === 'not-configured' || current.phase === 'error') {
      throw new Error(current.message);
    }

    if (await this.waitForRemoteAccessible(this.startupWaitMs)) {
      this.updateStatus({
        phase: 'running',
        message: '本地服务已就绪',
        pid: this.child?.pid || current.pid || null,
        startedAt: this.status.startedAt || current.startedAt || new Date().toISOString(),
        commandSummary: this.describeCommand(this.lastConfig)
      });
      return true;
    }

    if (this.status.phase === 'error' || this.status.phase === 'stopped') {
      throw new Error(this.status.message || '本地服务启动失败，请检查 mcp-boss 路径');
    }

    throw new Error('mcp-boss 服务启动中，请稍后重试');
  }

  async waitForRemoteAccessible(timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (await this.isRemoteAccessible()) {
        return true;
      }

      if (!this.child && this.status.phase !== 'starting' && this.status.phase !== 'running') {
        return false;
      }

      await this.sleep(500);
    }

    return false;
  }

  async isRemoteAccessible() {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.healthcheckTimeoutMs);

    try {
      const response = await fetch(this.remoteUrl, {
        method: 'GET',
        signal: controller.signal
      });
      return Boolean(response);
    } catch (_error) {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async detectPythonRuntime() {
    const candidates = process.platform === 'win32'
      ? [
        { command: 'python', baseArgs: [] },
        { command: 'py', baseArgs: ['-3'] }
      ]
      : [
        { command: 'python3', baseArgs: [] },
        { command: 'python', baseArgs: [] }
      ];

    for (const candidate of candidates) {
      if (await this.canRunPython(candidate.command, [...candidate.baseArgs, '--version'])) {
        this.pythonRuntime = candidate;
        return candidate;
      }
    }

    if (process.platform === 'win32') {
      const embedded = await this.installEmbeddedPython();
      this.pythonRuntime = embedded;
      return embedded;
    }

    throw new Error('未检测到可用的 Python 运行环境');
  }

  async canRunPython(command, args) {
    try {
      await this.runCommand(command, args, {
        cwd: this.servicePath || process.cwd(),
        label: '检测 Python',
        quiet: true
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  async installEmbeddedPython() {
    const runtimeDir = this.getManagedPythonRuntimeDir();
    const pythonExe = path.join(runtimeDir, 'python.exe');

    if (fs.existsSync(pythonExe)) {
      return {
        command: pythonExe,
        baseArgs: []
      };
    }

    fs.mkdirSync(runtimeDir, { recursive: true });

    this.updateStatus({
      phase: 'installing',
      message: '正在下载 Python...',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    const embeddedUrl = await this.fetchEmbeddedPythonUrl();
    const zipPath = path.join(runtimeDir, 'python-embed.zip');
    await this.downloadToFile(embeddedUrl, zipPath);

    this.updateStatus({
      phase: 'installing',
      message: '正在解压 Python...',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    await this.extractEmbeddedPython(zipPath, runtimeDir);
    this.configureEmbeddedPython(runtimeDir);

    return {
      command: pythonExe,
      baseArgs: []
    };
  }

  async fetchEmbeddedPythonUrl() {
    const response = await fetch('https://www.python.org/downloads/windows/');
    if (!response.ok) {
      throw new Error(`获取 Python 下载地址失败（HTTP ${response.status}）`);
    }

    const html = await response.text();
    const match = html.match(/https:\/\/www\.python\.org\/ftp\/python\/[^"' ]+\/python-[^"' ]+-embed-amd64\.zip/i)
      || html.match(/\/ftp\/python\/[^"' ]+\/python-[^"' ]+-embed-amd64\.zip/i);

    if (!match) {
      throw new Error('未找到可用的嵌入式 Python 下载地址');
    }

    if (match[0].startsWith('http')) {
      return match[0];
    }

    return `https://www.python.org${match[0]}`;
  }

  async downloadToFile(url, destination) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载文件失败（HTTP ${response.status}）`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, buffer);
  }

  async extractEmbeddedPython(zipPath, destination) {
    await this.runCommand('powershell', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destination.replace(/'/g, "''")}' -Force`
    ], {
      cwd: destination,
      label: '解压 Python'
    });
  }

  configureEmbeddedPython(runtimeDir) {
    const pthFile = fs.readdirSync(runtimeDir).find((name) => /^python\d+\._pth$/i.test(name));
    if (!pthFile) {
      return;
    }

    const pthPath = path.join(runtimeDir, pthFile);
    const raw = fs.readFileSync(pthPath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const nextLines = [];
    let hasSitePackages = false;

    for (const line of lines) {
      if (line.trim().toLowerCase() === 'lib\\site-packages') {
        hasSitePackages = true;
      }

      if (line.trim() === '#import site') {
        nextLines.push('import site');
        continue;
      }

      nextLines.push(line);
    }

    if (!hasSitePackages) {
      nextLines.splice(Math.max(nextLines.length - 1, 0), 0, 'Lib\\site-packages');
    }

    fs.writeFileSync(pthPath, `${nextLines.join('\n')}\n`, 'utf8');
  }

  async ensurePip(runtime) {
    if (await this.canRunPython(runtime.command, [...runtime.baseArgs, '-m', 'pip', '--version'])) {
      return;
    }

    this.updateStatus({
      phase: 'installing',
      message: '正在安装 pip...',
      pid: null,
      startedAt: null,
      commandSummary: this.describeCommand(this.lastConfig)
    });

    const getPipPath = path.join(this.getManagedPythonRuntimeDir(), 'get-pip.py');
    await this.downloadToFile(GET_PIP_URL, getPipPath);
    await this.runCommand(runtime.command, [...runtime.baseArgs, getPipPath], {
      cwd: path.dirname(getPipPath),
      label: '安装 pip'
    });
  }

  async hasRequiredPythonDeps(runtime) {
    const checkScript = [
      'import importlib.util, sys',
      "modules = ['fastmcp', 'requests', 'uvicorn', 'starlette', 'playwright']",
      "modules.append('Crypto')",
      'missing = [name for name in modules if importlib.util.find_spec(name) is None]',
      'sys.exit(0 if not missing else 1)'
    ].join('; ');

    try {
      await this.runCommand(runtime.command, [...runtime.baseArgs, '-c', checkScript], {
        cwd: this.servicePath || process.cwd(),
        label: '检测依赖',
        quiet: true
      });
      return true;
    } catch (_error) {
      return false;
    }
  }

  hasInstalledChromium() {
    const browsersPath = this.getPlaywrightBrowsersPath();

    try {
      if (!fs.existsSync(browsersPath) || !fs.statSync(browsersPath).isDirectory()) {
        return false;
      }

      return fs.readdirSync(browsersPath).some((name) => name.startsWith('chromium-'));
    } catch (_error) {
      return false;
    }
  }

  isEmbeddedRuntime(runtime) {
    const command = path.resolve(String(runtime?.command || ''));
    return command === path.resolve(path.join(this.getManagedPythonRuntimeDir(), 'python.exe'));
  }

  runCommand(command, args, { cwd, label, quiet = false }) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        cwd,
        shell: process.platform === 'win32',
        env: this.buildProcessEnv()
      });

      if (!quiet) {
        child.stdout?.on('data', (chunk) => {
          this.emit('log', {
            level: 'info',
            source: 'mcp-boss-installer',
            time: new Date().toISOString(),
            message: chunk.toString().trim()
          });
        });

        child.stderr?.on('data', (chunk) => {
          this.emit('log', {
            level: 'error',
            source: 'mcp-boss-installer',
            time: new Date().toISOString(),
            message: chunk.toString().trim()
          });
        });
      }

      child.on('error', (error) => {
        reject(new Error(`${label}失败：${error.message}`));
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(`${label}失败（code=${code}）`));
      });
    });
  }

  detectInstalledService(config = {}) {
    const candidates = this.resolveCandidateDirs(config);
    console.log('[mcp-boss] searching candidate directories:', candidates);

    for (const dir of candidates) {
      const script = this.findScriptInDir(dir);
      if (!script) {
        continue;
      }

      this.sourceServicePath = dir;
      this.servicePath = this.getManagedServiceRoot();
      this.serviceScript = script;
      console.log('[mcp-boss] found bundled service script:', {
        sourceServicePath: this.sourceServicePath,
        managedServicePath: this.servicePath,
        script: this.serviceScript
      });
      return true;
    }

    this.sourceServicePath = '';
    this.servicePath = '';
    this.serviceScript = '';
    console.warn('[mcp-boss] service script not found. searched directories:', candidates);
    return false;
  }

  resolveCandidateDirs(config = {}) {
    const values = new Set();
    const pushValue = (input) => {
      const text = String(input || '').trim();
      if (!text) {
        return;
      }
      values.add(path.resolve(text));
    };

    const appPath = this.getAppPathSafe();
    const serviceDir = __dirname;
    const projectRoot = path.resolve(serviceDir, '..', '..');
    const asarRoot = appPath ? path.resolve(appPath) : '';
    const packagedResourcesRoot = appPath ? path.resolve(appPath, '..') : '';

    pushValue(this.sourceServicePath);
    pushValue(this.servicePath);
    pushValue(config.path);
    pushValue(config.cwd);
    pushValue(process.env.MCP_BOSS_PATH);
    pushValue(appPath);
    pushValue(path.resolve(projectRoot, 'resources', 'mcp-boss'));
    pushValue(path.resolve(projectRoot, 'resources', 'mcp-bosszp'));
    pushValue(path.resolve(serviceDir, '..', '..', 'resources', 'mcp-boss'));
    pushValue(path.resolve(serviceDir, '..', '..', 'resources', 'mcp-bosszp'));
    pushValue(path.resolve(process.cwd(), 'resources', 'mcp-boss'));
    pushValue(path.resolve(process.cwd(), 'resources', 'mcp-bosszp'));
    pushValue(path.resolve(asarRoot, 'resources', 'mcp-boss'));
    pushValue(path.resolve(asarRoot, 'resources', 'mcp-bosszp'));
    pushValue(path.resolve(packagedResourcesRoot, 'mcp-boss'));
    pushValue(path.resolve(packagedResourcesRoot, 'mcp-bosszp'));
    pushValue(path.resolve(packagedResourcesRoot, 'resources', 'mcp-boss'));
    pushValue(path.resolve(packagedResourcesRoot, 'resources', 'mcp-bosszp'));
    pushValue(path.resolve(process.resourcesPath || '', 'mcp-boss'));
    pushValue(path.resolve(process.resourcesPath || '', 'mcp-bosszp'));
    pushValue(path.resolve(process.resourcesPath || '', 'resources', 'mcp-boss'));
    pushValue(path.resolve(process.resourcesPath || '', 'resources', 'mcp-bosszp'));

    return Array.from(values);
  }

  findScriptInDir(dir) {
    try {
      if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return '';
      }
    } catch (_error) {
      return '';
    }

    for (const filename of SCRIPT_CANDIDATES) {
      if (fs.existsSync(path.join(dir, filename))) {
        return filename;
      }
    }

    return '';
  }

  getAppPathSafe() {
    try {
      if (app?.isReady?.() && typeof app.getAppPath === 'function') {
        return app.getAppPath();
      }
    } catch (_error) {
      return '';
    }

    return '';
  }

  getManagedServiceRoot() {
    if (app?.isReady?.()) {
      return path.join(app.getPath('userData'), 'mcp-boss-runtime');
    }

    return path.resolve(process.cwd(), '.mcp-boss-runtime');
  }

  getManagedPythonRuntimeDir() {
    return path.join(this.getManagedServiceRoot(), '.python-runtime');
  }

  getPlaywrightBrowsersPath() {
    return path.join(this.getManagedServiceRoot(), '.playwright');
  }

  buildProcessEnv(extra = {}) {
    return {
      ...process.env,
      PLAYWRIGHT_BROWSERS_PATH: this.getPlaywrightBrowsersPath(),
      ...extra
    };
  }

  ensureServiceWorkspace() {
    if (!this.sourceServicePath) {
      return;
    }

    const source = this.sourceServicePath;
    const target = this.getManagedServiceRoot();
    console.log('[mcp-boss] syncing service workspace:', { source, target });
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(source, target, { recursive: true, force: true });
    this.servicePath = target;
  }

  async ensureMcpSession() {
    // 如果已经有 session ID，不需要初始化
    if (this.mcpSessionId) {
      return;
    }

    // 发送 initialize 请求来获取 session ID
    const initPayload = {
      jsonrpc: '2.0',
      id: this.nextRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: {
          name: 'boss-auto-greeter',
          version: '1.0.0'
        }
      }
    };

    try {
      const response = await this.postRemote(initPayload, 'initialize');
      console.log('[mcp-boss] initialize response:', response);
    } catch (error) {
      // 即使初始化失败，也尝试从响应头获取 session ID
      console.warn('[mcp-boss] initialize warning:', error.message);
    }

    // 如果服务器返回了 session ID，后续请求就可以使用了
    if (this.mcpSessionId) {
      console.log('[mcp-boss] session established:', this.mcpSessionId);
    }
  }

  async callRemoteMethod(name, params = {}) {
    // 确保已初始化 MCP session
    await this.ensureMcpSession();

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
    const sessionId = this.getOrCreateMcpSessionId();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.requestTimeoutMs);

    // 构建请求头，只有在有 session ID 时才添加
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream'
    };
    if (sessionId) {
      headers['Mcp-Session-Id'] = sessionId;
    }

    try {
      response = await fetch(this.remoteUrl, {
        method: 'POST',
        headers,
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

    this.captureMcpSessionIdFromResponse(response);

    // 处理 SSE 流式响应
    const text = await response.text();
    const json = this.parseMcpResponse(text, methodName);

    if (!response.ok) {
      const detail = this.extractErrorText(json) || text || `HTTP ${response.status}`;
      throw new Error(`mcp-boss ${methodName} HTTP ${response.status}: ${detail}`);
    }

    if (json === null) {
      throw new Error(`mcp-boss ${methodName} 返回了非 JSON 响应`);
    }

    return json;
  }

  getOrCreateMcpSessionId() {
    // 首次请求不发送 session ID，让服务器创建
    // 后续请求使用服务器返回的 session ID
    return this.mcpSessionId || '';
  }

  generateMcpSessionId() {
    // 不再客户端生成 session ID
    return '';
  }

  captureMcpSessionIdFromResponse(response) {
    const nextSessionId = response?.headers?.get('mcp-session-id')
      || response?.headers?.get('Mcp-Session-Id');

    if (nextSessionId) {
      this.mcpSessionId = nextSessionId;
    }
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
    let base = payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'result')
      ? payload.result
      : payload;

    // 如果 base 是字符串，尝试解析为 JSON
    if (typeof base === 'string') {
      const parsed = this.safeJsonParse(base);
      if (parsed !== null) {
        base = parsed;
      }
    }

    if (base && typeof base === 'object') {
      // 优先处理 structuredContent，但需要进一步解析内部的 result 字符串
      if (base.structuredContent && typeof base.structuredContent === 'object') {
        const sc = base.structuredContent;
        // 如果 structuredContent.result 是字符串，解析它
        if (sc.result && typeof sc.result === 'string') {
          const parsed = this.safeJsonParse(sc.result);
          if (parsed !== null) {
            return parsed;
          }
        }
        return sc;
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

    // 优先检查 login_step 字段（后端实际返回的格式）
    const loginStep = this.pickText(
      [
        payload.login_step,
        payload.loginStep,
        payload.phase,
        payload.status,
        payload.loginStatus,
        payload.login_status,
        payload.state
      ],
      ''
    );

    if (loginStep) {
      return loginStep;
    }

    const hasQr = Boolean(this.pickText(
      [
        payload.qrImageBase64,
        payload.qrCodeBase64,
        payload.qrcodeBase64,
        payload.qr_code_base64,
        payload.qr_code,
        payload.qrcode,
        payload.image_url,
        payload.imageUrl
      ],
      ''
    ));

    if (hasQr) {
      return 'qr-generated';
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

  parseMcpResponse(text, methodName) {
    if (typeof text !== 'string' || !text.trim()) {
      return null;
    }

    // 首先尝试直接解析为 JSON
    const directJson = this.safeJsonParse(text);
    if (directJson !== null) {
      return directJson;
    }

    // 尝试解析 SSE (Server-Sent Events) 格式
    // SSE 格式示例:
    // event: message
    // data: {"jsonrpc":"2.0",...}
    const lines = text.split('\n');
    let lastDataContent = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed.startsWith('data:')) {
        const dataContent = trimmed.slice(5).trim();
        if (dataContent && dataContent !== '[done]') {
          lastDataContent = dataContent;
          const parsed = this.safeJsonParse(dataContent);
          if (parsed !== null) {
            // 优先返回有 result 的响应（初始化响应或成功调用）
            if (parsed.result !== undefined) {
              return parsed;
            }
          }
        }
      }
    }

    // 如果找到了 JSON 数据，返回最后一个
    if (lastDataContent) {
      const parsed = this.safeJsonParse(lastDataContent);
      if (parsed !== null) {
        return parsed;
      }
    }

    // 尝试查找任何 JSON 对象
    const jsonMatches = text.match(/\{[\s\S]*?\}/g);
    if (jsonMatches) {
      for (const match of jsonMatches) {
        const parsed = this.safeJsonParse(match);
        if (parsed !== null && (parsed.result !== undefined || parsed.error !== undefined)) {
          return parsed;
        }
      }
      // 如果没有找到带 result/error 的，返回第一个有效 JSON
      for (const match of jsonMatches) {
        const parsed = this.safeJsonParse(match);
        if (parsed !== null) {
          return parsed;
        }
      }
    }

    return null;
  }

  nextRequestId() {
    this.requestId += 1;
    return `boss-auto-greeter-${this.requestId}`;
  }

  sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
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
