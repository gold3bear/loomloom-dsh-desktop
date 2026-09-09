import { homedir } from 'node:os'
import { join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

export const LOOMLOOM_HOME_DIRECTORY_NAME = '.loomloom'

/** Resolve the LoomLoom Desktop default while preserving explicit DSH_HOME. */
export function resolveLoomloomHome(environment: NodeJS.ProcessEnv = process.env): string {
  const configured = Object.entries(environment).find(([key]) => key.toUpperCase() === 'DSH_HOME')?.[1]
  return configured === undefined ? join(homedir(), LOOMLOOM_HOME_DIRECTORY_NAME) : resolveDshHome(undefined, environment)
}

export function defaultLoomloomHome(): string {
  return join(homedir(), LOOMLOOM_HOME_DIRECTORY_NAME)
}
