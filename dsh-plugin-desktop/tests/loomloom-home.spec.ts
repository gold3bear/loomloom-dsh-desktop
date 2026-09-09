import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultLoomloomHome, resolveLoomloomHome } from '../src/loomloom-home.ts'

describe('LoomLoom default home', () => {
  it('uses ~/.loomloom when DSH_HOME is absent', () => {
    expect(defaultLoomloomHome()).toBe(join(homedir(), '.loomloom'))
    expect(resolveLoomloomHome({ PATH: '/usr/bin' })).toBe(join(homedir(), '.loomloom'))
  })

  it('preserves an explicit DSH_HOME without reading ~/.dsh', () => {
    expect(resolveLoomloomHome({ DSH_HOME: '/tmp/custom-dsh-home' })).toBe('/tmp/custom-dsh-home')
  })
})
