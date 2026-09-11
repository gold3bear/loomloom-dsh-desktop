export type LoomloomLocaleKey =
  | 'tab'
  | 'title'
  | 'subtitle'
  | 'credentialReady'
  | 'credentialMissing'
  | 'credentialHint'
  | 'signIn'
  | 'signingIn'
  | 'signInWaiting'
  | 'signInFailed'
  | 'onboardingTitle'
  | 'connectionTitle'
  | 'connectDescription'
  | 'connectionDetails'
  | 'connectionDetailsBody'
  | 'connectionPrivacy'
  | 'connectLater'
  | 'waitingBrowser'
  | 'verifyingLoom'
  | 'verifyingRouter'
  | 'savingConnection'
  | 'browserUnavailable'
  | 'copyAuthorizationLink'
  | 'copyLinkFailed'
  | 'cancelSignIn'
  | 'cancelFailed'
  | 'authorizationCancelled'
  | 'authorizationTimedOut'
  | 'loomValidationFailed'
  | 'routerValidationFailed'
  | 'noChatModel'
  | 'credentialSaveFailed'
  | 'connectionStatusFailed'
  | 'modelSelectionRequired'
  | 'openModels'
  | 'modelSelectionLater'
  | 'loomReady'
  | 'chatModelReady'
  | 'connectedHint'
  | 'createFirstChat'
  | 'signOut'
  | 'signingOut'
  | 'refresh'
  | 'loadMore'
  | 'loading'
  | 'empty'
  | 'unavailable'
  | 'available'
  | 'fee'
  | 'schema'
  | 'required'
  | 'optional'
  | 'inputHint'
  | 'chatExecution'
  | 'chatExecutionDetail'
  | 'noSchema'
  | 'runs'
  | 'noRuns'
  | 'runRefresh'
  | 'error'
  | 'account'
  | 'accountConnected'
  | 'signInPrompt'
  | 'accountId'
  | 'balance'
  | 'accountRole'
  | 'creator'
  | 'user'
  | 'close'
  | 'accountUnavailable'
  | 'marketEntry'
  | 'marketEyebrow'
  | 'marketTitle'
  | 'marketSkillbots'
  | 'marketEmpty'
  | 'free'
  | 'selectPlaceholder'
  | 'storefrontUnconfigured'
  | 'storefrontCreatorKeyMissing'
  | 'storefrontUnconfiguredHint'
  | 'storefrontUnavailable'
  | 'staleStorefront'
  | 'storefrontRefreshFailed'
  | 'versionLabel'
  | 'updatedAtLabel'
  | 'creatorLabel'
  | 'closeCall'
  | 'requiredMissing'
  | 'chooseFile'
  | 'uploading'
  | 'uploadFailed'
  | 'clearFile'
  | 'previewInputs'
  | 'previewTitle'
  | 'callInChat'
  | 'promptInvocation'
  | 'promptNoInput'
  | 'authRequired'
  | 'authContinueHint'
  | 'credentialUnavailable'
  | 'sendFailed'
  | 'preparingCall'
  | 'marketSubtitle'
  | 'marketSearchPlaceholder'
  | 'marketSearchLabel'
  | 'marketSearchEmpty'
  | 'marketCount'
  | 'marketInputs'
  | 'marketUpdated'
  | 'marketCreator'
  | 'previewInputsShort'
  | 'previewStepsTitle'
  | 'previewStepRead'
  | 'previewStepQuote'
  | 'previewStepApprove'
  | 'previewStepResult'
  | 'previewFeeBarTitle'
  | 'previewFeeBarNote'
  | 'dropzoneTitle'
  | 'dropzoneHint'
  | 'dropzoneChosen'
  | 'runCardTitle'
  | 'runStatusRunning'
  | 'runStatsRows'
  | 'runCompleted'
  | 'runFailed'
  | 'runArtifacts'
  | 'runNoArtifacts'
  | 'runDownload'
  | 'runCopyId'
  | 'runCopied'
  | 'runTruncated'
  | 'runOmittedArtifacts'
  | 'runShownRows'
  | 'runOmittedColumns'
  | 'runShowAll'
  | 'runShowLess'
  | 'runEmptyPayload'
  | 'markdownCopy'
  | 'markdownCopied'
  | 'markdownFootnotes'

