# LoomLoom × DSH SDK MVP 计划

**状态：**基于当前 DSH Desktop 集成的验证计划  
**目标：**验证“胜算云账号授权 + 模型对话 + LoomLoom SkillBot 调用”能否沉淀为可复用 SDK，并为唐老师数字房东、KOL 套壳和 FA Skill 场景提供接入基础。

## 1. 结论

SDK 不应重新建设一套账号、模型或 Skill 平台。当前 DSH Desktop 已经证明了大部分核心链路：

```text
胜算云授权
→ DSH 安全凭据
→ ShengSuanYun 模型调用
→ LoomLoom Market 发现
→ Agent 追问和补齐参数
→ 报价与用户确认
→ SkillBot 执行
→ 结果回写聊天
```

SDK MVP 的任务是把这条链路从 DSH 专用实现中抽出稳定的 Host-facing contract，而不是把 Token 暴露给前端或第三方应用。

当前已跑通的 loopback PKCE 授权就是 SDK 的正式技术基线。旧方案中“Cline Chinese 跳转授权、不做 OAuth”的判断已经被实际验证结果修正：可以继续复用胜算云授权页，但 Desktop 回跳必须使用 state、PKCE、一次性 callback 和 Host 侧凭据验证。

## 2. SDK MVP 范围

### 2.1 必须支持

| 模块 | MVP 能力 | 当前 DSH 状态 |
| --- | --- | --- |
| `auth` | 登录、授权回跳、状态、取消、退出、重新授权 | Host 已实现，需打包人工验收 |
| `chat` | 使用胜算云默认模型进行一轮对话 | Provider 和默认模型已接入，需真实聊天验收 |
| `skills` | SkillBot 列表、详情、schema、准备、确认、执行、结果 | Agent tools 已实现，需零费用真实 Listing 验收 |
| `account` | 账号身份、凭据 presence、余额/用量 | Host 部分已实现，需确认公开字段和脱敏边界 |
| `lifecycle` | 重启恢复、Profile 切换、取消、超时、重新授权 | 自动化覆盖较多，需安装包验证 |
| `diagnostics` | 可定位登录、模型、SkillBot 调用失败原因 | 部分错误码已实现，需统一外部 contract |

### 2.2 暂不进入 SDK MVP

- 创作者后台、审核和收益管理
- 完整支付、分账和提现后台
- 白标应用和应用审核流
- 多租户企业权限体系
- OAuth 授权服务器
- 自建模型目录和模型管理页面
- 在 SDK 内复制完整代码 Agent

支付和订阅仍是商业验证必须验证的业务环节，但不应阻塞第一版技术 SDK；它们通过现有 LoomLoom/胜算云平台能力验证。

## 3. 建议的 SDK 形态

第一阶段不直接把 API Key 暴露给浏览器或第三方前端。建议分为两层：

```text
第三方应用 / DSH Client
        │
        └── @shengsuanyun/loomloom-client
              │  auth / chat / skills / account
              │
        DSH Host Adapter 或官方 SDK Host
              │
        credentials + Loom API + Router API
```

### 3.1 对外最小接口

```ts
interface ShengSuanYunClient {
  auth: {
    start(): Promise<{ sessionId: string, authorizationUrl: string }>
    getStatus(sessionId: string): Promise<AuthStatus>
    cancel(sessionId: string): Promise<void>
    logout(): Promise<void>
  }
  chat(input: ChatInput): Promise<ChatResult>
  skills: {
    list(input?: ListSkillsInput): Promise<SkillSummary[]>
    get(listingId: string): Promise<SkillDetail>
    prepare(input: PrepareSkillInput): Promise<ExecutionDraft>
    execute(draftId: string, approval: Approval): Promise<RunHandle>
    getRun(runId: string): Promise<RunStatus>
    getResults(runId: string): Promise<RunResults>
  }
  account: {
    getStatus(): Promise<AccountStatus>
    getBalance(): Promise<Balance>
  }
}
```

接口必须返回结构化、可脱敏的数据；不得返回 API Key、OAuth code、PKCE verifier、Cookie 或 Authorization header。

