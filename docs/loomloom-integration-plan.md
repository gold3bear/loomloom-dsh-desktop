# Loomloom × DSH Desktop 实施计划

本计划以 `dsh-plugin-loomloom` 为唯一业务实现位置。每个阶段完成后都应保持 DSH Desktop 可启动；`deepseek-harness/` 永不修改。

目录边界、所有权和旧项目移动时机见 [Loomloom × DSH Desktop 仓库布局](loomloom-repository-layout.md)。

## Phase 0 — 基线与开发环境

**交付物**：可复现的 DSH Desktop 开发环境、插件工作区、CI 中的窄检查。

1. 安装 Node 22.19+ 和 Corepack，执行 `corepack yarn install --immutable`。
2. 运行 `corepack yarn workspace dsh-plugin-loomloom typecheck`、`test`，修复 workspace/lockfile 问题。
3. 运行 `corepack yarn dev`，确认原始 DSH Desktop profile 可启动。
4. 将本插件加入一个开发 profile，确认其 Host row 被 `cordis.patch.yml` 自动插入。

**完成标准**：原桌面客户端启动正常；`GET /api/loomloom/health` 返回 200；上游子模块无工作区改动。

## Phase 1 — Host API MVP（当前已创建骨架）

**交付物**：`loom-api.ts`、`routes.ts`、配置说明和基础单测。

1. 完成 API client 的 HTTP 超时、AbortSignal、429/5xx 有界重试和错误码归一化。
2. 将当前市场目录区分为“公开预览 token”和“当前用户执行 token”，避免把目录权限误用到执行。
3. 补充请求体 schema：`inputRows` 最大行数、单元格深度/长度、listingVersionId 和 clientRequestId 格式。
4. 为 route 处理器增加真实 DSH Web Server 集成测试，而不只测试纯函数。

**完成标准**：市场、runs、单 run 和执行 API 均通过 mock 上游测试；Token 不出现在响应、日志和断言快照中。市场执行必须先取得 quote，再通过 DSH approval；浏览器直连 execute 路由在具备等价确认能力前不暴露。

## Phase 2 — 旧授权链路验收、凭据与 OAuth

**交付物**：DSH-native 凭据服务、登录状态 API、OAuth browser callback 处理。**状态：实现与安装包 smoke 验收完成；待用户账号人工验收登录/登出。**

1. 使用测试账号对旧 Go/Tauri 授权流进行一次端到端冒烟验证，记录 callback、换 Key、用户信息与身份探测的**脱敏**协议事实；失败时明确是客户端、callback 注册还是胜算云 API 变更。
2. 调研当前 pinned DSH runtime 的 credentials/settings API，只使用其公开 contract。
3. 使用 DSH credential reference `SHENGSUANYUN_API_KEY` 保存胜算云平台通用 Key；它与 DSH「模型」页中 Provider ID `shengsuanyun` 的派生引用一致，因此 Loomloom Market 和模型 Router 不复制密钥。旧 `loomloom/shengsuanyun` grant record 仅作为迁移读取回退，并有只返回 presence/source 的状态 API。账户显示名和主动登出仍待补充。
4. 已实现独立 loopback listener、state/PKCE、callback、兑换和验证；授权入口与兑换请求必须使用胜算云 `router.shengsuanyun.com/auth`、`from=CH_B51KXQ98` 和嵌套 `data.data.api_key` 响应兼容逻辑。DSH authorization surface 以 browser 为首选、API Token 为回退；浏览器回调页只表示“已收到”，最终成功必须以 DSH 凭据状态为准。打包桌面端还要完成 start/cancel/logout UI 验收。
5. 用 OS/DSH 安全存储替代旧 Go `config.json`；提供一次性、需用户确认的迁移助手，不自动读取或上传旧文件。

**完成标准**：重启 DSH Desktop 后凭据可恢复；登出后执行必定返回未登录；回调重放、state 不匹配和过期 code 被拒绝。

## Phase 3 — DSH Web Client

**交付物**：市场、执行确认、运行记录和凭据设置界面。**状态：只读市场、凭据状态、SkillBot schema 和运行记录已完成并已打包；页面级执行确认仍由 DSH 聊天 approval 工具链承担。**

1. 在 `src/client/` 采用 DSH 官方 Client slot/route/locale contract 建立入口；不访问 Electron API。
2. 将旧项目的 `inputSchemaSnapshot` 字段映射为可访问表单控件，保留 enum/number/boolean/textarea 支持。
3. 接入 Host API；为 load/error/empty/unauthenticated/running/completed/failed 状态写组件测试。设置页显示最近运行并允许按 run ID 刷新状态，不展示提交输入。
4. 完成移动/桌面响应式和 DSH Desktop safe-area 兼容；需要 desktop geometry 时仅使用公开 `desktopWindow` service。

**完成标准**：用户无需旧 Loomloom Tauri app 即可完成市场浏览、确认执行和结果查看。

