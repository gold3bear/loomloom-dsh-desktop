# LoomLoom SkillBot 市场导航与主内容页面规格

## 1. 目的

将 LoomLoom SkillBot 市场集成到 DSH Desktop 的原生导航结构中：

1. 左侧导航提供稳定的“云端 SkillBot”入口；
2. 点击入口后，右侧主内容区域切换为 LoomLoom Market 页面；
3. 点击“关闭市场”后恢复原生 DSH 聊天页面；
4. 市场页面支持列表、详情、公开输入表单、报价和明确确认后的执行；
5. 不使用覆盖聊天区的浮层、固定定位按钮或独立弹窗作为主市场体验。

本规格覆盖现有 `dsh-plugin-loomloom` 的客户端、Host API、导航状态和测试边界。

## 2. 当前结构分析

### 2.1 DSH 页面层级

当前 DSH 的渲染结构是：

```text
root
└── AppFrame
    ├── sidebar
    │   └── SidebarRoot
    │       ├── brand
    │       ├── new session
    │       ├── sidebar.workspaces
    │       │   └── WorkspaceBrowser
    │       └── footer
    │           ├── sidebar.footer.action
    │           └── sidebar.settings
    ├── conversation
    │   └── ConversationRoot
    ├── details
    └── shell.overlay
```

### 2.2 当前实现的问题

现有 Market 入口注册到 `shell.overlay`，并使用：

```css
position: fixed;
top: ...;
left: ...;
```

这导致：

- Market 入口可能覆盖“新会话”或“工作区”区域；
- Market 页面位于整个 `AppFrame` 之上，会遮挡聊天内容；
- Market 的打开状态不属于 DSH 导航状态；
- 浏览器后退、关闭、键盘导航和当前页面恢复不符合 DSH 页面行为；
- overlay 只适合 toast、badge、浮动提示，不适合承载完整页面。

### 2.3 Slot 边界

- `sidebar.workspaces` 是 `single/root` slot，代表整个 WorkspaceBrowser，不是内部 list slot；
- `sidebar.footer.action` 是 additive list slot，只适合底部身份入口等附加动作；
- `shell.overlay` 是 frame-wide list slot，允许覆盖层，但不应承载主页面；
- `conversation` 是 `single/session-maybe` slot，由 `ConversationRoot` 独占；
- `conversation.view` 是 session-scoped，适合聊天内的 Trajectory 等 tab，不适合没有会话时的独立 Market 页面。

因此，不能通过一个普通 `shell.overlay` 组件模拟页面，也不能通过复制已注册 entry 的 `component/children/store/inject` 来安全包装官方组件。该做法会绕过 SlotRegistry 的授权、生命周期和 store 绑定。

## 3. 目标交互

### 3.1 左侧导航

位置：

```text
品牌
新会话
云端 SkillBot
工作区
会话列表
...
```

行为：

- 未选中：普通导航行；
- 选中：使用 DSH 当前导航选中态；
- 点击后只改变 `activeSurface`，不创建聊天；
- 侧栏收起时显示图标，展开时显示“云端 SkillBot”；
- 入口最小点击区域为 `32px`，键盘可聚焦；
- `aria-current="page"` 表示当前 Market 页面。

### 3.2 主内容页面

Market 页面占用原生主内容区域，与 DSH Chat 位于同一层级：

```text
AppFrame
├── SidebarRoot
│   └── LoomLoom navigation item
└── MainContentRouter
    ├── DSH ConversationRoot
    └── LoomloomMarketPage
```

Market 页面不得使用：

- `position: fixed` 覆盖聊天；
- `shell.overlay` 承载主页面；
- 嵌套 modal 作为主页面；
- 自己创建第二个 Electron/WebView 窗口；
- 伪造 DSH session。

### 3.3 页面恢复

