import { readBootstrap, readCredentialStatus } from './api.js'

export type ConnectionState = 'already-configured' | 'unconfigured' | 'model-selection' | 'connected' | 'unavailable'

interface ConnectionSource {
  readonly credential: typeof readCredentialStatus
  readonly bootstrap: typeof readBootstrap
}

/** First-run prompting depends on credential presence, not live model readiness. */
export async function readConnectionState(
  onboarding: boolean,
  source: ConnectionSource = { credential: readCredentialStatus, bootstrap: readBootstrap },
): Promise<ConnectionState> {
  if (onboarding) {
    const status = await source.credential()
    return status.configured ? 'already-configured' : 'unconfigured'
  }
  const value = await source.bootstrap()
  if (!value.credential.configured) return 'unconfigured'
  if (value.loom !== 'ready' || value.router !== 'ready') return 'unavailable'
  return value.model.ready ? 'connected' : 'model-selection'
}