## Phase 3.5 — 胜算云通用 Key 与 DSH 聊天模型

**交付物**：按胜算云官方 DSH 教程配置的模型提供方，和可验证的“登录后可聊天”验收链路。**状态：桌面 bundle 已预置 Provider；每次成功 Loomloom 登录会通过 DSH `agentDefaultModel` 服务保存新聊天的默认路由，待安装包做真实 Router 聊天 smoke。**

1. 桌面 patch 预置 `llm-pi-ai` 的 `shengsuanyun` Provider，并为 `agent-default-model` 设置组合默认值；使用 OpenAI Completions 协议和 `https://router.shengsuanyun.com/api/v1`。
2. 将通用 Key 只存到 `SHENGSUANYUN_API_KEY`；Loomloom 和 Provider 都按请求解析同一 reference，页面不读取或回显 Key。
3. 每次 Loomloom 登录成功后调用 DSH `agentDefaultModel.saveSelection()`，将**新建**聊天默认模型保存为 `deepseek/deepseek-v4-flash`；用户之后可在 DSH 模型设置中改选，已有会话维持其当前模型选择。
4. 通过无计费 `GET /models` 验证 Key 和模型目录，再发送一条人工 DSH 聊天 smoke。不得把浏览器 OAuth code、Cookie 或未经验证的登录 token 直接当作模型 Key。

**完成标准**：胜算云控制台创建的一把 Key 同时显示为 Loomloom 已登录和 `shengsuanyun` Provider 已配置；新建 DSH Chat / Agent 能使用选定模型回复。

## Phase 4 — Agent Tools：在 DSH 聊天中唤起 SkillBot（核心功能）

**交付物**：可从 DSH 对话调用的 SkillBot 工具链、执行确认门和结果回写。**状态：发现、schema、服务端报价草案、DSH approval 门、执行后自动轮询与终态结果回写已完成；页面级历史运行视图仍待后续阶段。**

1. 使用 pinned upstream 的官方 DSH tool + user-approval contract，定义 `list_skillbots`、`get_skillbot`、`get_run`、`prepare_execution`、`execute_skillbot` 的输入/输出 JSON Schema。
2. 先发布只读发现工具；Agent 可根据用户意图选择 SkillBot，但在 schema 缺字段时必须追问而不是猜测。
3. 建立 `prepare_execution`：校验输入、解析 Schema、计算行数/可用价格、生成短期确认 token；token 绑定用户、DSH session、profile、listing/version、输入 hash 和 clientRequestId。
4. 建立批准卡片/确认交互：用户确认后才可调用 execute；拒绝、超时、草案变更和重复提交都必须安全失败。
5. 执行后用 runId 轮询结果，将进度、完成/失败摘要与 artifacts 作为 tool result 回写 DSH 聊天；AbortSignal 取消、generation dispose 或轮询预算耗尽时安全返回 pending。

**完成标准**：用户可以在 DSH 聊天中自然语言提出需求，DSH Agent 能唤起正确的 Loomloom SkillBot；Agent 可以协助填写和解释输入，但无法绕过确认或在确认后篡改执行内容；结果会回到原聊天会话。

## Phase 5 — 发布与运维

**交付物**：测试门禁、可发布包、迁移/回滚与可观测性说明。

1. 加入 root `check` 的插件 build/typecheck/test，并更新 Yarn lockfile。
2. 检查 Electron Builder 的 `asar`/unpack 包含插件产物；验证 macOS 与 Windows 发行包。
3. 制定版本兼容表：DSH Desktop 版本、pinned DSH runtime、Loomloom plugin、胜算云 API contract。
4. 添加匿名、可禁用的操作级遥测或本地诊断（不含 Token、输入内容或上游完整响应）。
5. 将旧 Tauri app 标记为 deprecated，保留可回退下载，但仅在 DSH 版本满足 Phase 3 验收后停止维护。

**完成标准**：新安装包离线启动、联网登录、升级后保留安全凭据；失败可通过 DSH Desktop recovery/profile 机制恢复。

## 风险登记

| 风险 | 影响 | 缓解 |
|---|---|---|
| 胜算云 OAuth callback/PKCE 细节未确认 | Phase 2 延期 | 先支持环境变量/安全凭据手动配置；在实现前取得真实协议样本 |
| 上游 DSH alpha contract 变化 | 插件无法加载 | 锁定 runtime 版本；每次升级跑 typecheck、loader smoke 和 E2E |
| SkillBot 可能收费 | 误执行成本 | 强制用户确认、明确价格/行数、clientRequestId 幂等 |
| 上游 schema 的不一致字段 | 表单错误 | 复用旧项目的兼容映射，并为真实样本加入 contract tests |
| 凭据泄露 | 高 | Host-only、HTTPS、最小日志、密钥存储、同源 route、密钥扫描 |