- 点击 Market：保存 `activeSurface = "loomloom-market"`；
- 点击关闭：恢复 `activeSurface = "chat"`；
- 切换 DSH Profile 或 Host generation：清除内存导航状态，默认恢复 Chat；
- 页面刷新：默认恢复 Chat，除非后续明确引入可持久化路由；
- Market 页面内部的列表/预览使用组件状态；**唯一**写入 DSH session 的是用户点击调用时发出的那条普通消息（见 §5.4），页面不伪造 session、不写隐藏状态。

## 4. 推荐实现架构

### 4.1 导航状态

新增 Host-independent Client service：

```ts
type ActiveSurface = 'chat' | 'loomloom-market'

interface LoomloomNavigation {
  readonly activeSurface(): ActiveSurface
  setActiveSurface(surface: ActiveSurface): void
  subscribe(listener: () => void): () => void
}
```

要求：

- 状态只存在 Client 当前 generation；
- 不使用 `localStorage`；
- 不修改 DSH sessions；
- 不把 Market 选择状态写入 Agent session；
- dispose 时清理 listener。

### 4.2 左侧导航扩展

首选方案是增加官方公开 slot：

```ts
'sidebar.primary.navigation': {
  kind: 'list'
  scope: 'root'
  owner: {
    readonly wide: boolean
    readonly activeSurface: ActiveSurface
    readonly selectSurface: (surface: ActiveSurface) => void
  }
}
```

该 slot 应由 `SidebarRoot` 在“新会话”和“sidebar.workspaces”之间渲染：

```tsx
<NewSession />
{renderSlot('sidebar.primary.navigation', owner)}
<WorkspaceBrowser />
```

如果当前 DSH 发布版本没有该 slot，则需要在 DSH Desktop 自有的 profile/presentation 层提供同等官方扩展点。禁止通过 `shell.overlay` 假装导航。

### 4.3 主内容路由

需要一个主内容选择层：

```tsx
function MainContentRouter() {
  const activeSurface = useLoomloomNavigation()

  if (activeSurface === 'loomloom-market') {
    return <LoomloomMarketPage />
  }

  return <ConversationRoot />
}
```

该层必须保留原生 `ConversationRoot` 的全部 owner props、session hooks、render slots、store 和生命周期。不能通过读取 SlotRegistry 的 `StoredEntry` 再手动复制组件。

如果当前 DSH 没有公开 MainContentRouter slot，则应新增官方 slot：

```ts
'main.surface': {
  kind: 'single'
  scope: 'session-maybe'
  owner: {
    readonly activeSurface: ActiveSurface
  }
}
```

由 DSH 官方主内容组件负责在 Chat 和 Market 间切换。

### 4.4 关于上游组件修改

仓库规则要求不直接修改 `deepseek-harness/` 子模块。若产品决定新增 `sidebar.primary.navigation` 或 `main.surface`，应采用以下方式之一：

1. 在 DSH Desktop 自有 presentation/plugin 层实现并维护对应 slot；
2. 在 pinned upstream 之外建立明确的 patch 文件，并由 Desktop build 注入；
3. 升级到包含所需公开 slot 的 pinned upstream 版本。

禁止在工作目录中直接编辑 upstream 子模块后依赖本地状态运行。

## 5. Market 页面（店面）

> **2026-09-10 修订。** 本节原先把页面定义成"登录后加载的全量公开市场 + 搜索框"。产品需求改为**构建期固定的单创作者店面**，且浏览**不需要登录**。公开列表接口 `GET /marketListings` 也不返回任何创作者标识（实测 224 条全部 `creator:{nickname:""}`），因此无法由其筛选出单创作者店面；店面改由配置的 listing id 白名单经详情接口解析。§5.1 的搜索框在公开接口上只有 `keyword`（标题/简介匹配），且店面条目本身就是固定小集合，故本期不做。

### 5.1 页面骨架

```text
LoomLoom Market
云端 SkillBot 市场                         刷新

可用技能体
┌──────────────────────────────────────────┐
│ 名称                         固定费用  > │
│ 简介                                      │
└──────────────────────────────────────────┘
```

