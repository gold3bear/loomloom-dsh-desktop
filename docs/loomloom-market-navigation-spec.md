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
- Market 页面内部的列表/详情使用组件状态，不写入 DSH session。

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

## 5. Market 页面

### 5.1 页面骨架

```text
LoomLoom Market
云端 SkillBot 市场                         刷新

搜索 SkillBot

可用技能体
┌──────────────────────────────────────────┐
│ 名称                         固定费用  > │
│ 简介                                      │
└──────────────────────────────────────────┘
```

页面风格应接近 Codex 插件页：

- 主内容区域全高；
- 页面标题和副标题；
- 搜索/刷新位于标题下方；
- 列表使用平面行，不使用卡片套卡片；
- 详情通过主内容页内的返回路径进入；
- 单一主操作为“获取报价”或“确认并执行”；
- 使用 DSH 现有 token、字体、边框和间距变量；
- 不引入新的颜色体系或装饰性渐变。

### 5.2 列表

Client：

```text
GET /api/loomloom/market
```

展示字段：

- SkillBot 名称；
- 简介；
- 是否可执行；
- 固定费用；
- 不展示内部步骤、隐藏 Prompt 或 TemplateSpec。

状态：

- loading；
- empty；
- network error；
- `401`：显示“重新连接胜算云”；
- stale refresh：保留当前列表，刷新按钮显示忙碌状态。

### 5.3 详情

Client：

```text
GET /api/loomloom/market/skillbot?listingId=<opaque-id>
```

展示：

- 名称；
- 简介；
- 可执行状态；
- 公开输入字段；
- 字段类型、是否必填、枚举值、说明；
- 版本 ID 仅作为 Host 内部执行绑定，不默认展示给用户。

不展示：

- 内部步骤；
- 隐藏 Prompt；
- TemplateSpec；
- 创作者私有配置；
- 原始上游 JSON。

### 5.4 输入表单

字段映射：

| `valueType` | 控件 |
|---|---|
| `string` | text input |
| `string` + textarea presentation | textarea |
| `enum` | select |
| `integer` | number input，整数校验 |
| `number` / `float` | number input |
| `boolean` / `bool` | checkbox |

要求：

- 每个字段有可访问 label；
- 必填字段标记 `*`；
- 输入错误紧邻字段显示；
- 不在 placeholder 中承载唯一字段名；
- 默认只支持一行输入；
- 后续多行输入必须单独设计，不通过复制一组表单偷偷扩展。

## 6. 报价与执行

### 6.1 报价

```text
POST /api/loomloom/market/skillbot/quote?listingId=<id>
```

请求：

```json
{
  "inputRows": [{ "field": "value" }],
  "listingVersionId": ""
}
```

Host：

- 限制 body 不超过 `512 KiB`；
- 限制输入行数为 `1..100`；
- 严格校验 listing ID；
- 使用当前 Host credential；
- 不创建执行；
- 返回服务端原始报价中经过规范化的金额和币种。

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
  "listingVersionId": "",
  "clientRequestId": "loomloom-ui-...",
  "confirm": true
}
```

执行前必须：

1. 用户已经看到当前报价；
2. 用户点击“确认并执行”；
3. 当前输入未在报价后发生变化；
4. 新生成 `clientRequestId`；
5. 上游 execute 只发送一次，网络歧义重试只能复用同一个 request ID。

执行结果：

- 展示 run ID 和已提交状态；
- 不自动代表用户发起第二次执行；
- 后续运行状态可通过聊天工具或专门 runs 页面查看；
- 不在 Market 页面回显完整输入行或敏感输出。

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
- 详情加载、返回、非法 ID；
- 字段类型和必填校验；
- 报价请求 body 正确；
- 输入改变后报价失效；
- 拒绝确认不会发送 execute；
- execute 始终带 `confirm:true` 和合法 `clientRequestId`；
- 401 显示重新连接入口；
- 执行成功显示 run ID；
- 重复点击不会生成两个 execute 请求。

### 9.3 安全

- DOM 不出现 API Key、Authorization header、OAuth code、state、verifier；
- Market 页面不显示原始上游 response；
- URL 不包含 token 或执行输入；
- Host route 只接受 loopback same-origin；
- body 和 ID 均有边界校验。

## 10. 验收标准

1. DSH 首屏左侧能看到“云端 SkillBot”导航；
2. 点击后右侧主区域切换为完整 Market 页面；
3. Chat 内容不被遮罩、不被 fixed overlay 覆盖；
4. 点击 SkillBot 可进入详情；
5. 填写公开字段后能看到服务端报价；
6. 用户明确确认后才执行；
7. 执行结果显示 run ID；
8. 点击返回后恢复原生聊天；
9. 已登录和未登录状态都可恢复；
10. `dsh-plugin-loomloom typecheck`、`test`、`build` 和根级 `check` 通过。
