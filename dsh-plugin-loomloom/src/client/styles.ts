const STYLE_ID = 'dsh-plugin-loomloom/styles'

const css = `
.loomloomRoot { display: flex; flex-direction: column; gap: 16px; min-width: 0; color: var(--dsw-alias-label-primary); }
.loomloomConnectFlow { display: grid; gap: 12px; }
.loomloomFlowDescription, .loomloomFlowPrivacy, .loomloomFlowDetails p { margin: 0; font-size: 13px; line-height: 20px; }
.loomloomFlowPrivacy, .loomloomFlowDetails p { color: var(--dsw-alias-label-tertiary); }
.loomloomFlowDetails summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.loomloomFlowActions, .loomloomConnectionChecks { display: flex; flex-wrap: wrap; gap: 8px; }
.loomloomConnectionChecks { color: var(--dsw-alias-state-success); font-size: 13px; font-weight: 600; }
.loomloomFlowSteps { display: grid; gap: 6px; margin: 0; padding-left: 22px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.loomloomFlowSteps li[data-current='true'] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomButtonPrimary { border-color: var(--dsw-alias-state-business-primary); background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-on-color); }
.loomloomButtonPrimary:hover { background: var(--dsw-alias-state-business-primary-hover, var(--dsw-alias-state-business-primary)); }
.loomloomInlineWarning { padding: 10px 12px; border: 1px solid var(--dsw-alias-state-warning); border-radius: 7px; }
.loomloomInlineWarning p { margin: 0 0 8px; font-size: 13px; line-height: 20px; }
.loomloomOnboarding { width: min(560px, calc(100vw - 32px)); max-width: none; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.loomloomOnboarding::backdrop { background: rgb(0 0 0 / 45%); }
.loomloomOnboardingContent { display: grid; gap: 16px; padding: 24px; }
.loomloomOnboardingContent h2 { margin: 0; font-size: 20px; line-height: 28px; }
.loomloomHeader, .loomloomStatus, .loomloomCardTop, .loomloomFieldHead { display: flex; align-items: center; gap: 10px; }
.loomloomHeader { align-items: flex-start; justify-content: space-between; }
.loomloomHeader h2, .loomloomCard h3, .loomloomDetail h3 { margin: 0; font-weight: 600; }
.loomloomHeader h2 { font-size: 18px; line-height: 26px; }
.loomloomHeader p, .loomloomCard p, .loomloomNote p, .loomloomField p { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.loomloomButton { appearance: none; min-height: 32px; padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); color: inherit; font: inherit; cursor: pointer; }
.loomloomButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.loomloomButton:focus-visible, .loomloomCard:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.loomloomStatus, .loomloomNote, .loomloomEmpty, .loomloomError { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 20px; }
.loomloomStatusMark { width: 8px; height: 8px; border-radius: 50%; background: var(--dsw-alias-label-tertiary); }
.loomloomStatus[data-ready='true'] .loomloomStatusMark { background: var(--dsw-alias-state-success); }
.loomloomGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.loomloomCard { appearance: none; display: flex; flex-direction: column; min-width: 0; min-height: 148px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-3); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomCard:hover { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-interactive-bg-hover); }
.loomloomCard h3 { overflow: hidden; font-size: 15px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomCard p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.loomloomBadge { margin-left: auto; padding: 1px 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: nowrap; }
.loomloomBadge[data-available='true'] { color: var(--dsw-alias-state-success); }
.loomloomMeta { margin-top: auto; padding-top: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomDetail { padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.loomloomDetailHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.loomloomFields { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRuns { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRun { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); }
.loomloomRun strong, .loomloomRun code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomRun code { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.loomloomRunStatus { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomField { padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); }
.loomloomFieldHead strong { font-size: 13px; line-height: 20px; }
.loomloomField code { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomFieldTag { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomNote { border-color: var(--dsw-alias-state-business-tertiary); }
.loomloomIdentityAction { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomIdentityAction:hover, .loomloomIdentityAction:focus-visible { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.loomloomIdentityAvatar { display: inline-flex; flex: 0 0 28px; align-items: center; justify-content: center; width: 28px; height: 28px; overflow: hidden; border-radius: 50%; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 700; }
.loomloomIdentityAvatar img { width: 100%; height: 100%; object-fit: cover; }
.loomloomIdentityCopy { display: grid; min-width: 0; gap: 1px; }
.loomloomIdentityCopy strong, .loomloomIdentityCopy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomIdentityCopy strong { font-size: 13px; line-height: 18px; }
.loomloomIdentityCopy small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomIdentityOverlay { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: flex-end; justify-content: flex-start; padding: 16px; background: rgb(0 0 0 / 18%); }
.loomloomIdentityDialog { width: min(420px, calc(100vw - 32px)); max-height: min(680px, calc(100vh - 32px)); overflow: auto; padding: 18px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 14px 40px rgb(0 0 0 / 18%); }
.loomloomIdentityDialogHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.loomloomIdentityDialogHeader h2 { margin: 0; font-size: 17px; line-height: 24px; }
.loomloomIdentityClose { width: 32px; height: 32px; border: 0; border-radius: 6px; background: transparent; color: inherit; font-size: 22px; cursor: pointer; }
.loomloomIdentityClose:hover, .loomloomIdentityClose:focus-visible { background: var(--dsw-alias-interactive-bg-hover); outline: none; }
.loomloomIdentityDetails { display: grid; gap: 16px; }
.loomloomIdentityProfile { display: flex; align-items: center; gap: 12px; }
.loomloomIdentityAvatarLarge { width: 44px; height: 44px; flex-basis: 44px; font-size: 16px; }
.loomloomIdentityProfile div { display: grid; gap: 2px; min-width: 0; }
.loomloomIdentityProfile span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; }
.loomloomIdentityFacts dt { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts dd { margin: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomSidebarNav { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 5px 8px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.loomloomSidebarNav:not([data-wide]) { justify-content: center; padding-inline: 0; }
.loomloomSidebarNav:hover, .loomloomSidebarNav:focus-visible { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); outline: none; }
.loomloomSidebarNav:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.loomloomSidebarNav[aria-current='page'] { background: var(--dsw-alias-interactive-bg-selected, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomSidebarNavLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketGlyph { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 5px; background: var(--dsw-alias-state-business-primary); color: white; font-size: 11px; font-weight: 700; }
.loomloomMarketPage { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base); }
.loomloomMarketPanel { display: grid; grid-template-rows: auto minmax(0, 1fr); width: 100%; height: 100%; overflow: hidden; background: var(--dsw-alias-bg-base); }
.loomloomMarketHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 28px 48px 18px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.loomloomMarketHeader h2, .loomloomMarketDetailTitle h3 { margin: 0; font-size: 20px; line-height: 28px; }
.loomloomMarketEyebrow { margin: 0 0 3px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.loomloomMarketBody { width: min(920px, calc(100% - 96px)); min-height: 0; overflow: auto; margin: 0 auto; padding: 24px 0 40px; }
.loomloomMarketSectionHead, .loomloomMarketDetailTitle, .loomloomMarketQuote { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.loomloomMarketSectionHead h3 { margin: 0; font-size: 15px; line-height: 22px; }
.loomloomMarketList { display: grid; gap: 8px; }
/* The row is a container, not a button: the preview control sits beside the row
   action, and nesting one button inside another is invalid. */
.loomloomMarketItem { display: flex; align-items: center; gap: 4px; width: 100%; padding: 0 6px 0 0; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); }
.loomloomMarketItem:hover, .loomloomMarketItem:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.loomloomMarketItemOpen { display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: 12px; min-width: 0; padding: 12px 14px; border: 0; border-radius: 7px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomMarketItemOpen:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.loomloomMarketPreview { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 44px; height: 44px; border: 1px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 15px; cursor: pointer; }
.loomloomMarketPreview:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.loomloomMarketPreview:focus-visible { border-color: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary); outline: none; }
.loomloomMarketItemMain { display: grid; min-width: 0; gap: 3px; }
.loomloomMarketItemMain strong, .loomloomMarketItemMain small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketItemMain strong { font-size: 13px; }
.loomloomMarketItemMain small { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomMarketItemMeta { color: var(--dsw-alias-label-secondary); font-size: 12px; white-space: nowrap; }
.loomloomMarketBack { margin-bottom: 16px; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.loomloomMarketDetail { display: grid; gap: 16px; }
.loomloomMarketForm { display: grid; gap: 12px; }
.loomloomMarketField { display: grid; gap: 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomMarketField input:not([type='checkbox']), .loomloomMarketField select { box-sizing: border-box; width: 100%; min-height: 36px; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 6px; background: var(--dsw-alias-bg-layer-3); color: var(--dsw-alias-label-primary); font: inherit; }
.loomloomMarketField input:focus, .loomloomMarketField select:focus { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid rgb(52 101 255 / 18%); }
.loomloomMarketField small { color: var(--dsw-alias-label-tertiary); line-height: 18px; }
.loomloomMarketQuote { padding: 12px 14px; border: 1px solid var(--dsw-alias-state-business-tertiary); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); }
.loomloomMarketQuote strong { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.loomloomMarketSuccess { padding: 10px 12px; border: 1px solid var(--dsw-alias-state-success); border-radius: 7px; color: var(--dsw-alias-state-success); font-size: 12px; }
.loomloomMarketSuccess code { color: inherit; }
.loomloomMarketNotice { padding: 10px 12px; border: 1px solid var(--dsw-alias-state-warning); border-radius: 7px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomMarketFacts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 14px; margin: 0; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); }
.loomloomMarketFacts dt { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomMarketFacts dd { margin: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomCallOverlay { position: fixed; z-index: 2000; inset: 0; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(0 0 0 / 28%); }
.loomloomCallDialog { width: min(620px, calc(100vw - 48px)); max-height: min(760px, calc(100vh - 48px)); overflow: auto; padding: 20px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); box-shadow: 0 14px 40px rgb(0 0 0 / 20%); }
.loomloomCallHeader { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
.loomloomCallHeader h3 { margin: 0; font-size: 17px; line-height: 24px; }
.loomloomFileRow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.loomloomFileRow small { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomRunRows { display: grid; gap: 6px; margin-top: 10px; }
.loomloomRunRow { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: start; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsw-alias-bg-layer-3); font-size: 12px; }
.loomloomRunRow[data-failed='true'] { border-color: var(--dsw-alias-state-warning); }
.loomloomRunRowIndex { color: var(--dsw-alias-label-tertiary); }
.loomloomRunArtifact { display: grid; gap: 4px; }
.loomloomRunArtifact pre { margin: 0; max-height: 200px; overflow: auto; padding: 8px; border-radius: 6px; background: var(--dsw-alias-bg-layer-1); font-size: 11px; white-space: pre-wrap; word-break: break-word; }
.loomloomRunArtifact a { color: var(--dsw-alias-state-business-primary); font-size: 12px; }
.loomloomRunStep { color: var(--dsw-alias-state-warning); font-size: 11px; }
@media (max-width: 680px) { .loomloomHeader { align-items: stretch; flex-direction: column; } .loomloomGrid { grid-template-columns: 1fr; } }
@media (max-width: 720px) { .loomloomMarketHeader { padding: 22px 24px 16px; } .loomloomMarketBody { width: calc(100% - 48px); } }
`

export function installLoomloomStyles(): () => void {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = css
    document.head.append(style)
  }
  return () => { style?.remove() }
}
