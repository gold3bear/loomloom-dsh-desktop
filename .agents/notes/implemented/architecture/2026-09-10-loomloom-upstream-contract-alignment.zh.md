# Agent Note：dsh-plugin-loomloom 的上游契约对齐

状态：implemented

[English](2026-09-10-loomloom-upstream-contract-alignment.md) | 中文

## 问题

`dsh-plugin-loomloom` 通过手写的 `fetch` 代码（[`src/loom-api.ts`](../../../../dsh-plugin-loomloom/src/loom-api.ts)）访问 Loomloom 产品 API（`https://loomloom.shengsuanyun.com/loom/v1`），并在 [`src/skillbots.ts`](../../../../dsh-plugin-loomloom/src/skillbots.ts) 里手写解析响应。由于 JSON 契约是靠观察推断出来的，解析器容忍了多个候选字段名（例如 `pickText(value, ['id', 'listingId', 'marketListingId'])`），而非取自权威来源。

这种"只靠推断"的做法已经造成两个具体故障：

1. **产物正文被丢弃。** 结果载荷在 `inlineText` 字段里内联携带 SkillBot 输出，但 `artifacts()` 只读取了 `id`/`label`/`mimeType`/`accessUrl`。于是 `loomloom_get_run_results` 只返回一个计数（"4 output artifact(s) available"）而从不返回结果正文，逼得用户走旁路直接打原始 API 才能拿到内容。本会话已通过在 `artifacts()` 和工具 render 中补上 `inlineText` 修复了这个问题。
2. **货币 `*T` 字段未处理。** 上游对每个金额都会返回两份：换算后的 `moneyResponse`（`taskFixedFee: { amount: "0.2000000", currency: "CNY" }`）和原始单位整数（`taskFixedFeeT: 2000000`），其中 `10,000,000` 原始单位 = 1 货币单位。我们的 `fixedFee()` 和 `parseQuote()` 只读取了换算后的那份。一旦某个端点只返回 `*T` 形式，我们就会把 `2000000` 错当成金额，或干脆丢失金额。

