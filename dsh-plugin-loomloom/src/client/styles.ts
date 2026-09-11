const STYLE_ID = 'dsh-plugin-loomloom/styles'

/**
 * The plugin's single global stylesheet.
 *
 * The package has no CSS-modules pipeline (its client bundle is a plain tsdown
 * CommonJS factory), so every rule lives here and rides the platform's semantic
 * `--dsw-*` tokens. Two token rules matter for legibility in the light theme,
 * where `--dsw-alias-bg-base` and every `--dsw-alias-bg-layer-*` resolve to the
 * same white:
 *
 * 1. A page that must separate from the chat canvas uses
 *    `--dsw-specific-sidebar-fill` (the tinted surface DSH itself uses for the
 *    sidebar); cards on it use `--dsw-alias-bg-layer-1`.
 * 2. Outlines use `--dsw-alias-border-l3` (12%) and controls
 *    `--dsw-alias-border-l4` (16%, the strength the shipped `Input` primitive
 *    uses). `--dsw-alias-border-l1` is 4% black and invisible on white, which is
 *    what previously made every card, control and separator disappear.
 *
 * Source order is load-bearing: base rules come first and variant rules after
 * them, because the two have equal specificity. `.loomloomButtonPrimary` used to
 * be written above `.loomloomButton`, so the base rule won and the primary button
 * rendered as a plain one.
 */
