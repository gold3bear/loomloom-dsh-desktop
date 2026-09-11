import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  type LoomAccount,
  readAccount,
  readCredentialStatus,
  logout,
} from './api.js'
import { LoomloomConnectFlow } from './LoomloomConnectFlow.js'

export type LoomloomIdentityActionProps =
  PropsRuntime<'sidebar.footer.action'>
  & PropsLocale<'loomloom'>

function accountLabel(account: LoomAccount | undefined, fallback: string): string {
  return account?.displayName ?? account?.email ?? account?.uid ?? fallback
}

function credentialFallback(status: { readonly maskedToken?: string }, fallback: string): string {
  return status.maskedToken === undefined ? fallback : `API Key ${status.maskedToken}`
}

function initials(account: LoomAccount): string {
  const source = accountLabel(account, '?')
  return source.trim().slice(0, 1).toUpperCase()
}

export function LoomloomIdentityAction({ wide, t }: LoomloomIdentityActionProps) {
  const [configured, setConfigured] = useState(false)
  const [credentialStatus, setCredentialStatus] = useState<{ readonly maskedToken?: string }>({})
  const [account, setAccount] = useState<LoomAccount | undefined>()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | undefined>()
  const [reauthorizing, setReauthorizing] = useState(false)

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      // This footer control is mounted for the whole application lifetime and
      // only ever needs credential *presence*. Reading the verified bootstrap
      // here would spend two upstream round trips (a Loom runs query plus the
      // full Router model catalog) on every application start just to decide
      // which avatar to draw.
      const status = await readCredentialStatus()
      setConfigured(status.configured)
      setCredentialStatus(status)
      if (status.configured) {
        try {
          setAccount(await readAccount())
          setError(undefined)
        } catch {
          setAccount(undefined)
          setError(t('accountUnavailable'))
        }
      } else {
        setAccount(undefined)
        setError(undefined)
      }
    } catch (cause) {
      setError(t('connectionStatusFailed'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const label = configured ? accountLabel(account, credentialFallback(credentialStatus, t('account'))) : t('signIn')

  return (
    <>
      <button
        className="loomloomIdentityAction"
        type="button"
        aria-label={label}
        onClick={() => { setOpen(true); void refresh() }}
      >
        <span className="loomloomIdentityAvatar" aria-hidden="true">
          {configured && account?.photoUrl
            ? <img src={account.photoUrl} alt="" />
            : configured
              ? initials(account ?? { configured: true })
              : '云'}
        </span>
        {wide && <span className="loomloomIdentityCopy">
          <strong>{loading ? t('loading') : label}</strong>
          <small>{configured ? t('accountConnected') : t('signInPrompt')}</small>
        </span>}
      </button>

      {open && (
        <div className="loomloomIdentityOverlay" role="presentation" onMouseDown={event => {
          if (event.target === event.currentTarget) setOpen(false)
        }}>
          <div className="loomloomIdentityDialog" role="dialog" aria-modal="true" aria-labelledby="loomloom-identity-title">
            <div className="loomloomIdentityDialogHeader">
              <h2 id="loomloom-identity-title">{configured ? label : t('signIn')}</h2>
              <button type="button" className="loomloomIdentityClose" aria-label={t('close')} onClick={() => setOpen(false)}>×</button>
            </div>
            {reauthorizing
              ? <LoomloomConnectFlow
                t={t}
                forceSignIn
                onConnected={() => { setReauthorizing(false); void refresh() }}
                onLater={() => setReauthorizing(false)}
              />
              : !configured
              ? <LoomloomConnectFlow
                t={t}
                onConnected={() => { setOpen(false); void refresh() }}
                onLater={() => setOpen(false)}
              />
              : <div className="loomloomIdentityDetails">
                <div className="loomloomIdentityProfile">
                  <span className="loomloomIdentityAvatar loomloomIdentityAvatarLarge" aria-hidden="true">
                    {account?.photoUrl ? <img src={account.photoUrl} alt="" /> : initials(account ?? { configured: true })}
                  </span>
                  <div>
                    <strong>{accountLabel(account, t('account'))}</strong>
                    {account?.email && <span>{account.email}</span>}
                  </div>
                </div>
                {error && <p className="loomloomError" role="status">{error}</p>}
                {error && <button className="loomloomButton" type="button" onClick={() => setReauthorizing(true)}>{t('refreshAccount')}</button>}
                {account && <dl className="loomloomIdentityFacts">
                  {account?.uid && <><dt>{t('accountId')}</dt><dd>{account.uid}</dd></>}
                  {account?.balance && <><dt>{t('balance')}</dt><dd>{account.balance}</dd></>}
                  {account?.isCreator !== undefined && <><dt>{t('accountRole')}</dt><dd>{account.isCreator ? t('creator') : t('user')}</dd></>}
                </dl>}
                <button className="loomloomButton" type="button" onClick={() => {
                  void logout().then(() => { setConfigured(false); setAccount(undefined); setOpen(false) }).catch(cause => {
                    setError(cause instanceof Error ? cause.message : t('error'))
                  })
                }}>
                  {t('signOut')}
                </button>
              </div>}
          </div>
        </div>
      )}
    </>
  )
}
