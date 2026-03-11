# BOSS Auto Greeter

> Windows 优先的本地桌面应用骨架（Electron），用于后续迭代 BOSS 自动求职流程

## 当前阶段

当前仓库已落地下列可开发、可迭代的桌面应用骨架能力（第一阶段 + 第二部分最小骨架）：
- Electron 主进程 / preload / 渲染进程基础结构
- 3 个基础页面区域：AI 配置、BOSS 登录、自动求职控制台
- 本地配置存储骨架（包含 API Key 敏感字段处理）
- 本地 `mcp-boss` 进程管理骨架（启动/停止/状态/日志）
- SiliconFlow 测试连接骨架（OpenAI 兼容接口风格）
- 自动求职控制台最小业务骨架（岗位搜索参数 UI、任务运行配置 UI、控制台状态统计）
- `mcp-boss` 登录/搜索接口预留层（IPC + preload + service 占位实现）

## 技术栈

- Electron（Windows 第一版）
- 原生 HTML/CSS/JS（最小可用、稳定优先）
- 本地 JSON 配置存储（`app.getPath('userData')/config.json`）

## 快速开始

### 环境要求

- Node.js 18+
- npm 9+
- Windows 10/11（目标运行平台）

### 安装依赖

```bash
npm install
```

### 启动开发模式

```bash
npm run dev
```

### 其他脚本

```bash
# 全量语法检查（递归扫描 electron/、src/、scripts/ 下的 .js/.cjs/.mjs 文件）
npm run check

# 核心入口快速检查（主进程 / preload / 渲染入口）
npm run check:core

# 构建命令（当前未接入打包，执行会提示并返回非 0，避免误判为已构建）
npm run build
```

## 工程结构

```text
boss-auto-greeter/
  electron/
    main.js                       # 主进程入口
    preload.js                    # 安全桥接 IPC
    ipc/registerHandlers.js       # IPC handler 注册
    services/
      configStore.js              # 本地配置存储 + API Key 加密
      mcpBossManager.js           # 本地 mcp-boss 进程管理骨架
      siliconFlowClient.js        # SiliconFlow 测试连接骨架
  src/renderer/
    index.html                    # UI 骨架页面
    app.js                        # 渲染层交互逻辑
    styles.css                    # 样式
  PRD.md
  docs/
```

## 配置与安全说明

- API Key 不会写死在代码中。
- 主进程优先使用 Electron `safeStorage` 存储 API Key。
- 若当前系统环境不支持 `safeStorage`（常见于部分 Linux/headless 开发环境），会降级为明文保存并在 UI 中明确提示，仅用于开发调试。
- 第一阶段暂保持 `sandbox: false`，用于兼容当前 preload 调试流程；后续在 IPC 面收敛后切换为 `sandbox: true`。

## mcp-boss 骨架说明

当前版本实现了进程管理层 + 登录/搜索接口预留层：
- 在 “BOSS 登录” 页填写启动命令、参数、工作目录
- 点击启动/停止进行本地进程管理
- 可查看实时状态和输出日志
- 可调用“登录状态/二维码/岗位搜索”占位接口，返回预留结果

当前仍未接入真实二维码登录、登录态同步、岗位搜索、自动打招呼发送流程，后续迭代接入。

## 文档

- [产品需求文档 (PRD)](./PRD.md)
- [系统架构设计](./docs/architecture.md)
- [MVP 范围定义](./docs/mvp-scope.md)
