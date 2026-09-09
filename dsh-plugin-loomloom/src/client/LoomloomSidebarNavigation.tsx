import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { setLoomloomMarketActive, useLoomloomMarketActive } from './market-navigation.js'

type SidebarNavigationProps = PropsLocale<'loomloom'> & {
  readonly wide: boolean
}

export function LoomloomSidebarNavigation({ t, wide }: SidebarNavigationProps) {
  const active = useLoomloomMarketActive()
  return (
    <button
      className="loomloomSidebarNav"
      type="button"
      title={wide ? undefined : t('marketEntry')}
      aria-label={t('marketEntry')}
      aria-current={active ? 'page' : undefined}
      data-wide={wide || undefined}
      onClick={() => { setLoomloomMarketActive(!active) }}
    >
      <span className="loomloomMarketGlyph" aria-hidden="true">云</span>
      {wide && <span className="loomloomSidebarNavLabel">{t('marketEntry')}</span>}
    </button>
  )
}