页面风格应接近 Codex 插件页：

- 主内容区域全高；
- 页面标题和副标题；
- 刷新位于标题下方；
- 列表使用平面行，不使用卡片套卡片；
- 详情通过主内容页内的返回路径进入；
- 调用通过“立即调用”弹窗完成，弹窗内的单一主操作为“获取报价”或“确认并执行”；
- 使用 DSH 现有 token、字体、边框和间距变量；
- 不引入新的颜色体系或装饰性渐变。

### 5.2 列表

Client：

```text
GET /api/loomloom/storefront[?refresh=1]
```

Host 有两种店面来源，`source` 字段公布当前生效的是哪一种：

| `source` | 含义 |
|---|---|
| `creator` | 由创作者凭据（`creatorKeyEnv` 指定的环境变量）在每次刷新时调 `GET /creators/me/marketListings` 推导 |
| `creator-key-missing` | 配置了创作者模式但环境变量缺失 → **店面为空并明确报告**，不静默回退 |
| `pinned` | 由 `storefrontListingIds` 固定列表（可被 `LOOMLOOM_STOREFRONT_IDS` 覆盖） |
| `none` | 未配置任何店面来源 |

创作者模式下只取 `status: published` **且** `saleStatus: listed` 的条目，再**匿名**逐个取详情补 `version` / `updatedAt` / `creator.nickname`（列表接口没有这三项）。凭据**仅用于发现**，所有详情读取都是匿名的。推导出的店面没有作者顺序，按 `updatedAt` 倒序（新→旧）展示。

固定模式按配置顺序展示，**不**请求全量公开市场。结果缓存 10 分钟（`refresh=1` 绕过）。

展示字段：

- SkillBot 名称；
- 简介；
- 是否可执行（`executionAvailabilityStatus === 'available'`）；
- 固定费用与币种；
- 不展示内部步骤、隐藏 Prompt 或 TemplateSpec。

状态：

- loading（骨架屏：标题 + 卡片骨架 + 加载文案，**不得**渲染连接引导）；
- `creator-key-missing`：显示"店面需要创作者凭据…"，不发任何上游请求；
- 未配置店面（`source === 'none'`）：显示"此构建尚未配置店面"；
- empty：店面已配置但无可用条目；
- 部分下架：`unavailable` 非空时提示数量，其余条目照常展示；
- network error：无任何缓存时显示错误与重试；
- stale：刷新失败但有上次快照时，继续展示旧列表并标注，刷新按钮显示忙碌状态；
- 浏览阶段不读取凭据，因此不存在 `401` 列表错误。

### 5.3 详情、预览与调用

> **2026-09-10 二次修订。** 本节原先规定由客户端自己报价、执行并在客户端展示结果。产品需求改为**执行交给对话里的 agent**，且**调用前必须先完成胜算云登录授权**。客户端因此不再持有任何执行路径。

店面条目**自带**预览与表单所需的全部数据（名称、`version`、`updatedAt`、`creator.nickname`、费用、`inputSchemaSnapshot`），因此打开预览**不发任何请求**。

**行的结构**：商店条目以**卡片网格**呈现（浅色调页面 + 白卡 + 可见描边，`auto-fill` 自适应，单卡下限 280px）。每张卡是一个容器，内部两个并列按钮——主按钮（调用）与「输入项」按钮（预览）；两者**不得**互相嵌套（非法嵌套交互元素）。卡内为创作者首字母方块 + 名称 + 创作者，随后是版本 / 可执行状态 / 输入项数量的胶囊行、三行截断的简介，页脚是费用与两个动作。页面头部另有搜索框（按名称、简介、创作者过滤）与刷新按钮，与内容列共用同一居中宽度。