export const zh: Record<LoomloomLocaleKey, string> = {
  tab: 'Loomloom',
  title: 'Loomloom SkillBot',
  subtitle: '浏览可用的胜算云 Market SkillBot，并在 DSH 聊天中安全执行。',
  credentialReady: '已配置凭据',
  credentialMissing: '尚未登录',
  credentialHint: '点击下方按钮，在浏览器中完成胜算云授权。凭据不会显示在此页面。',
  signIn: '注册或登录胜算云',
  signingIn: '正在打开登录…',
  signInWaiting: '请在浏览器中完成授权；此页面会自动更新。',
  signInFailed: '登录未完成，请重试。',
  onboardingTitle: '连接胜算云，开始聊天与 Loomloom',
  connectionTitle: '胜算云连接',
  connectDescription: '注册或登录后，胜算云 API Key 将安全保存在此 DSH Profile 中，同时用于聊天模型与 Loomloom。',
  connectionDetails: '这会发生什么',
  connectionDetailsBody: 'DSH 会打开系统浏览器完成注册或登录，在本机回调后分别验证 Loomloom 与聊天模型，再保存设置。你可以随时在设置中退出。',
  connectionPrivacy: 'DSH Desktop 不收集或展示密码、验证码或 API Key。',
  connectLater: '暂不连接',
  waitingBrowser: '等待浏览器授权',
  verifyingLoom: '验证 Loomloom',
  verifyingRouter: '验证聊天模型',
  savingConnection: '保存设置',
  browserUnavailable: '无法打开系统浏览器。你可以复制授权链接后手动打开。',
  copyAuthorizationLink: '复制授权链接',
  copyLinkFailed: '无法复制授权链接，请重试。',
  cancelSignIn: '取消等待',
  cancelFailed: '取消登录失败，请重试。',
  authorizationCancelled: '授权已取消。可以重新发起连接。',
  authorizationTimedOut: '未在规定时间完成授权。请重新发起连接。',
  loomValidationFailed: '该 API Key 无法访问 Loomloom，请重新授权。',
  routerValidationFailed: '该 API Key 无法访问胜算云聊天模型，请重新授权。',
  noChatModel: '账号当前没有可用聊天模型，请稍后重试或联系胜算云支持。',
  credentialSaveFailed: '验证已通过，但保存设置失败。请重试。',
  connectionStatusFailed: '无法确认胜算云连接状态，请重试。',
  modelSelectionRequired: '凭据已验证。请选择一个可用的胜算云聊天模型后再完成连接。',
  openModels: '打开模型设置',
  modelSelectionLater: '稍后设置',
  loomReady: 'Loomloom 可用',
  chatModelReady: '聊天模型可用',
  connectedHint: '胜算云已连接，可以开始聊天。',
  createFirstChat: '创建第一段聊天',
  signOut: '退出登录',
  signingOut: '正在退出…',
  refresh: '刷新',
  loadMore: '加载更多',
  loading: '正在加载…',
  empty: '当前账户没有可显示的 SkillBot。',
  unavailable: '暂不可执行',
  available: '可执行',
  fee: '固定费用',
  schema: '公开输入字段',
  required: '必填',
  optional: '可选',
  inputHint: '字段信息仅用于准备输入；不会显示任何内部工作流。',
  chatExecution: '请在 DSH 聊天中执行',
  chatExecutionDetail: '在聊天中选择 SkillBot、准备输入并获取服务端报价。每次执行都必须经 DSH 的明确批准；本页不提供执行入口。',
  noSchema: '此 SkillBot 没有公开输入字段。',
  runs: '最近运行',
  noRuns: '暂无运行记录。',
  runRefresh: '刷新状态',
  error: '无法加载 Loomloom 信息。',
  account: '胜算云账户',
  accountConnected: '已连接',
  signInPrompt: '注册或登录后开始聊天',
  accountId: '用户 ID',
  balance: '余额',
  accountRole: '身份',
  creator: '创作者',
  user: '普通用户',
  close: '关闭',
  accountUnavailable: '账户资料暂时不可用，连接本身仍然有效。',
  marketEntry: '云端 SkillBot',
  marketEyebrow: 'LoomLoom Market',
  marketTitle: '云端 SkillBot 市场',
  marketSkillbots: '可用技能体',
  marketEmpty: '当前没有可用 SkillBot。',
  free: '免费',
  selectPlaceholder: '请选择',
  storefrontUnconfigured: '此构建尚未配置店面。',
  storefrontCreatorKeyMissing: '店面需要创作者凭据来获取作品列表，但当前环境未提供。请配置后重启应用。',
  storefrontUnconfiguredHint: '客户端只展示构建期配置的已上架 SkillBot；请联系维护者补充 storefrontListingIds。',
  storefrontUnavailable: '有 {count} 个 SkillBot 已下架，不再展示。',
  staleStorefront: '当前显示的是上次缓存结果，刷新未成功。',
  storefrontRefreshFailed: '店面刷新失败：{message}',
  versionLabel: '版本',
  updatedAtLabel: '更新时间',
  creatorLabel: '创作者',
  closeCall: '关闭',
  requiredMissing: '请先填写所有必填项。',
  chooseFile: '选择文件',
  uploading: '正在上传…',
  uploadFailed: '文件上传失败，请重试。',
  clearFile: '移除',
  promptInvocation: [
    '请通过 Loomloom 工具调用云端 SkillBot。',
    '- SkillBot：{name}',
    '- listing id：{listingId}',
    '- 我已填写的输入：',
    '{input}',
    '',
    '请依次执行：先用 loomloom_get_skillbot 读取字段并校验；再用 loomloom_prepare_execution 生成草稿并把预估费用告诉我；经我确认后用 loomloom_execute_skillbot 执行；最后用 loomloom_get_run 与 loomloom_get_run_results 汇总结果，并把结果整理成易读的表格。',
  ].join('\n'),
  promptNoInput: '（我尚未填写输入，请先向我收集必填项）',
  previewInputs: '预览输入项',
  previewTitle: '输入项',
  callInChat: '在对话中调用',
  authRequired: '调用云端 SkillBot 前需要先连接胜算云。',
  authContinueHint: '授权成功后会自动回到对话并继续这次调用。',
  credentialUnavailable: '无法确认胜算云授权状态，请重试。',
  sendFailed: '未能在对话中发起调用。',
  preparingCall: '正在发起…',
  marketSubtitle: '每位创作者的一方 SkillBot 工作站：在这里填好输入项，调用与结果都发生在 DSH 对话里。',
  marketSearchPlaceholder: '搜索名称或简介…',
  marketSearchLabel: '搜索 SkillBot',
  marketSearchEmpty: '没有匹配的 SkillBot。',
  marketCount: '共 {count} 个可用 SkillBot',
  marketInputs: '输入项 {count} 项',
  marketUpdated: '更新于 {date}',
  marketCreator: '创作者 {name}',
  previewInputsShort: '输入项',
  previewStepsTitle: '提交后会发生什么',
  previewStepRead: '先读取并校验公开输入字段',
  previewStepQuote: '生成执行草稿并给出预估费用',
  previewStepApprove: '费用需你确认后才执行',
  previewStepResult: '运行结果回到这个新会话里',
  previewFeeBarTitle: '本次调用费用',
  previewFeeBarNote: '费用由服务端在执行前确认，未执行不产生费用。',
  dropzoneTitle: '点击选择文件上传',
  dropzoneHint: '支持 {types}',
  dropzoneChosen: '已上传',
  runCardTitle: 'SkillBot 运行结果',
  runStatusRunning: '正在运行',
  runStatsRows: '总行数',
  runCompleted: '已完成',
  runFailed: '失败',
  runArtifacts: '输出产物',
  runNoArtifacts: '本次运行没有输出产物。',
  runDownload: '下载',
  runCopyId: '复制运行 ID',
  runCopied: '已复制',
  runTruncated: '内容已截断',
  runOmittedArtifacts: '另有 {count} 个产物未展示',
  runShownRows: '显示 {shown} / {total} 行',
  runOmittedColumns: '省略 {count} 列',
  runShowAll: '展开全部 {count} 行',
  runShowLess: '收起',
  runEmptyPayload: '该产物没有可展示的内容。',
  markdownCopy: '复制',
  markdownCopied: '已复制',
  markdownFootnotes: '脚注',
}

