/**
 * End-to-end verification of the Market skill-package install path.
 *
 * Runs the real plugin code against the live Loomloom API: read the package
 * head, verify the published sha256, unpack the ZIP, install into a temporary
 * skill root, confirm the marker, prove the second install is a no-op, and
 * uninstall again. Nothing is written outside the temporary directory.
 *
 *   cd dsh-plugin-loomloom
 *   node --import tsx scripts/verify-skill-install.ts
 *   node --import tsx scripts/verify-skill-install.ts --listing <listing-id>
 *   node --import tsx scripts/verify-skill-install.ts --keep
 *
 * Token resolution: $SHENGSUANYUN_API_KEY, then ~/.loomloom/.credentials.yaml.
 * Exit code is non-zero when any step fails.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { LoomApi, resolveLoomConfig } from '../src/loom-api.js'
import { LoomSkillbotService } from '../src/skillbots.js'
import { findInstalledSkillPackage, listInstalledSkillPackages, uninstallSkillPackage } from '../src/skill-package.js'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const DEFAULT_LISTING = '01a0892b-761b-78f9-a166-fbb12ae51e74' // 视觉演示生成器

function readToken(): string {
  const fromEnv = process.env.SHENGSUANYUN_API_KEY
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    const text = readFileSync(join(homedir(), '.loomloom', '.credentials.yaml'), 'utf8')
    const match = /SHENGSUANYUN_API_KEY:\s*([A-Za-z0-9._-]+)/u.exec(text)
    if (match?.[1] !== undefined) return match[1]
  } catch {
    // fall through to the error below
  }
  throw new Error('no credential: set SHENGSUANYUN_API_KEY or configure ~/.loomloom/.credentials.yaml')
}

let listingId = DEFAULT_LISTING
let keep = false
const argv = process.argv.slice(2)
for (let index = 0; index < argv.length; index += 1) {
  const arg = argv[index]
  if (arg === '--listing') { listingId = argv[index + 1] ?? listingId; index += 1 }
  else if (arg === '--keep') keep = true
  else if (arg === '--help' || arg === '-h') {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map(line => line.replace(/^ \* ?/u, '')).join('\n'))
    process.exit(0)
  }
}

let passed = 0
let failed = 0
function check(name: string, run: () => void): void {
  try {
    run()
    passed += 1
    console.log(`  ✅ ${name}`)
  } catch (cause) {
    failed += 1
    console.log(`  ❌ ${name}`)
    console.log(`     ${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

const api = new LoomApi(resolveLoomConfig({ token: readToken() }))
const service = new LoomSkillbotService(api)
const root = await mkdtemp(join(tmpdir(), 'loom-skill-verify-'))

console.log('Market skill package install verification')
console.log('=========================================')
console.log(`listing : ${listingId}`)
console.log(`skill root (temporary) : ${root}`)
console.log()

try {
  console.log('• package head')
  const summary = await service.getSkillPackage(listingId)
  console.log(`  available    : ${summary.available}`)
  console.log(`  archiveHash  : ${summary.archiveHash}`)
  console.log(`  mode         : ${summary.mode ?? '-'}`)
  console.log(`  sizeBytes    : ${summary.sizeBytes ?? '-'}`)
  if (!summary.available) throw new Error(`package unavailable: ${summary.unavailableReason ?? 'no reason given'}`)
  check('package head reports an available archive', () => {
    if (summary.archiveHash === '') throw new Error('archiveHash is empty')
  })

  console.log()
  console.log('• install')
  const first = await service.installSkill(listingId, root)
  console.log(`  skillName : ${first.skillName}`)
  console.log(`  dir       : ${first.dir}`)
  console.log(`  installed : ${first.installed}  updated: ${first.updated}  unchanged: ${first.unchanged}`)
  check('first install reports installed', () => {
    if (!first.installed || first.unchanged) throw new Error(`unexpected result ${JSON.stringify(first)}`)
  })
  const skillMd = await readFile(join(first.dir, 'SKILL.md'), 'utf8')
  check('SKILL.md starts with frontmatter', () => {
    if (!skillMd.replace(/^\uFEFF/u, '').startsWith('---')) throw new Error('no frontmatter')
  })
  const files = await readdir(first.dir)
  check('package contents extracted alongside SKILL.md', () => {
    if (files.length < 2) throw new Error(`only ${files.length} entries: ${files.join(', ')}`)
  })
  check('SKILL.md is non-trivial after extraction', () => {
    if (skillMd.length < 64) throw new Error(`SKILL.md is only ${skillMd.length} bytes`)
  })
  const marker = JSON.parse(await readFile(join(first.dir, '.loomloom-skill.json'), 'utf8')) as Record<string, unknown>
  check('marker records source and hash', () => {
    if (marker.source !== `market:${listingId}`) throw new Error(`source was ${String(marker.source)}`)
    if (marker.archiveHash !== first.archiveHash) throw new Error('hash mismatch')
  })

  console.log()
  console.log('• idempotency')
  const second = await service.installSkill(listingId, root)
  check('second install is unchanged', () => {
    if (!second.unchanged) throw new Error(`expected unchanged, got ${JSON.stringify(second)}`)
  })
  const found = await findInstalledSkillPackage(root, `market:${listingId}`, first.archiveHash)
  check('installed package is discoverable by source and hash', () => {
    if (found === undefined) throw new Error('not found')
  })
  const listed = await listInstalledSkillPackages(root)
  check('installed list contains the package', () => {
    if (!listed.some(item => item.skillName === first.skillName)) throw new Error('missing from list')
  })

  console.log()
  console.log('• uninstall')
  const removed = await uninstallSkillPackage(root, first.skillName)
  check('uninstall removes the skill directory', () => {
    if (!removed) throw new Error('uninstall reported false')
  })
  const remaining = await readdir(root)
  check('no staging or backup directories survive', () => {
    if (remaining.length !== 0) throw new Error(`leftovers: ${remaining.join(', ')}`)
  })
} catch (cause) {
  failed += 1
  console.log()
  console.log(`❌ fatal: ${cause instanceof Error ? cause.message : String(cause)}`)
} finally {
  if (keep) console.log(`\n(kept temporary skill root at ${root})`)
  else await rm(root, { recursive: true, force: true })
}

console.log()
console.log('summary')
console.log(`passed: ${passed}`)
console.log(`failed: ${failed}`)
if (failed > 0) process.exitCode = 1