> **2026-09-11 修订。** 原实现每行最右侧只有一个 44×44 的方块，里面仅有一个 `☰` 字符；浅色主题下它既无可见描边也无文字，读起来就是一个空框。预览入口现在必须有图标**和**文字。

| 操作 | 行为 |
|---|---|
| 点**主按钮** | 走 §5.4 的调用流程；消息里说明「我尚未填写输入，请先向我收集必填项」 |
| 点**「输入项」按钮** | 打开预览弹窗（`Modal` 基元）：创作者、版本、更新时间、费用、可填写的输入表单、费用条与主按钮 |

预览面板的主按钮「在对话中调用」：先校验必填项（缺失就地拦下），再把 `payloadRow()` 的结果作为 JSON 块随消息发出。

不展示：内部步骤、隐藏 Prompt、TemplateSpec、创作者私有配置、原始上游 JSON。

### 5.4 调用流程（含授权门）

```
点击行主体 / 预览提交
   ↓
GET /api/loomloom/credentials            ← 本地读，不碰上游
   ├ 已配置 ─────────────→ 组装消息 → conversation.send → 收起市场页
   └ 未配置 → 打开授权面板并暂存这次调用
                ↓ 用户点「注册或登录胜算云」（必须用户手势，否则 window.open 被拦）
                ↓ 浏览器 PKCE → 回环回调 → 轮询到 complete
              ─→ 自动继续：消费暂存调用 → send → 收起市场页
```

要求：

- **授权只在调用前校验**，预览不校验。
- **授权成功后自动继续**，不要求用户重新点击。
- 用户主动放弃（`onLater`／关闭面板）→ **丢弃暂存调用**并留在市场页；授权取消与超时由连接流程自身文案提示。
- 凭据本地读取失败 → 报错且**不发送**，不当作「未连接」。
- **每次调用默认新建会话**（`create()` + `open()`），不复用当前会话：SkillBot 调用是自成一体的任务，塞进用户正在读的对话会把调用埋进无关上下文、把该上下文的上下文拖进运行，结果也混在一起。新会话同时给这次运行一份自己的记录。
- **新会话落在当前所在的分组下**：侧栏按 workspace 分组，而 `sessions.create()` 不带目标会落到 host 默认 workspace，于是旁边多出一个分组。因此先从工作区列表按 `sessionIds` 反查当前会话的 `workspaceId`，再 `create({ workspaceId })`；查不到时退回 `cwd`，再退回 host 默认（不阻塞插件加载——该查表在点击时惰性读取）。
- `target: 'current-session'` 保留为**显式**可选项，供确实要接着某个会话跑的调用方使用；该模式下若目标会话不可寻址则**报错而非另建**。
- 发送成功后**必须**把 `main.surface` 交还对话（`setLoomloomMarketActive(false)`），否则消息被市场页遮住、用户看不到。
- 会话寻址走 `ctx.sessions.scope(id).conversation`：`send` 是作用域寻址的，root 上下文会失败。

发送的是**普通用户消息**，进入会话历史并占用上下文；不是隐藏指令通道。

### 5.5 输入表单

> **2026-09-10 修订。** 公开 schema 的真实词表（实测 224 条 / 916 个字段）比本节原先记录的更丰富：`source_kind` 全为 `user_input`；`value_type` 有 `string`(888)、`enum`(10)、`asset_ref`(9)、`text_reference`(7)、`integer`(2)；`presentation.widget` 有 `input`(277)、`textarea`(280)、`select`(29)、`text`(17)，另有 313 个字段不声明 widget。字段提示在 `presentation.hint`，默认值在 `default_value`，排序在 `order`——旧实现只读 `description` 并忽略其余，导致提示、默认值、排序全部丢失，`asset_ref` 也无法填写。

控件选择顺序（实现见 `src/client/field-input.ts`）：