上游发布了 Go CLI（[`cogfoundry-labs/loomloom`](https://github.com/cogfoundry-labs/loomloom)），其 `src/cli/internal/cmd/` 下的结构体就是同一套 HTTP API 的事实 JSON schema。它们正是我们一直在手工重新推导的权威契约。

## 决策

保持直连 HTTP 的架构——`dsh-plugin-loomloom` 仍是一个 `fetch` 客户端，我们**不**去 shell 调用 Go CLI 二进制，也不把 Go 源码移植成 TypeScript。npm 包 `@cogfoundry/loomloom` 只是一个安装器外壳（`bin: { loomloom: 'bin/loomloom.cjs' }`，无 `main`/`exports`、无依赖），没有可复用的 SDK；每次工具调用都嵌入一个子进程，会带来二进制分发、版本、平台和进程生命周期成本，却换不来任何额外能力。

改为：把 CLI 的 Go 结构体当作**唯一权威字段契约**，据此对齐 `skillbots.ts` 的解析，并把映射关系记录下来，将来上游字段一变，只需改这一处文档化位置。

### 货币单位

上游单位体系（摘自 CLI `docs/reference/cli.md`）：

> 10,000,000 API units = 1 currency unit

原始单位字段命名为 `*T`（如 `taskFixedFeeT`、`estimatedBuyerPayableT`）。它们的换算伴随对象是 `moneyResponse`（`{ amount, currency }`）。CLI 解析展示金额的方式是：优先取换算后的 `moneyResponse.amount`；否则把 `*T` 整数除以 `10_000_000`；当只有 `*T` 值时绝不猜测币种。

我们新增一个与 `formatResponseMoney` 等价的辅助函数：

```ts
const RAW_UNITS_PER_CURRENCY = 10_000_000

function money(value: Record<string, unknown>, moneyKey: string, rawKey: string, currency: string): { amount: string, currency?: string } | undefined {
  const converted = monetaryText(value[moneyKey])
  if (converted !== undefined) return { ...converted, ...(converted.currency === undefined && currency !== '' ? { currency } : {}) }
  const raw = value[rawKey]
  const units = typeof raw === 'number' && Number.isFinite(raw)
    ? raw
    : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
      ? Number(raw)
      : undefined
  if (units === undefined) return undefined
  return { amount: String(units / RAW_UNITS_PER_CURRENCY), ...(currency === '' ? {} : { currency }) }
}
```

然后：

- `fixedFee()` 优先取 `taskFixedFee.amount`，回退到 `taskFixedFeeT / 1e7`。
- `parseQuote()` 优先取 `estimatedBuyerPayable` / `buyerPayable`，回退到 `estimatedBuyerPayableT / 1e7`；固定费行优先取 `taskFixedFee`，回退到 `taskFixedFeeT / 1e7`。

### 权威字段契约

下表是上游（Go 结构体的 `json:` 标签，来自 `src/cli/internal/cmd/{market,run,artifact,helpers}.go`）到我们解析器的映射。当前已一致的标为"已对齐"；不一致的注明改动。多候选名容忍（带多个键的 `pickText`）仅在上游本身容忍多种形状处保留（尤其是 `rows`/`items`），否则收敛到单一官方字段名，避免掩盖漂移。

#### Listing（list + detail）：`marketListingPublicResponse`

| 上游 JSON 键 | Go 类型 | 我们当前解析 | 动作 |
|---|---|---|---|
| `id` | `string` | `id`/`listingId`/`marketListingId` | 对齐为 `id` |
| `displayName` | `string` | `displayName`/`name` | 对齐为 `displayName` |
| `description` | `string` | `description` | 已对齐 |
| `executionAvailabilityStatus` | `string` | 同，`=== 'available'` | 已对齐 |
| `listingVersionId` | `string` | 多个候选 | 对齐为 `listingVersionId` |
| `taskFixedFee` | `*moneyResponse` | `taskFixedFee.amount` | 增加 `*T` 回退 |
| `taskFixedFeeT` | `*flexInt64` | 未读 | 增加回退来源 |
| `currency` | `string` | 未读 | 用作回退币种 |
| `inputSchemaSnapshot` | `json.RawMessage` | 已解析 | 已对齐 |

#### Listing detail 附加：输入字段（`inputSchemaSnapshot.fields[]`）

上游 CLI 通过 `publicinput` 读取快照，并暴露每个字段的 `key`、`label`、`required` 和值类型。我们的 `parseFields()` 已覆盖 `key/name/fieldKey`、`label/title/displayName`、`required/isRequired`、`value_type/valueType/type`、`enum_values/enumValues` 及 `description/desc/inputHint/help`。这里保留多候选键，因为快照形状是用户编写的 TemplateSpec，而非单一上游结构体。

#### Run 提交（`POST /marketListings/{id}:execute`）：`runSubmitResponse`

| 上游 JSON 键 | Go 类型 | 我们当前解析 | 动作 |
|---|---|---|---|
| `runId` | `string` | `runId`/`id`（经 `extractRun`） | 对齐为 `runId` |
| `status` | `string` | `status` | 已对齐 |
| `acceptedAt` / `acceptedAtUnix` / `accepted_at_unix` | `flexInt64` | 未读 | 无动作（不外显） |

#### Run 详情（`GET /users/me/runs/{id}`）：`runDetailResponse`

| 上游 JSON 键 | Go 类型 | 我们当前解析 | 动作 |
|---|---|---|---|
| `runId` | `string` | `runId`/`id` | 对齐为 `runId` |
| `status` | `string` | `status` | 已对齐 |
| `displayName`（我们会外显） | — | `displayName`/`name` | 保留容忍 |

#### 结果行（`GET /users/me/runs/{id}/resultRows`）：`listRunResultRowsResponse`

上游的 `UnmarshalJSON` 同时接受 `rows` 与 `items`。我们的 `resultItems()` 读取 `items`/`resultRows`/`rows`。对齐为 `items`/`rows`（去掉上游并不下发的 `resultRows`）。

| 上游 JSON 键 | Go 类型 | 我们当前解析 | 动作 |
|---|---|---|---|
| `rowIndex` | `int` | 未读 | 无动作 |
| `status` | `string` | 用于计数 | 已对齐 |
| `errorMessage` / `error` | `string` | 未读 | 无动作（不得外显输入行） |
| `inputJson` | `string` | 未读 | 有意不外显 |
| `artifacts[]` | `[]runResultRowArtifact` | 经 `artifacts()` | 见下 |

#### 产物（`GET /users/me/runs/{id}/artifacts`）：`listRunArtifactsResponse`

| 上游 JSON 键 | Go 类型 | 我们当前解析 | 动作 |
|---|---|---|---|
| `artifactId` | `string` | `artifactId`/`id` | 对齐为 `artifactId` |
| `taskId` | `string` | 未读 | 无动作 |
| `stepId` | `string` | label 回退 | 已对齐 |
| `portName` | `string` | label 回退 | 已对齐 |
| `mimeType` | `string` | `mimeType` | 已对齐 |
| `accessUrl` | `string` | `accessUrl`（已做 https 校验） | 已对齐 |
| `inlineText` | `string` | **本会话新增** | 已对齐（已修复） |

#### 报价（`POST /marketListings/{id}:quote`）

CLI 渲染 `estimatedBuyerPayable`/`estimatedBuyerPayableT`、`taskFixedFee`/`taskFixedFeeT` 及 `currency`。我们的 `parseQuote()` 读取 `estimatedBuyerPayable`/`buyerPayable`/`estimatedPayable` 与 `taskFixedFee`。对齐为 `estimatedBuyerPayable`（+ `*T` 回退）与 `taskFixedFee`（+ `*T` 回退）；仅当上游确实下发 `buyerPayable` 时保留该容忍。

## API 覆盖面

买方 SkillBot 主链路（`list → show → quote → run → result`）是第一个切片。剩余产品面现已一并接入，按载荷形态分工：JSON 端点成为模型可见的 DSH 工具，二进制/文件端点成为由客户端驱动的 host 路由。

### 模型可见的 DSH 工具（共 13 个）

| 工具 | 上游端点 | 说明 |
|---|---|---|
| `loomloom_get_balance` | `GET /users/me/balance` | 优先 `availableBalance`，回退 `availableBalanceT / 1e7` |
| `loomloom_list_my_listings` | `GET /creators/me/marketListings` | 创作者自有上架，含销售与审核状态 |
| `loomloom_list_creator_transactions` | `GET /creators/me/marketTransactions` | `taskFixedFee` 与 `finalBuyerPayable` 均走 `*T` 回退 |
| `loomloom_publish_listing` | `POST /marketListings` | 把十进制金额换算为 `taskFixedFeeT`；属写入并触发审核 |
| `loomloom_list_official_templates` | `GET /officialTemplates` | 兼容 `templates`/`items` 两种包裹，与 CLI 的 `UnmarshalJSON` 一致 |
| `loomloom_get_template_schema` | `GET /officialTemplates/{id}/schema` | 暴露每个声明字段及 `inputHint`、`enumValues`、`examples` |
| `loomloom_list_my_templates` | `GET /users/me/templates` | 提供发布所必需的 `templateId` + `latestVersionId` |

`publish_listing` 是唯一新增的写入操作。金额换算复用共享常量 `RAW_UNITS_PER_CURRENCY`，使两个方向的换算共用同一处定义。`list_my_templates` 的存在是必要的：发布需要私有模板 id 与版本 id，而其他工具都无法提供。

#### `loomloom_list_skillbots` 的分页策略

上游把 `pageSize` 硬性限制为 100，市场现有约 225 个上架，因此全量遍历需要 3 页。第三页在上游侧很慢（实测 23–66s，偶尔超时），导致每次无参调用 `list_skillbots` 都要卡几十秒。该工具现在区分「浏览」与「搜索」：

- **无 `keyword`**：只取第一页（`pageSize=100`，约 1.5s）直接返回。浏览场景绝不为慢尾页买单。
- **带 `keyword`**：继续有界翻页直至集齐全量，再在本地对全量做匹配。这保留了「搜索基于全量数据匹配」的原始契约，代价是慢的第三页——这是上游 `offset=200` 分页的服务端性能问题，客户端无法消除。

翻页仍受 `MAX_MARKET_PAGES` / `MAX_MARKET_LISTINGS` 保护，病态上游不会导致死循环或越界。

### Host 路由（客户端/文件流程）

| 路由 | 上游端点 | 说明 |
|---|---|---|
| `GET /api/loomloom/balance` | `GET /users/me/balance` | 透传快照 |
| `GET /api/loomloom/creator/listings` | `GET /creators/me/marketListings` | |
| `GET /api/loomloom/creator/transactions` | `GET /creators/me/marketTransactions` | |
| `GET /api/loomloom/creator/earnings` | `GET /creators/me/earnings` | `pageSize` 先按数字限定再转发 |
| `GET /api/loomloom/templates` | `GET /officialTemplates` | |
| `GET /api/loomloom/templates/schema` | `GET /officialTemplates/{id}/schema` | |
| `GET /api/loomloom/my-templates` | `GET /users/me/templates` | |
| `GET /api/loomloom/market/workbook` | `GET /marketListings/{id}/workbook` | 二进制；以附件文件名回传 |
| `GET /api/loomloom/templates/workbook` | `GET /officialTemplates/{id}/workbook` | 二进制；以附件文件名回传 |
| `POST /api/loomloom/orchestration-input` | `POST /orchestrationInputs:upload` | 把文本内容重新编码为 base64，匹配上游 `[]byte` 字段 |
| `POST /api/loomloom/market/workbook/validate` | `POST /marketListings/{id}:validateWorkbook` | 不计费 |
| `POST /api/loomloom/market/workbook/quote` | `POST /marketListings/{id}:quoteWorkbook` | 不计费 |
| `POST /api/loomloom/market/workbook/run` | `POST /marketListings/{id}:executeWorkbook` | 计费；始终发送 `confirm: true` 与 `clientRequestId` |
| `POST /api/loomloom/templates/workbook/validate` | `POST /officialTemplates/{id}:validateWorkbook` | 不计费 |
| `POST /api/loomloom/templates/workbook/precheck` | `POST /officialTemplates/{id}:precheckWorkbook` | 成本预估；从不发送 `confirm` |

工作簿不跨工具边界，因为 DSH 工具结果是文本，而填写好的 `.xlsx` 是模型无法书写的字节。二进制留在 host 路由层——客户端本就持有该文件——由 `LoomApi.requestBinary` 以 base64 跨单跳上游传输。

工作簿路由上的 `content` 是 base64 字节，与 Go CLI 的 `[]byte` JSON 编码完全一致，因此同一套上游契约同时服务两种客户端。

## Skill 包安装

Market 上架还可以附带一个后端发布的 Agent Skill 包：一个 ZIP，内含完整技能（带 frontmatter 的 `SKILL.md`，以及 references 与 scripts）。安装它可让本地 agent 直接使用该技能，而不必走网络调用 SkillBot。上游契约（对照官方 CLI）是两个端点：

| 端点 | 返回 |
| --- | --- |
| `GET /marketListings/{id}/skillPackage` | 头部：`available`、`archiveHash`、`mode`、`sizeBytes`、`skillPackageVersionId`、`unavailableReason` |
| `GET /marketListings/{id}/skillPackage/archive` | ZIP 字节（`application/zip`） |

安装语义（对照官方 `InstallPackage`）：

- 下载的 archive 必须与已发布的 `sha256:<hex>` 一致（`normalizeArchiveHash` 接受 `sha256:` 前缀），否则不落盘任何内容。
- 解压时校验形态：恰好一个顶层目录；其根下必须有以 frontmatter 开头的 `SKILL.md`；`SKILL.md` 不超过 500 KiB；archive 不超过 10 MiB。
- 条目名若为绝对路径、带盘符，或含 `.`/`..` 段则拒绝，恶意 archive 无法逃出技能根目录。
- archive 先在技能根内的临时目录暂存，再 rename 就位；升级时把旧版本改名让位，rename 失败则回滚，因此崩溃不会留下半成品。
- `.loomloom-skill.json` marker 记录 `schemaVersion`、`source`（`market:<listing-id>`）与 `archiveHash`。`findInstalledSkillPackage` 读取它，使同源同 hash 的重复安装直接短路为 `unchanged`，不再下载。
- 卸载只删除带有效 marker 的目录，技能根里的无关文件夹绝不会被误删。
- 目标根为 `<DSH_HOME>/skills`（回退到 `~/.loomloom/skills`），由宿主环境推导而非来自请求，客户端无法自选写入目标。

ZIP 读取器基于 `node:zlib`（`inflateRawSync`）手写，而非引入新依赖。后端发布的是 stored 与 deflate 条目且无 ZIP64，正好是被覆盖的子集；遇到 ZIP64 会明确报错而非错误解析。这样插件的依赖列表保持不变，也无需改动 lockfile。

这些路由承载 ZIP 与文件系统路径，因此与工作簿流程一样留在 host 路由层，不作为模型可见工具：

| 路由 | 行为 |
| --- | --- |
| `GET /api/loomloom/skill-package` | 包头部 |
| `GET /api/loomloom/skill-package/archive` | 校验后的 ZIP 下载 |
| `POST /api/loomloom/skill-package/install` | 校验、解压并安装 |
| `POST /api/loomloom/skill-package/uninstall` | 按 `skillName` 卸载 |
| `GET /api/loomloom/skill-package/installed` | 列出已安装 marker |

## 文件

- [`dsh-plugin-loomloom/src/skill-package.ts`](../../../../dsh-plugin-loomloom/src/skill-package.ts) —— ZIP 读取、安装、幂等、卸载、列举和默认根目录辅助函数。
- [`dsh-plugin-loomloom/src/skillbots.ts`](../../../../dsh-plugin-loomloom/src/skillbots.ts) —— 解析：`money()`/`RAW_UNITS_PER_CURRENCY`、候选字段名收敛为官方键、`inlineText`，以及 Market、模板、工作簿和 Skill 包服务。
- [`dsh-plugin-loomloom/src/loom-api.ts`](../../../../dsh-plugin-loomloom/src/loom-api.ts) —— 工作簿下载用的 `requestBinary`，以及从上游 `Content-Disposition` 中剥离路径分隔符的 `suggestedFilename`。
- [`dsh-plugin-loomloom/src/tools.ts`](../../../../dsh-plugin-loomloom/src/tools.ts) —— 共 13 个工具；两个结果类工具均渲染 `inlineText`。
- [`dsh-plugin-loomloom/src/routes.ts`](../../../../dsh-plugin-loomloom/src/routes.ts) —— 创作者/模板/工作簿 host 路由；`forwardWorkbookTo` 由市场与官方模板两套工作簿动作共用。
- [`dsh-plugin-loomloom/tests/skillbots.spec.ts`](../../../../dsh-plugin-loomloom/tests/skillbots.spec.ts) —— "仅 `*T`"与"`*T`+`money`"两种货币用例。
- [`dsh-plugin-loomloom/tests/tools.spec.ts`](../../../../dsh-plugin-loomloom/tests/tools.spec.ts) —— 工具清单、`inlineText` 外显、余额/创作者/模板工具、发布时的 `taskFixedFeeT` 换算。
- [`dsh-plugin-loomloom/tests/routes.spec.ts`](../../../../dsh-plugin-loomloom/tests/routes.spec.ts) —— 路由转发、非法 id 拒绝、二进制回传、base64 上传、工作簿执行的确认要求、模板预检不带 `confirm`。
- [`dsh-plugin-loomloom/tests/loom-api.spec.ts`](../../../../dsh-plugin-loomloom/tests/loom-api.spec.ts) —— `requestBinary` 解码、文件名净化、失败状态。
- [`dsh-plugin-loomloom/tests/skill-package.spec.ts`](../../../../dsh-plugin-loomloom/tests/skill-package.spec.ts) —— ZIP 解析、hash 校验、压缩包安全、形态校验、安装、升级、幂等、卸载和列举。
- [`dsh-plugin-loomloom/tests/support/zip.ts`](../../../../dsh-plugin-loomloom/tests/support/zip.ts) —— 测试使用的极简 ZIP 构造器。
- [`dsh-plugin-loomloom/scripts/verify-skill-install.ts`](../../../../dsh-plugin-loomloom/scripts/verify-skill-install.ts) —— 安装链路线上端到端验证。

## 验证

- 在 `dsh-plugin-loomloom` 中 `corepack yarn test`（或 `node --import tsx --test tests/**/*.spec.ts`）通过，含货币回退、`inlineText`、创作者/模板工具与工作簿路由用例。
- `corepack yarn typecheck` 对 `tsconfig.json` 与 `tsconfig.client.json` 均通过。
- 手工核对：一次已完成的运行，其 `loomloom_get_run_results` 的 render 应包含每个产物正文，而非只有计数。
- 已对 `loomloom.shengsuanyun.com` 做过线上形态探测，确认了本note 记录的读取端点：`/users/me/balance` 返回 `availableBalance` 与 `availableBalanceT`；`/officialTemplates` 的行包在 `items` 里；`/users/me/templates` 返回 `items` 且含 `latestVersionId`/`publishedVersionId`；`/creators/me/marketListings` 返回 `items`。
- `yarn workspace dsh-plugin-loomloom verify:skill` 在临时技能根内验证包头部、hash 校验、安装、marker、二次安装幂等、列举与卸载。
- 尚未对线上上游验证：写入路径（`publishListing`、两套工作簿动作与 `orchestrationInputs:upload`）目前只用 fixture 验证过，因为本会话没有真实发布或填写工作簿。请把第一次线上调用视为确认。

## 备选方案

**shell 调用官方 Go CLI（`npx @cogfoundry/loomloom market list --output json`）。** 需要按平台安装二进制、版本锁定、子进程生命周期、超时与信号处理，以及每次工具调用多一跳 `child_process`——换来的却是同一套 HTTP 面。已否决。

**把 Go 结构体移植成生成的 TypeScript schema。** 一次性代码生成能带来类型化解析，但新增了构建步骤和第二处事实来源，可能与 Go CLI 漂移。手写解析器足够小，一张文档化映射表更便宜也更易 review。暂否，端点数量增长时再议。

**依赖 npm 上的 `@cogfoundry/loomloom`。** 发布包没有 `main`/`exports`，也没有 API 面——它只安装 CLI 二进制，无可导入内容。不可行，已否决。

**维持纯推断式解析。** 这是已造成 `inlineText` 丢失和 `*T` 单位未处理的现状。已否决。

**把工作簿流程做成 DSH 工具而不是 host 路由。** 工具结果是文本，所以 `loomloom_get_workbook` 只能内联模型无法还原成表格的 base64 字节，而 `loomloom_run_workbook` 还得让模型自己书写这些字节。客户端本就持有该文件，因此二进制留在路由层，只把 JSON 结果带回来。已否决。

## 后果

- 字段名漂移变得可见：映射表是唯一记录"官方键 ↔ 我们的解析器"之处，在上游只有单一形状的地方，解析器收敛到官方字段名。
- 即使端点只返回原始 `*T` 单位，货币金额也正确，因为 `1e7` 换算集中在一个辅助函数里。
- 不引入新的运行时依赖或子进程边界；插件仍是一个自包含的 `fetch` 客户端。