const css = `
.loomloomRoot { display: flex; flex-direction: column; gap: 16px; min-width: 0; color: var(--dsw-alias-label-primary); }
.loomloomConnectFlow { display: grid; gap: 12px; }
.loomloomFlowDescription, .loomloomFlowPrivacy, .loomloomFlowDetails p { margin: 0; font-size: 13px; line-height: 20px; }
.loomloomFlowPrivacy, .loomloomFlowDetails p { color: var(--dsw-alias-label-tertiary); }
.loomloomFlowDetails summary { cursor: pointer; font-size: 13px; font-weight: 600; }
.loomloomFlowActions, .loomloomConnectionChecks { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomConnectionChecks { color: var(--dsw-alias-state-success-primary); font-size: 13px; font-weight: 600; }
.loomloomConnectionChecks span { display: inline-flex; align-items: center; gap: 5px; }
.loomloomFlowSteps { display: grid; gap: 6px; margin: 0; padding-left: 22px; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.loomloomFlowSteps li[data-current='true'] { color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomOnboarding { width: min(560px, calc(100vw - 32px)); max-width: none; padding: 0; border: 1px solid var(--dsw-alias-border-l2); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.loomloomOnboarding::backdrop { background: var(--dsw-alias-bg-mask-1); }
.loomloomOnboardingContent { display: grid; gap: 16px; padding: 24px; }
.loomloomOnboardingContent h2 { margin: 0; font-size: 20px; line-height: 28px; }
.loomloomHeader, .loomloomCardTop, .loomloomFieldHead { display: flex; align-items: center; gap: 10px; }
.loomloomHeader { align-items: flex-start; justify-content: space-between; }
.loomloomHeader h2, .loomloomCard h3, .loomloomDetail h3 { margin: 0; font-weight: 600; }
.loomloomHeader h2 { font-size: 18px; line-height: 26px; }
.loomloomHeader p, .loomloomCard p, .loomloomNote p, .loomloomField p { margin: 4px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ── Alerts, notices, empty states ─────────────────────────────────────────
   The tinted fill rides color-mix on the state color, the same construction the
   shipped Tag primitive uses, so one token moves both fill and text. */
.loomloomAlert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; border: 1px solid transparent; border-radius: 10px; font-size: 13px; line-height: 20px; }
.loomloomAlert[data-tone='danger'] { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomAlert[data-tone='warning'] { border-color: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); color: var(--dsw-alias-state-warn-label); }
.loomloomAlert[data-tone='info'] { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.loomloomAlert svg { flex: none; margin-top: 2px; }
.loomloomAlert p { margin: 0; }

/* The dashed band, kept for the states that mean "nothing to show yet". */
.loomloomEmptyBand { display: grid; justify-items: center; gap: 6px; padding: 24px 20px; border: 1px dashed var(--dsw-alias-border-l4); border-radius: 16px; background: var(--dsw-alias-bg-module-platform); text-align: center; }
.loomloomEmptyBand strong { font-size: 14px; line-height: 22px; }
.loomloomEmptyBand p { margin: 0; max-width: 60ch; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }

/* ── Buttons ─────────────────────────────────────────────────────────────── */
.loomloomButton { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 32px; padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 16px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
.loomloomButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.loomloomButton:disabled { cursor: not-allowed; opacity: .45; }
.loomloomButton:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.loomloomButton[data-size='sm'] { min-height: 28px; padding: 3px 10px; font-size: 12px; line-height: 18px; border-radius: 14px; }
/* Declared after the base rule on purpose: equal specificity, later wins. */
.loomloomButtonPrimary { border-color: var(--dsw-alias-button-primary-fill); background: var(--dsw-alias-button-primary-fill); color: var(--dsw-alias-label-primary-foreground); font-weight: 600; }
.loomloomButtonPrimary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover); border-color: var(--dsw-alias-button-primary-hover); }
.loomloomButtonBlock { width: 100%; min-height: 38px; border-radius: 19px; font-size: 14px; }
.loomloomIconButton { appearance: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; min-height: 26px; padding: 2px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.loomloomIconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.loomloomIconButton:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: none; }

/* ── Settings tab ────────────────────────────────────────────────────────── */
.loomloomNote, .loomloomEmpty, .loomloomError { padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); font-size: 13px; line-height: 20px; }
.loomloomError { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 24%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomEmpty { color: var(--dsw-alias-label-tertiary); }
.loomloomGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.loomloomCard { appearance: none; display: flex; flex-direction: column; min-width: 0; min-height: 148px; padding: 14px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomCard:hover { border-color: var(--dsw-alias-border-l4); background: var(--dsw-alias-interactive-bg-hover); }
.loomloomCard:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.loomloomCard[aria-pressed='true'] { border-color: var(--dsw-alias-state-business-primary); }
.loomloomCard h3 { overflow: hidden; font-size: 15px; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomCard p { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.loomloomBadge { margin-left: auto; padding: 1px 8px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 11px; line-height: 18px; white-space: nowrap; }
.loomloomBadge[data-available='true'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.loomloomMeta { margin-top: auto; padding-top: 10px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; }
.loomloomDetail { padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.loomloomDetailHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.loomloomDetailHead h3 { font-size: 15px; line-height: 22px; }
.loomloomFields { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRuns { display: grid; gap: 8px; margin-top: 12px; }
.loomloomRun { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.loomloomRun strong, .loomloomRun code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomRun code { margin-top: 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.loomloomRunStatus { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomField { padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); }
.loomloomFieldHead strong { font-size: 13px; line-height: 20px; }
.loomloomField code { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.loomloomFieldTag { margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomFieldHint { margin: 6px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomNote { border-color: var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-module-platform); }
.loomloomAccountActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; }
.loomloomInlineWarning { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 24%, transparent); border-radius: 10px; background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 8%, transparent); }
.loomloomInlineWarning p { display: flex; align-items: flex-start; gap: 6px; margin: 0; font-size: 13px; line-height: 20px; }
.loomloomInlineWarning svg { flex: none; margin-top: 3px; }

/* ── Sidebar identity + navigation ───────────────────────────────────────── */
.loomloomIdentityAction { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 44px; padding: 6px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.loomloomIdentityAction:hover, .loomloomIdentityAction:focus-visible { border-color: var(--dsw-alias-border-l2); background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover)); outline: none; }
.loomloomIdentityAvatar { display: inline-flex; flex: 0 0 28px; align-items: center; justify-content: center; width: 28px; height: 28px; overflow: hidden; border-radius: 50%; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 700; }
.loomloomIdentityAvatar img { width: 100%; height: 100%; object-fit: cover; }
.loomloomIdentityCopy { display: grid; min-width: 0; gap: 1px; }
.loomloomIdentityCopy strong, .loomloomIdentityCopy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomIdentityCopy strong { font-size: 13px; line-height: 18px; }
.loomloomIdentityCopy small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomIdentityDetails { display: grid; gap: 16px; }
.loomloomIdentityProfile { display: flex; align-items: center; gap: 12px; }
.loomloomIdentityAvatarLarge { width: 44px; height: 44px; flex-basis: 44px; font-size: 16px; }
.loomloomIdentityProfile div { display: grid; gap: 2px; min-width: 0; }
.loomloomIdentityProfile span { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px 16px; margin: 0; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); }
.loomloomIdentityFacts dt { color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.loomloomIdentityFacts dd { margin: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomSidebarNav { appearance: none; display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 5px 8px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px; text-align: left; cursor: pointer; }
.loomloomSidebarNav:not([data-wide]) { justify-content: center; padding-inline: 0; }
.loomloomSidebarNav:hover, .loomloomSidebarNav:focus-visible { background: var(--dsw-specific-sidebar-nav-item-hover, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-primary); outline: none; }
.loomloomSidebarNav:focus-visible { border-color: var(--dsw-alias-state-business-primary); }
.loomloomSidebarNav[aria-current='page'] { background: var(--dsw-specific-sidebar-nav-item-active, var(--dsw-alias-interactive-bg-hover)); color: var(--dsw-alias-label-primary); font-weight: 600; }
.loomloomSidebarNavLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketGlyph { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 6px; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-primary-foreground); font-size: 11px; font-weight: 700; }

/* ── Market surface ────────────────────────────────────────────────────────
   Tinted page + white cards: the same hierarchy the reference storefront uses,
   and the only pairing that stays legible in both themes given the light theme's
   flattened background layers. */
.loomloomMarketPage { width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-specific-sidebar-fill); }
.loomloomMarketPanel { display: grid; grid-template-rows: auto minmax(0, 1fr); width: 100%; height: 100%; overflow: hidden; }
.loomloomMarketHeader { padding: 26px 0 18px; border-bottom: 1px solid var(--dsw-alias-border-l3); background: var(--dsw-alias-bg-base); }
.loomloomMarketHeaderInner { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; width: min(1040px, calc(100% - 96px)); margin: 0 auto; }
.loomloomMarketHeaderMain { min-width: 0; }
.loomloomMarketHeader h2 { margin: 0; font-size: 20px; line-height: 28px; font-weight: 600; }
.loomloomMarketEyebrow { margin: 0 0 4px; color: var(--dsw-alias-label-tertiary); font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
.loomloomMarketSubtitle { margin: 6px 0 0; max-width: 68ch; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomMarketToolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomMarketSearch { width: min(260px, 100%); }
.loomloomMarketBody { width: min(1040px, calc(100% - 96px)); min-height: 0; overflow: auto; margin: 0 auto; padding: 20px 0 48px; }
.loomloomMarketSummary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin: 0 0 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomMarketSummary strong { color: var(--dsw-alias-label-primary); font-size: 15px; line-height: 22px; font-weight: 600; }
.loomloomMarketSummary span { font-variant-numeric: tabular-nums; }
.loomloomMarketCards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; align-items: stretch; }
.loomloomMarketCard { display: flex; flex-direction: column; min-width: 0; padding: 16px; border: 1px solid var(--dsw-alias-border-l3); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.loomloomMarketCard:hover { border-color: var(--dsw-alias-border-l4); }
.loomloomMarketCardHead { display: flex; align-items: center; gap: 10px; min-width: 0; }
.loomloomMarketAvatar { display: inline-flex; flex: 0 0 36px; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: 12px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 15px; font-weight: 700; }
.loomloomMarketCardTitle { display: grid; min-width: 0; gap: 2px; }
.loomloomMarketCardTitle strong { overflow: hidden; font-size: 14px; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketCardTitle span { overflow: hidden; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.loomloomMarketChips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 12px; }
/* The pinned runtime's ui-primitives ships no read-only badge (the newer source
   has Tag, the vendored 0.1.2 build does not), so the 11px capsule is local.
   Tones ride the same color-mix construction the shared atoms use. */
.loomloomChip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border: 1px solid transparent; border-radius: 999px; font-size: 11px; line-height: 17px; font-weight: 500; white-space: nowrap; }
.loomloomChip[data-tone='outline'] { border-color: var(--dsw-alias-border-l4); color: var(--dsw-alias-label-secondary); }
.loomloomChip[data-tone='neutral'] { background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); }
.loomloomChip[data-tone='quiet'] { color: var(--dsw-alias-label-tertiary); }
.loomloomChip[data-tone='info'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 10%, transparent); color: var(--dsw-alias-state-business-primary); }
.loomloomChip[data-tone='success'] { background: color-mix(in srgb, var(--dsw-alias-state-success-primary) 10%, transparent); color: var(--dsw-alias-state-success-primary); }
.loomloomChip[data-tone='warning'] { background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 12%, transparent); color: var(--dsw-alias-state-warn-label); }
.loomloomChip[data-tone='danger'] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
.loomloomMarketDesc { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; margin: 10px 0 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomMarketCardFoot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; margin-top: auto; padding-top: 14px; }
.loomloomMarketFee { display: grid; gap: 1px; }
.loomloomMarketFee strong { color: var(--dsw-alias-state-business-primary); font-size: 15px; line-height: 22px; font-variant-numeric: tabular-nums; }
.loomloomMarketFee small { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomMarketActions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.loomloomMarketSkeleton { display: grid; gap: 10px; padding: 16px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 14px; background: var(--dsw-alias-bg-layer-1); }
.loomloomMarketSkeleton span { height: 12px; border-radius: 6px; background: var(--dsw-alias-bg-skeleton); }
.loomloomMarketSkeleton span:nth-child(1) { width: 60%; height: 16px; }
.loomloomMarketSkeleton span:nth-child(2) { width: 90%; }
.loomloomMarketSkeleton span:nth-child(3) { width: 45%; }

/* ── Preview dialog ────────────────────────────────────────────────────────
   The shipped Modal primitive supplies the mask, radius, elevation and Escape
   handling; these rules only widen the card and lay out the form. */
.loomloomDialog { width: min(680px, calc(100vw - 48px)); max-height: min(820px, calc(100vh - 48px)); }
.loomloomDialogNarrow { width: min(420px, calc(100vw - 48px)); max-height: min(680px, calc(100vh - 48px)); }
.loomloomDialogScroll { min-height: 0; overflow: auto; }
.loomloomDialogMeta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin: 0 0 14px; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomDialogMeta span { display: inline-flex; align-items: center; gap: 5px; }
.loomloomDialogBody { display: grid; gap: 16px; }
.loomloomDialogText { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 20px; }
.loomloomDialogSection { display: grid; gap: 10px; }
.loomloomDialogSection > h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.loomloomFieldList { display: grid; gap: 14px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-module-platform); }
.loomloomFieldRow { display: grid; gap: 6px; }
.loomloomFieldLabel { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; font-weight: 500; }
.loomloomFieldRequired { color: var(--dsw-alias-state-error-primary); }
.loomloomFieldNote { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomInput { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; }
.loomloomInput::placeholder { color: var(--dsw-alias-label-dimmed); }
.loomloomInput:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomTextarea { box-sizing: border-box; width: 100%; min-height: 76px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; resize: vertical; }
.loomloomTextarea::placeholder { color: var(--dsw-alias-label-dimmed); }
.loomloomTextarea:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomSelect { box-sizing: border-box; width: 100%; min-height: 34px; padding: 6px 30px 6px 10px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 8px; background-color: var(--dsw-alias-bg-layer-1); background-image: linear-gradient(45deg, transparent 50%, var(--dsw-alias-label-secondary) 50%), linear-gradient(135deg, var(--dsw-alias-label-secondary) 50%, transparent 50%); background-position: calc(100% - 16px) 15px, calc(100% - 11px) 15px; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat; color: var(--dsw-alias-label-primary); font: inherit; font-size: 13px; line-height: 20px; appearance: none; }
.loomloomSelect:focus-visible { border-color: var(--dsw-alias-state-business-primary); outline: 2px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); outline-offset: 0; }
.loomloomCheckboxRow { display: flex; align-items: center; gap: 8px; font-size: 13px; line-height: 20px; }
.loomloomCheckboxRow input { width: 16px; height: 16px; accent-color: var(--dsw-alias-state-business-primary); }
.loomloomDropzone { position: relative; display: grid; justify-items: center; gap: 6px; padding: 20px 16px; border: 1px dashed var(--dsw-alias-border-l4); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); text-align: center; cursor: pointer; }
.loomloomDropzone:focus-within { border-color: var(--dsw-alias-state-business-primary); }
.loomloomDropzone[data-filled='true'] { cursor: default; }
.loomloomDropzone > svg { color: var(--dsw-alias-label-tertiary); }
.loomloomDropzone strong { font-size: 13px; line-height: 20px; font-weight: 500; }
.loomloomDropzone small { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
/* The native control stays the accessible one; the label is the affordance. */
.loomloomDropzoneInput { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.loomloomDropzoneFilled { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; width: 100%; text-align: left; }
.loomloomFileChip { display: inline-flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 10px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomFileChip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.loomloomSteps { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }
.loomloomSteps li { display: flex; align-items: flex-start; gap: 6px; }
.loomloomSteps svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-success-primary); }
.loomloomFeeBar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 10px 14px; border-radius: 12px; background: var(--dsw-alias-interactive-bg-hover); }
.loomloomFeeBar div { display: grid; gap: 2px; }
.loomloomFeeBar strong { font-size: 13px; line-height: 20px; }
.loomloomFeeBar small { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.loomloomFeeBarValue { color: var(--dsw-alias-state-business-primary); font-size: 18px; line-height: 24px; font-weight: 600; font-variant-numeric: tabular-nums; }
.loomloomDialogFooter { display: grid; gap: 10px; }

/* ── Run result card ───────────────────────────────────────────────────────
   Rendered inside a conversation turn, so it borrows the tool-card shape: a
   bordered surface, a status head, then one block per output artifact. */
.loomloomResultCard { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.loomloomResultHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomResultHead h4 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.loomloomResultStats { display: flex; flex-wrap: wrap; gap: 14px; margin: 0; }
.loomloomStat { display: grid; gap: 1px; }
.loomloomStat dt { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomStat dd { margin: 0; font-size: 13px; line-height: 20px; font-variant-numeric: tabular-nums; }
.loomloomResultArtifacts { display: grid; gap: 10px; }
.loomloomResultArtifact { display: grid; gap: 8px; padding: 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-module-platform); }
.loomloomResultArtifactHead { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.loomloomResultArtifactHead strong { font-size: 13px; line-height: 20px; }
.loomloomResultArtifactHead a { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; color: var(--dsw-alias-link); font-size: 12px; line-height: 18px; text-decoration: none; }
.loomloomResultArtifactHead a:hover { text-decoration: underline; }
.loomloomResultTableWrap { max-height: 320px; overflow: auto; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); scrollbar-width: thin; scrollbar-color: var(--dsw-alias-label-tertiary) transparent; }
.loomloomResultTableWrap::-webkit-scrollbar { width: 8px; height: 8px; }
.loomloomResultTableWrap::-webkit-scrollbar-thumb { border-radius: 4px; background: var(--dsw-alias-label-tertiary); }
.loomloomResultTableWrap::-webkit-scrollbar-track { background: transparent; }
.loomloomResultTable { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }
.loomloomResultTable th, .loomloomResultTable td { max-width: 320px; padding: 7px 10px; border-bottom: 1px solid var(--dsw-alias-border-l2); text-align: left; vertical-align: top; }
.loomloomResultTable th { position: sticky; top: 0; z-index: 1; background: var(--dsw-alias-bg-module-platform); color: var(--dsw-alias-label-secondary); font-weight: 600; white-space: nowrap; }
.loomloomResultTable tr:last-child td { border-bottom: 0; }
.loomloomResultTable td { color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.loomloomResultNote { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }
.loomloomResultHead .loomloomIconButton { margin-left: auto; }

@media (max-width: 900px) {
  .loomloomMarketHeader { padding: 20px 0 14px; }
  .loomloomMarketHeaderInner, .loomloomMarketBody { width: calc(100% - 48px); }
}
@media (max-width: 680px) {
  .loomloomHeader { align-items: stretch; flex-direction: column; }
  .loomloomGrid { grid-template-columns: 1fr; }
  .loomloomMarketCards { grid-template-columns: 1fr; }
}
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