| 条件 | 控件 |
|---|---|
| `value_type === 'asset_ref'` | 文件输入 → 上传 → 保存 `inputAssetId` |
| 有 `enum_values`，或 `value_type === 'enum'`，或 `widget === 'select'` | select（含“请选择”占位） |
| `value_type` 为 `boolean` / `bool` | checkbox |
| `widget === 'textarea'` | textarea |
| `value_type` 为 `integer` / `number` / `float` | number input |
| 其余（含 `text_reference`） | text input |

要求：

- 每个字段有可访问 label；
- 必填字段标记 `*`；
- `default_value` 作为初始值；按 `order` 升序排列，未声明 `order` 的字段保持 schema 顺序并排在最后；
- `presentation.hint` 作为说明展示，`presentation.placeholder` 作为占位符；`description` 优先于 hint；
- 提交载荷省略空的选填字段，`integer` 以数字发送；
- 不在 placeholder 中承载唯一字段名；
- `text_reference` 的语义公开规格未描述，当前按文本输入处理。

外观要求（**2026-09-11 增补**，此前表单控件只有 1px 极淡边框、字段说明与说明文字全部是裸文本）：

- 控件必须用 `--dsw-alias-border-l4`（16%）描边、`--dsw-alias-bg-layer-1` 填充、8px 圆角、34px 高度；聚焦用 `--dsw-alias-state-business-primary`；
- 字段标签与控件成组（label 包裹），必填以红色 `*` 标记，说明文字在控件下方；
- `asset_ref` 用虚线拖拽区（图标 + 文案 + 接受类型 + 原生 file 控件），已上传时改为文件胶囊 + 移除按钮；
- 弹窗用 `Modal` 基元（遮罩、圆角、Esc/点击遮罩关闭由基元提供），页脚常驻费用条与全宽主按钮；
- **禁止**用 `--dsw-alias-border-l1`（4%，浅色主题下不可见）作为控件或卡片描边；卡面与页面的层次由「`--dsw-specific-sidebar-fill` 页面 + `--dsw-alias-bg-layer-1` 卡片」这一对 token 表达，因为浅色主题下 `bg-base` 与 `bg-layer-*` 全部等于白色。

### 5.6 运行结果渲染

执行只返回运行 ID，结果需回读，而结果**在对话里渲染**——执行发生在对话中，结算与产物链接也在那条回合里。

结果有两条并行的呈现路径，二者共享同一套形状判定（`src/payload-view.ts`，纯函数、可单测）：

| 输入形状 | 输出 |
|---|---|
| 对象数组（扁平） | **表格**；列 = 键的并集（上限 8），行上限 20 |
| 单对象 | 两列键值表；嵌套对象按点路径展开（深度上限 2），更深的显示 `{…}`，数组显示 `[N items]` |
| 标量数组 | 单列表格 |
| 非 JSON 文本 | 文本块（Markdown 路径为 fenced code block） |
| 裸标量 | 文本（Markdown 路径为 fenced code block，不做单格表格） |

1. **模型可见文本**：`output.render` 把上表渲染成 Markdown（`src/result-presentation.ts`）。对话渲染器支持 GFM 表格（`micromark-extension-gfm-table` 在客户端依赖内），所以走普通 text 内容块即可，**不需要新增 ContentBlock 类型、也不需要改上游**。
2. **对话卡片**：`output.presentationMeta`（`src/run-result-meta.ts`）把同一判定投影成结构化 payload 存进 `tool/result.meta`；客户端按工具名注册 `tool.call.toolview`（`src/client/LoomloomRunResultCard.tsx`）渲染状态点 + 状态胶囊 + 行数/完成/失败统计 + 每个产物的表格或文本 + 下载链接 + 截断说明，并支持复制 runId。`loomloom_execute_skillbot` 与 `loomloom_get_run_results` 共用同一张卡。

保护措施：

