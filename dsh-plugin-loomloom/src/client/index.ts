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
import type { SkillbotSessions } from './skillbot-prompt.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    loomloom: LoomloomLocaleKey
  }
}

/**
 * The client sessions service.
 *
 * Structurally narrowed to what this plugin uses — the selection feed for the
 * market surface, and the addressing/send route the conversation handoff needs.
 * `loomloom` deliberately does not take a dependency on the session-controller
 * package for a handful of members.
 */
/** The workspace-controller client face, narrowed to the group lookup. */
interface ClientWorkspaces {
  readonly list: {
    getSnapshot(): {
      readonly items: readonly {
        readonly workspaceId: string
        readonly sessionIds: readonly string[]
      }[]
    }
  }
}

interface ClientSessions extends SkillbotSessions {
  clear(): void
  readonly list: {
    getSnapshot(): { readonly current?: string }
    subscribe(listener: () => void): () => void
  }
}

// The handoff submits through `sessions.binding(id).session.prompt(...)` — both
// published verbs. Two services are deliberately NOT injected: the conversation
// service, whose scope-addressed `send` cannot be reached from a root plugin (see
// `skillbot-prompt.ts`), and the workspace controller, which is read lazily and
// degrades to "no group known" rather than blocking the plugin from loading.
export const inject = ['slots', 'locale', 'sessions']
export const NS = 'loomloom'

export function apply(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as ClientSessions
  /**
   * Which workspace a session sits in — the key the sidebar groups by.
   *
   * A session row does not carry it, so it comes from the workspace list: the entry
   * whose membership contains the session. Read at click time rather than at apply
   * time on purpose — `ctx.get` is strict about the provider fiber being settled,
   * and reading it during composition is what silently downgraded the storefront
   * cache to memory-only. A composition without the workspace controller yields no
   * group, and the caller falls back to the host default.
   */
  const workspaceOf = (sessionId: string): string | undefined => {
    const workspaces = ctx.get('workspaces') as ClientWorkspaces | undefined
    if (workspaces === undefined) return undefined
    return workspaces.list.getSnapshot().items
      .find(item => item.sessionIds.includes(sessionId))?.workspaceId
  }
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
        ? createElement(LoomloomMarketPage, { t: ctx.locale.bind(NS), sessions, workspaceOf })
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
