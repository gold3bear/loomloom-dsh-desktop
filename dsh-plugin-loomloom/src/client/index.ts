import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createElement, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { LoomloomLocaleKey } from './locales.js'
import { LoomloomOnboarding } from './LoomloomConnectFlow.js'
import { LoomloomSettingsTab } from './LoomloomSettingsTab.js'
import { LoomloomIdentityAction } from './LoomloomIdentityAction.js'
import { LoomloomMarketPage } from './LoomloomMarketPage.js'
import { LoomloomSidebarNavigation } from './LoomloomSidebarNavigation.js'
import {
  installLoomloomSessionNavigationBridge,
  setLoomloomMarketActive,
  useLoomloomMarketActive,
} from './market-navigation.js'
import { en, zh } from './locales.js'
import { installLoomloomStyles } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    loomloom: LoomloomLocaleKey
  }
}

interface ClientSessions {
  clear(): void
  readonly list: {
    getSnapshot(): { readonly current?: unknown }
    subscribe(listener: () => void): () => void
  }
}

export const inject = ['slots', 'locale', 'sessions']
export const NS = 'loomloom'

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as ClientSessions
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'loomloom: dictionaries')
  ctx.effect(() => installLoomloomStyles(), 'loomloom: styles')
  ctx.effect(() => {
    setLoomloomMarketActive(false)
    return () => { setLoomloomMarketActive(false) }
  }, 'loomloom: navigation state')
  ctx.effect(
    () => installLoomloomSessionNavigationBridge(),
    'loomloom: session navigation bridge',
  )
  ctx.effect(() => {
    let current = sessions.list.getSnapshot().current
    return sessions.list.subscribe(() => {
      const next = sessions.list.getSnapshot().current
      if (next === current) return
      current = next
      setLoomloomMarketActive(false)
    })
  }, 'loomloom: session selection navigation')
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'loomloom',
    order: 30,
    label: () => ctx.locale.bind(NS)('tab'),
    locale: NS,
  }, LoomloomSettingsTab))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'loomloom-identity',
    order: 0,
    locale: NS,
  }, LoomloomIdentityAction))
  ctx.slots.inject('sidebar.primary.navigation', () => ctx.slots.register({
    name: 'sidebar.primary.navigation',
    id: 'loomloom-market',
    order: 0,
    locale: NS,
  }, LoomloomSidebarNavigation))
  ctx.slots.inject('main.surface', () => {
    const MainSurface = ({ defaultContent }: { readonly defaultContent: ReactNode }) => {
      const active = useLoomloomMarketActive()
      return active
        ? createElement(LoomloomMarketPage, { t: ctx.locale.bind(NS) })
        : defaultContent
    }
    return ctx.slots.register({
      name: 'main.surface',
      locale: NS,
    }, MainSurface)
  })
  ctx.slots.inject('settings.onboarding', () => {
    const Onboarding = (props: Parameters<typeof LoomloomOnboarding>[0]) =>
      createElement(LoomloomOnboarding, {
        ...props,
        onCreateFirstChat: () => {
          props.complete()
          sessions.clear()
        },
      })
    return ctx.slots.register({
      name: 'settings.onboarding',
      id: 'loomloom-connect',
      order: -50,
      label: () => ctx.locale.bind(NS)('connectionTitle'),
      locale: NS,
    }, Onboarding)
  })
}