- 单元格转义 `|` 与换行，长字符串截断（约 120 字符 + `…`）；
- 被截断的行/列**明确报告**「showing N of M rows」／「N more column(s) omitted」，不静默丢弃；
- 产物内容在进入模型上下文**和**卡片之前就有字符预算上限（`MAX_ARTIFACT_TEXT_CHARS`），截断处留可见标记；
- **meta 自身也有预算**（`MAX_META_CHARS`，同一 16 000 字符上限）：超出时按「先减行（10→5→2→0）→ 再丢弃 payload → 最后从后往前丢产物」确定性裁剪，并用 `truncated`／`omittedArtifacts` 报告，因为 meta 会随会话日志持久化；
- 客户端对 meta 做**严格收窄**：版本号未知、缺 `status`、字段类型不符时返回 `undefined`，卡片回落为模型可见文本 —— 旧会话（写入 meta 之前）与嵌套调用都不会出现空卡；
- 只渲染**产物输出**，不渲染用户输入行（沿用该工具既有的「不暴露 input rows」约束）；
- `accessUrl` 以链接给出（含工作簿），下载不依赖任何客户端路由；
- 表格在卡片内横向滚动（细滚动条 + 吸顶表头），行数超过 8 行时提供展开控制。


## 6. 报价与执行

> **2026-09-10 修订。** 店面改版后，Market 页面**不再**持有报价/执行入口：点击调用会把 SkillBot 与已填字段交给一个**新对话**，由 agent 侧工具承担报价与执行（见 §6.3）。§6.1 / §6.2 的 Host 路由**仍然保留**——workbook 与模板流程共用同一套 `QuoteDraftStore` 确认机制——但它们不再是页面的付费路径。

### 6.1 报价

```text
POST /api/loomloom/market/skillbot/quote?listingId=<id>
```

请求：

```json
{
  "inputRows": [{ "field": "value" }]
}
```

Host：

- 限制 body 不超过 `512 KiB`；
- 限制输入行数为 `1..100`；
- 严格校验 listing ID；
- 使用当前 Host credential；
- 不创建执行；
- 返回服务端原始报价中经过规范化的金额和币种，并附加一个短时 `confirmationToken`。

UI：

```text
预计应付  ¥1.50 CNY
```

报价改变或输入改变后必须重新报价。

### 6.2 确认执行

```text
POST /api/loomloom/market/skillbot/execute?listingId=<id>
```

请求必须包含：

```json
{
  "inputRows": [{ "field": "value" }],
  "clientRequestId": "loomloom-ui-...",
  "confirmationToken": "<opaque quote token>",
  "confirm": true
}
```

执行前必须：

1. 用户已经看到当前报价；
2. 用户点击“确认并执行”；
3. Host 校验短时 `confirmationToken`，确认 listing 与输入哈希未在报价后发生变化；
4. 新生成 `clientRequestId`；
5. 上游 execute 只发送一次，网络歧义重试只能复用同一个 request ID。

执行结果：

- 展示 run ID 和已提交状态；
- 不自动代表用户发起第二次执行；
- 后续运行状态可通过聊天工具或专门 runs 页面查看；
- 不在 Market 页面回显完整输入行或敏感输出。

### 6.3 对话内执行路径

店面页面的付费路径不经过 §6.1 / §6.2，而是由六个 `loomloom_*` 工具串起来，全部在对话中发生：

```text
loomloom_list_skillbots          发现（可选，店面条目通常已给出）
loomloom_get_skillbot            读字段与会话校验
loomloom_prepare_execution       生成短时草稿 + 服务端报价，无副作用
loomloom_execute_skillbot        请求 DSH 付费审批；仅批准后执行
loomloom_get_run                 轮询状态
loomloom_get_run_results         行数、产物（渲染为表格）
```

不可绕过的约束：

- `loomloom_execute_skillbot` 内部取 `ctx.get('approval')`，缺失时抛 `503` **阻断执行**；存在时调用 `approval.request({ reason: 'Execute … Market estimate: …' })`，因此**每次付费前都有一次显式确认并展示预估费用**。
- 草稿绑定发起它的 DSH Agent，短时有效；执行只接受本人草稿。
- 执行幂等由 `clientRequestId` 承担，重试不会重复扣费。
- 客户端页面不提供报价/执行入口，因此页面侧不存在「绕过审批直接花钱」的路径。

