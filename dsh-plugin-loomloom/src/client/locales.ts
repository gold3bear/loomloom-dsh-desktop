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
  | 'loomReady'
  | 'chatModelReady'
  | 'connectedHint'
  | 'createFirstChat'
  | 'signOut'
  | 'signingOut'
  | 'refresh'
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
  | 'backToMarket'
  | 'skillbot'
  | 'free'
  | 'selectPlaceholder'
  | 'getQuote'
  | 'estimatedPayable'
  | 'confirmExecute'
  | 'executionSubmitted'

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
  loomReady: 'Loomloom 可用',
  chatModelReady: '聊天模型可用',
  connectedHint: '胜算云已连接，可以开始聊天。',
  createFirstChat: '创建第一段聊天',
  signOut: '退出登录',
  signingOut: '正在退出…',
  refresh: '刷新',
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
  backToMarket: '返回市场',
  skillbot: '技能体',
  free: '免费',
  selectPlaceholder: '请选择',
  getQuote: '获取报价',
  estimatedPayable: '预计应付',
  confirmExecute: '确认并执行',
  executionSubmitted: '已提交运行',
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
  loomReady: 'Loomloom available',
  chatModelReady: 'Chat model available',
  connectedHint: 'ShengSuanYun is connected and ready for chat.',
  createFirstChat: 'Create first chat',
  signOut: 'Sign out',
  signingOut: 'Signing out…',
  refresh: 'Refresh',
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
  backToMarket: 'Back to market',
  skillbot: 'SkillBot',
  free: 'Free',
  selectPlaceholder: 'Select an option',
  getQuote: 'Get quote',
  estimatedPayable: 'Estimated payable',
  confirmExecute: 'Confirm and execute',
  executionSubmitted: 'Run submitted',
}
