import type { LoomBootstrap } from './api.js'

/**
 * Which surface the connection flow shows for one bootstrap reading.
 *
 * `authorizing` is driven by a browser sign-in, never by the bootstrap, so it is
 * absent here.
 */
export type ConnectStage = 'loading' | 'unconfigured' | 'authorizing' | 'model-selection' | 'connected'

/**
 * Decides the stage from the Host's readiness facts.
 *
 * The Host verifies the chat model against the ShengSuanYun route and names an
 * `id` only when the agent default model sits on that route. A model selected on
 * any other route therefore arrives as `id === undefined`, and it must NOT hold a
 * first-run surface open: the credential is what onboarding owns, and a blocking
 * dialog with no way out is worse than an unverified model the user can still fix
 * in Settings.
 * @param value - the Host's non-secret readiness facts.
 * @returns the stage to render.
 */
export function connectStage(value: LoomBootstrap): ConnectStage {
  if (!value.credential.configured) return 'unconfigured'
  if (value.loom !== 'ready' || value.router !== 'ready') return 'unconfigured'
  if (value.model.ready || value.model.id === undefined) return 'connected'
  return 'model-selection'
}