### 3.2 DSH 适配原则

- DSH Client 只调用 same-origin Host route。
- Host 通过 `credentials` 服务按请求解析 Key。
- `~/.loomloom` 继续作为 LoomLoom 独立配置根，不复用原版 `~/.dsh`。
- 已有 DSH 会话的模型选择不被静默修改；登录后只影响新建聊天默认模型。
- SkillBot 的执行必须保留 DSH approval，不允许 SDK 页面直接发送 `confirm: true` 绕过确认。
- 云端 SkillBot 与本地 Skill Package 必须明确标记为两种执行模式。

## 4. MVP 必须补充的能力验证

### P0-A：授权与账号

使用全新测试账号和全新 DSH Profile 验证：

1. Desktop 发起登录，系统浏览器打开胜算云授权页。
2. 回跳使用随机 loopback 端口，state 不匹配、重复 callback、过期 code 均被拒绝。
3. Host 分别验证 Loom API 和 Router `/models`，两者都通过后才保存凭据。
4. 登录成功后只返回 configured、source 和非敏感账号信息。
5. 取消、浏览器关闭、网络断开和超时都能重试，不能留下凭据或 listener。
6. App 重启和 Profile 切换后状态恢复。
7. 登出后 Market、模型和 SkillBot 执行都不能继续使用旧凭据。

**通过标准：**连续完成 3 次登录/退出循环，无重复授权请求、悬挂 callback 或残留凭据。

### P0-B：模型与聊天

1. 新建聊天默认解析为 `shengsuanyun` Provider 和已验证模型。
2. 发送普通文本并收到真实 Router 回复。
3. 模型不可用、模型目录为空、429、5xx 和超时能显示可恢复错误。
4. 旧会话保持原模型，不被登录流程静默迁移。
5. 客户端和日志中没有 Key、授权 code 或完整上游响应。

**通过标准：**全新安装包完成“登录 → 新建聊天 → 普通问题 → 模型回复”。

### P0-C：SkillBot 调用闭环

使用专用零费用测试 Listing，不使用生产付费 Listing：

1. Agent 能发现 SkillBot 并读取公开 schema。
2. 缺少必填字段时追问，不猜测输入。
3. `prepare` 返回 listing/version、输入摘要、行数和报价。
4. 用户拒绝时不发生 execute 请求。
5. 用户确认后只执行一次，重复 approval、篡改 draft、重复 `clientRequestId` 都失败安全。
6. Agent 轮询 run 到终态，将状态、结果摘要和 artifact 链接回写同一聊天。
7. 取消、超时和 generation dispose 返回 pending，不重复触发付费执行。

**通过标准：**同一测试 Listing 完成一次拒绝和一次明确确认，聊天中能看到完整结果证据。

### P0-D：SDK contract

在 DSH 外增加一个最小 TypeScript fixture client，验证 SDK contract 不依赖 React、Electron 或 DSH UI：

- `login/logout/re-authorize`
- `chat`
- `listSkills/getSkill`
- `prepare/execute/getRun/getResults`
- `getAccountStatus/getBalance`
- AbortSignal、超时和错误码

**通过标准：**fixture client 可以替换 DSH UI 调用同一 Host contract，并且不需要读取本地配置文件或环境中的明文 Key。

### P1-E：Skill Package 与本地 Agent

这不是云端 SkillBot MVP 的前置条件，但如果 SDK 需要支持“安装后由 Agent 使用”，必须补充：

1. Market 详情显示包是否可用、版本和 hash。
2. 用户点击“使用技能”后才下载和安装。
3. ZIP hash、安全路径、SKILL.md、升级和卸载验证已通过。
4. 安装完成后刷新 DSH Skill registry 或创建可重新扫描的 Session。
5. Agent 能发现新 Skill，并按照 SKILL.md 与用户交互。
6. 安装失败时明确回退为云端 SkillBot，不静默执行另一种模式。

当前代码已完成 Host 安装基础能力，但 Market 尚未提供下载/安装按钮，因此该闭环尚未完成。

## 5. 商业模式验证