## 7. 认证状态

未登录：

- Market 页面可以显示公开市场列表；
- 点击报价/执行时进入明确的登录连接流程；
- 不伪造已连接状态；
- 登录完成后返回当前 SkillBot 详情和已填写输入；
- 登录不会丢失表单草稿，但必须重新读取详情和报价。

已登录：

- 可读取 Market；
- 可读取用户账户身份；
- 可请求报价；
- 执行仍需每次明确确认。

## 8. 废弃实现

以下实现必须删除或停止使用：

- `shell.overlay` 作为 Market 主页面；
- `position: fixed` 的 Market trigger 覆盖侧栏；
- `position: fixed; inset: 0` 的 Market 主容器；
- 复制 `StoredEntry.component`、`children`、`store`、`inject` 进行包装；
- 在 Client 中自行解析或保存 DSH URL hash；
- 把 Market 执行当成普通按钮而绕过 DSH approval；
- 直接修改 `deepseek-harness/` 工作树。

`shell.overlay` 只允许继续用于临时 toast、连接提示或不阻塞交互的状态提示。

## 9. 测试

### 9.1 导航

- 默认显示 Chat；
- 点击侧栏 Market 后主内容切换为 Market；
- Market 不覆盖 Chat DOM；
- 点击返回恢复 Chat；
- 侧栏收起/展开时入口不重叠；
- 当前页有 `aria-current="page"`；
- 键盘 Enter/Space 可切换；
- Profile/generation dispose 后导航状态清理。

### 9.2 Market

- 列表成功、空列表、加载中、网络失败；
- 店面条目的版本号/更新时间/创作者/费用与输入项正确渲染；
- 控件按 `value_type` + `presentation.widget` 选择，提示与默认值在位；
- 必填缺失时提交被拦下；
- 有当前会话时直接发送且**不**新建会话；
- 无当前会话时新建并寻址；已选中但不可寻址时**报错而非另建**；
- 凭据已配置 → 直接发送；未配置 → 暂存并进入授权；读取失败 → 报错不发送；
- 授权成功后**自动继续**发送；主动放弃则丢弃暂存且**不发送**；
- 发送成功后 `main.surface` 交还对话；
- 重复点击不会发出两条消息。

### 9.3 安全

- DOM 不出现 API Key、Authorization header、OAuth code、state、verifier；
- Market 页面不显示原始上游 response；
- URL 不包含 token 或执行输入；
- Host route 只接受 loopback authority，所有写请求还必须携带匹配的 `Origin`；
- 有请求体的写请求只接受 `application/json`；
- body 和 ID 均有边界校验。

## 10. 验收标准

1. DSH 首屏左侧能看到“云端 SkillBot”导航；
2. 点击后右侧主区域切换为完整 Market 页面；
3. Chat 内容不被遮罩、不被 fixed overlay 覆盖；
4. 市场页是可见的卡片网格（卡片有描边与卡面），每张卡的两个动作都带图标与文字；「输入项」按钮打开可填写表单，字段按公开 schema 正确渲染；
5. 未登录时点调用**先出授权面板**，不直接发送；
6. 授权完成后**自动回到对话并已发出调用消息**；
7. 已登录时点调用直接收起市场页并发送；
8. 预览中填写的值随消息以 JSON 块交给 agent；
9. agent 执行前出现付费审批并展示预估费用；
10. 运行结果在对话中以**卡片**呈现（状态、行数、表格/键值表、产物下载），而非原始 JSON；无 meta 的旧会话回落为可读文本而不是空卡；
11. 客户端不再发起报价、执行或结果路由请求；
12. `dsh-plugin-loomloom typecheck`、`test`、`build` 和根级 `check` 通过。