export const en: Record<LoomloomLocaleKey, string> = {
  tab: 'Loomloom',
  title: 'Loomloom SkillBots',
  subtitle: 'Browse ShengSuanYun Market SkillBots and execute safely from DSH chat.',
  credentialReady: 'Credential configured',
  credentialMissing: 'Sign-in required',
  credentialHint: 'Use the button below to complete ShengSuanYun authorization in your browser. Credentials never appear here.',
  signIn: 'Register or sign in to ShengSuanYun',
  signingIn: 'Opening sign-in…',
  signInWaiting: 'Complete authorization in your browser; this page will update automatically.',
  signInFailed: 'Sign-in did not complete. Please try again.',
  onboardingTitle: 'Connect ShengSuanYun for chat and Loomloom',
  connectionTitle: 'ShengSuanYun connection',
  connectDescription: 'After registration or sign-in, one ShengSuanYun API key is stored securely in this DSH Profile for both chat models and Loomloom.',
  connectionDetails: 'What happens',
  connectionDetailsBody: 'DSH opens your system browser, receives a local callback, verifies Loomloom and chat access separately, then saves the settings. You can sign out at any time.',
  connectionPrivacy: 'DSH Desktop never collects or displays passwords, verification codes, or API keys.',
  connectLater: 'Not now',
  waitingBrowser: 'Waiting for browser authorization',
  verifyingLoom: 'Verifying Loomloom',
  verifyingRouter: 'Verifying chat models',
  savingConnection: 'Saving settings',
  browserUnavailable: 'The system browser could not be opened. Copy the authorization link and open it manually.',
  copyAuthorizationLink: 'Copy authorization link',
  copyLinkFailed: 'The authorization link could not be copied. Please try again.',
  cancelSignIn: 'Cancel waiting',
  cancelFailed: 'Sign-in could not be cancelled. Please try again.',
  authorizationCancelled: 'Authorization was cancelled. You can start again.',
  authorizationTimedOut: 'Authorization was not completed in time. Please start again.',
  loomValidationFailed: 'This API key cannot access Loomloom. Please authorize again.',
  routerValidationFailed: 'This API key cannot access ShengSuanYun chat models. Please authorize again.',
  noChatModel: 'This account currently has no compatible chat model. Try later or contact ShengSuanYun support.',
  credentialSaveFailed: 'Verification succeeded, but the settings could not be saved. Please try again.',
  connectionStatusFailed: 'The ShengSuanYun connection could not be verified. Please try again.',
  modelSelectionRequired: 'The credential is verified. Select an available ShengSuanYun chat model to finish connecting.',
  openModels: 'Open model settings',
  modelSelectionLater: 'Set up later',
  loomReady: 'Loomloom available',
  chatModelReady: 'Chat model available',
  connectedHint: 'ShengSuanYun is connected and ready for chat.',
  createFirstChat: 'Create first chat',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  refresh: 'Refresh',
  loadMore: 'Load more',
  loading: 'Loading…',
  empty: 'No SkillBots are available for this account.',
  unavailable: 'Unavailable',
  available: 'Available',
  fee: 'Fixed fee',
  schema: 'Public input fields',
  required: 'Required',
  optional: 'Optional',
  inputHint: 'These fields are for input preparation only; internal workflows are never displayed.',
  chatExecution: 'Execute in DSH chat',
  chatExecutionDetail: 'Select a SkillBot in chat, prepare inputs, and obtain a server quote. Every execution requires explicit DSH approval; this page has no execution control.',
  noSchema: 'This SkillBot exposes no public input fields.',
  runs: 'Recent runs',
  noRuns: 'No runs yet.',
  runRefresh: 'Refresh status',
  error: 'Unable to load Loomloom information.',
  account: 'ShengSuanYun account',
  accountConnected: 'Connected',
  signInPrompt: 'Register or sign in to start chatting',
  accountId: 'User ID',
  balance: 'Balance',
  accountRole: 'Role',
  creator: 'Creator',
  user: 'User',
  close: 'Close',
  accountUnavailable: 'Account details are temporarily unavailable; the connection is still active.',
  marketEntry: 'Cloud SkillBots',
  marketEyebrow: 'LoomLoom Market',
  marketTitle: 'Cloud SkillBot Market',
  marketSkillbots: 'Available SkillBots',
  marketEmpty: 'No SkillBots are currently available.',
  free: 'Free',
  selectPlaceholder: 'Select an option',
  storefrontUnconfigured: 'No storefront is configured for this build.',
  storefrontCreatorKeyMissing: 'The storefront needs a creator credential to list their SkillBots, and the environment did not provide one. Configure it and restart.',
  storefrontUnconfiguredHint: 'This client only presents SkillBots fixed at build time; ask the maintainer to set storefrontListingIds.',
  storefrontUnavailable: '{count} SkillBot(s) are no longer listed and have been hidden.',
  staleStorefront: 'Showing the last cached result; the refresh did not succeed.',
  storefrontRefreshFailed: 'The storefront refresh failed: {message}',
  versionLabel: 'Version',
  updatedAtLabel: 'Updated',
  creatorLabel: 'Creator',
  closeCall: 'Close',
  requiredMissing: 'Fill in every required field first.',
  chooseFile: 'Choose file',
  uploading: 'Uploading…',
  uploadFailed: 'The file could not be uploaded. Please try again.',
  clearFile: 'Remove',
  promptInvocation: [
    'Please invoke the cloud SkillBot through the Loomloom tools.',
    '- SkillBot: {name}',
    '- listing id: {listingId}',
    '- inputs I filled in:',
    '{input}',
    '',
    'Then proceed in order: read the fields with loomloom_get_skillbot and validate them; create a draft with loomloom_prepare_execution and tell me the estimated fee; execute with loomloom_execute_skillbot once I approve; finally summarise with loomloom_get_run and loomloom_get_run_results, presenting the result as a readable table.',
  ].join('\n'),
  promptNoInput: '(I have not filled in any inputs yet; collect the required ones from me first.)',
  previewInputs: 'Preview inputs',
  previewTitle: 'Inputs',
  callInChat: 'Call in chat',
  authRequired: 'Connecting ShengSuanYun is required before calling a cloud SkillBot.',
  authContinueHint: 'After authorizing, this call continues in the conversation automatically.',
  credentialUnavailable: 'The ShengSuanYun connection could not be confirmed. Please try again.',
  sendFailed: 'The call could not be started in the conversation.',
  preparingCall: 'Starting…',
  marketSubtitle: 'One creator’s SkillBot workstation: prepare the inputs here; the call and its result happen in the DSH conversation.',
  marketSearchPlaceholder: 'Search name or description…',
  marketSearchLabel: 'Search SkillBots',
  marketSearchEmpty: 'No SkillBot matches this search.',
  marketCount: '{count} SkillBot(s) available',
  marketInputs: '{count} input(s)',
  marketUpdated: 'Updated {date}',
  marketCreator: 'By {name}',
  previewInputsShort: 'Inputs',
  previewStepsTitle: 'What happens after you submit',
  previewStepRead: 'The public input fields are read and validated first',
  previewStepQuote: 'A draft is created and the estimated fee is quoted',
  previewStepApprove: 'Nothing runs until you approve that fee',
  previewStepResult: 'The run result lands back in the new conversation',
  previewFeeBarTitle: 'Cost of this call',
  previewFeeBarNote: 'The server confirms the fee before execution; a call that never runs is not charged.',
  dropzoneTitle: 'Click to choose a file',
  dropzoneHint: 'Accepts {types}',
  dropzoneChosen: 'Uploaded',
  runCardTitle: 'SkillBot run result',
  runStatusRunning: 'Running',
  runStatsRows: 'Rows',
  runCompleted: 'Completed',
  runFailed: 'Failed',
  runArtifacts: 'Output artifacts',
  runNoArtifacts: 'This run produced no output artifacts.',
  runDownload: 'Download',
  runCopyId: 'Copy run id',
  runCopied: 'Copied',
  runTruncated: 'Content truncated',
  runOmittedArtifacts: '{count} more artifact(s) not shown',
  runShownRows: 'Showing {shown} of {total} rows',
  runOmittedColumns: '{count} more column(s) omitted',
  runShowAll: 'Show all {count} rows',
  runShowLess: 'Show less',
  runEmptyPayload: 'This artifact has no displayable content.',
  markdownCopy: 'Copy',
  markdownCopied: 'Copied',
  markdownFootnotes: 'Footnotes',
}
