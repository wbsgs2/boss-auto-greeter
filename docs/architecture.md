# 系统架构设计

## 1. 选型结论

第一版固定采用以下方案：
- **平台**：Windows 优先
- **桌面壳**：Electron
- **BOSS 能力层**：本地运行 `mcp-boss`
- **AI 能力层**：用户自带 SiliconFlow API Key
- **数据存储**：全部本地存储，不做云端数据库

## 2. 为什么这样选

### 2.1 为什么先做 Windows
- 目标用户大量集中在 Windows 办公电脑
- 安装包分发简单，用户教育成本低
- 第一版先打透一个平台，比双平台同时推进更稳

### 2.2 为什么选 Electron
- 桌面应用打包成熟
- 本地进程管理方便，适合拉起 Python 服务
- UI 开发快，后续补页面成本低
- Windows 安装包生态成熟

### 2.3 为什么选本地 `mcp-boss`
- 现成具备：扫码登录、岗位搜索、推荐岗位、自动打招呼
- 不需要额外自建云端后端
- 用户账号 Cookie 留在本机，降低平台账号托管风险

### 2.4 为什么让用户自带 SiliconFlow Key
- 不需要自建模型网关
- 不需要承担模型成本
- 不需要做充值、套餐、额度系统
- 用户可自行切换模型，产品不锁供应商

## 3. 模块划分

### 模块 A：桌面 UI 层（Electron）
负责：
- AI Key 配置
- BOSS 登录页
- 搜索条件配置
- 自动运行控制
- 日志展示
- 风控开关展示

### 模块 B：任务调度层（Electron 主进程）
负责：
- 启动/停止本地 `mcp-boss`
- 管理“搜索参数 + 运行配置”本地存储
- 调用预留的登录/搜索占位接口
- 维护控制台最小状态机（开始/暂停/停止）
- 记录运行日志

### 模块 C：AI 适配层
负责：
- 校验 SiliconFlow Key
- 预留打招呼草稿生成接口（当前返回本地占位文案）
- 保留统一接口，未来可兼容其他 OpenAI 风格 API

### 模块 D：BOSS 接入层（本地 Python 服务）
规划使用 `mcp-boss` 提供：
- `login_full_auto()`
- `search_jobs(...)`
- `get_recommend_jobs_tool(...)`
- `send_greeting / greeting tool`

当前代码内已预留并联通以下接口（占位返回，不触发真实调用）：
- `mcpBoss:getLoginStatus`
- `mcpBoss:requestLoginQr`
- `mcpBoss:searchJobs`

### 模块 E：本地存储层
负责保存：
- API Key（加密）
- 用户偏好
- 已发送记录
- 运行日志
- 风控计数（今日已发送、连续失败数等）

## 4. 本地进程关系

```text
[Electron Renderer]
        |
        v
[Electron Main Process / Scheduler]
   |                \
   |                 \--> [SiliconFlow API]
   |
   \--> [Local mcp-boss Python Service] --> [Boss直聘]
```

说明：
- UI 不直接调 BOSS
- 所有自动化逻辑统一走主进程调度
- BOSS 登录态只保留在本机
- 第二部分仅完成“接口面 + 配置面 + 控制台骨架”，真实登录/搜索/发送待后续接入

## 5. 数据本地存储策略

第一版建议：
- 配置类数据：JSON
- 日志与发送记录：SQLite 或 JSON
- API Key：本地加密保存
- BOSS Cookie：仅本机保存，不上传

建议目录：
- `%APPDATA%/BossAutoGreeter/config.json`
- `%APPDATA%/BossAutoGreeter/logs.db`
- `%APPDATA%/BossAutoGreeter/runtime/`

## 6. 打包思路

### 第一版打包目标
- 用户双击安装 `.exe`
- 安装完成后桌面有快捷方式
- 打开软件即可进入配置页

### 打包方式
- Electron 打 Windows 安装包
- 内置或伴随分发 Python Runtime
- 首次启动时自动校验 `mcp-boss` 所需依赖
- 缺依赖则自动补齐或给出明确提示

### 不建议第一版采用的方式
- 不要求用户装 Docker
- 不要求用户手动跑命令
- 不要求用户理解 OpenClaw

## 7. 关键风控设计

第一版必须内置以下规则：
- 每日打招呼上限
- 每次发送随机间隔
- 连续失败自动暂停
- 出现验证码/安全校验自动暂停
- 支持一键暂停/停止
- 所有发送行为有日志可查

## 8. 主要风险

### 风险 1：平台风控
- 搜索和自动打招呼都可能触发风控
- 解决：强制限速、强制上限、异常自动暂停

### 风险 2：BOSS 接口变动
- `mcp-boss` 依赖平台接口，平台一变就可能失效
- 解决：保持本地服务可替换，后续预留更新机制

### 风险 3：Windows 打包复杂
- Python + Playwright + Electron 同时打包，体积会偏大
- 解决：第一版优先可用，不先追求最小体积

### 风险 4：用户 API Key 配置失败
- 用户可能填错 Key 或模型名
- 解决：必须有“测试连接”按钮和清晰报错

## 9. 第一版结论

第一版不做云端，不做数据库服务，不做账号系统。

核心思路就是：
**一个本地 Windows 软件，前面是 Electron 界面，后面挂本地 `mcp-boss`，AI 调 SiliconFlow，所有数据都存在用户自己电脑里。**