SDK 技术跑通不等于商业模式成立。应以一个主场景先验证，不要同时建设多个 SaaS。

### 5.1 唐老师数字房东 / KOL 套壳

先验证接入需求，而不是先做通用平台：

- 第三方应用能否使用统一登录授权。
- 第三方应用是否需要 chat、SkillBot，还是只需要某个固定 Skill。
- 账号、Key、余额和用量由谁拥有。
- 按调用、按用户、按订阅哪种计费最容易被接受。
- 失败任务、退款和限流由平台还是场景方负责。

最小验收是一个真实场景应用完成 10 个真实用户任务，其中至少 3 个用户在 7 日内复跑；记录任务成功率、处理时长、成本、人工修订率和结果交付率。

### 5.2 FA Skill 订阅模式

需要单独验证以下假设：

- 创作者是否愿意以订阅方式出售 SkillBot。
- 单 Skill 券、多档套餐和有效期是否比按次更容易成交。
- 模型 Token 费、平台服务费和创作者收入如何归属。
- 充值、按笔付款、失败退款和结算是否能被财务/法务接受。
- 用户是否会复跑，而不是只完成一次体验。

**商业 MVP 通过标准：**至少一个真实 Skill 方案完成真实用户付费，并能形成一笔可追踪的收入或分成记录；同时拿到失败任务扣费/退款结论。仅创建套餐、领取优惠券或内部测试不算通过。

## 6. 观测与数据

SDK MVP 必须保留以下匿名事件：

```text
auth_started
auth_completed
auth_failed
chat_first_success
skill_discovered
skill_prepare_completed
skill_approved
skill_rejected
skill_run_completed
skill_run_failed
skill_rerun_7d
payment_completed
```

事件只记录 `client_id`、渠道、版本、匿名账号标识、listing/version、耗时、状态和错误码，不记录 Token、输入内容、OAuth code 或完整结果。

核心指标：

- 授权完成率
- 授权到首次聊天成功率
- SkillBot 首次成功率
- 7 日复跑率
- 真实用户任务数
- 结果导出/交付率
- 付费转化率
- 失败退款率
- 单任务成本和毛利

## 7. 交付顺序

### M1：DSH 技术闭环

- 完成打包版登录、聊天、登出人工验收。
- 使用零费用 Listing 完成 Agent 调用闭环。
- 固化 Host routes、错误码和 SDK 类型定义。

### M2：SDK Fixture 与场景接入

- 产出框架无关 TypeScript client fixture。
- 接入一个数字房东或 KOL 最小场景。
- 验证账号授权、聊天、Skill 调用和结果交付。
- 加入匿名事件和任务级成本记录。

### M3：商业验证

- 选择 FA Skill 或一个数字房东场景作为唯一 P0。
- 运行真实用户任务和 7 日复跑观察。
- 验证订阅/按次价格、优惠券、Token 归属、失败退款和结算。
- 根据数据决定继续投入、调整价格或停止场景。

## 8. 当前明确缺口

1. DSH 打包版真实登录、首次聊天和登出人工验收。
2. 零费用 Listing 的真实 execute 和结果回写验收。
3. 独立 SDK contract/fixture，目前仍主要是 DSH 插件内部实现。
4. Market 的 Skill Package 下载/安装 UI 和安装后 Skill registry 刷新。
5. 唐老师数字房东或 KOL 场景的真实接入样本。
6. FA Skill 的订阅、优惠券、付费、退款和结算验证。
7. `client_id`、渠道归因和任务级成本数据的统一口径。

## 9. 发布门槛

技术 SDK MVP 只有同时满足以下条件才算完成：

- 插件 typecheck、unit test、build 和 macOS smoke 通过。
- 打包版完成真实登录、普通聊天、SkillBot 零费用执行和登出。
- SDK fixture 不依赖 Electron、React 或明文凭据。
- 所有敏感信息安全回归通过。
- 至少一个外部场景完成接入，不以内部演示替代。

商业模式不以“功能上线”作为完成标准，必须补充真实用户任务、7 日复跑和真实付费/结算证据。
