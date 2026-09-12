import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { LoomApiError } from './loom-api.js'

/**
 * Backend-published Agent Skill packages.
 *
 * A Market listing can ship a ZIP archive containing a complete agent skill
 * (a `SKILL.md` entry point plus references and scripts). Installing one means:
 * verify the archive against the published sha256, unpack it, validate the
 * skill shape, and place it atomically in an agent skill root with a marker
 * recording the source and hash so a repeat install is a no-op.
 *
 * The upstream contract (mirrored from the official Go CLI) is:
 *   GET /marketListings/{id}/skillPackage           -> summary with archiveHash
 *   GET /marketListings/{id}/skillPackage/archive   -> the ZIP bytes
 */
const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024
const MAX_SKILL_MD_BYTES = 500 * 1024
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024
const MARKER_NAME = '.loomloom-skill.json'

const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const CENTRAL_FILE_HEADER = 0x02014b50
const LOCAL_FILE_HEADER = 0x04034b50

/** Recorded next to an installed skill so a re-install can be detected. */
export interface SkillPackageMarker {
  readonly schemaVersion: number
  readonly source: string
  readonly archiveHash: string
}

export interface SkillPackageInstallResult {
  readonly installed: boolean
  readonly updated: boolean
  readonly unchanged: boolean
  readonly skillName: string
  readonly dir: string
  readonly archiveHash: string
}

export interface SkillPackageInstallOptions {
  readonly skillRoot: string
  /** Provenance recorded in the marker, for example `market:<listing-id>`. */
  readonly sourceRef: string
  /** The published `sha256:<hex>` value; verification is skipped when empty. */
  readonly archiveHash: string
  readonly archive: Buffer
}

interface ZipEntry {
  readonly name: string
  readonly data: Buffer
}

/** Normalize `sha256:<hex>` / `<hex>` into a lowercase bare hex digest. */
export function normalizeArchiveHash(value: string): string {
  const trimmed = value.trim().toLowerCase()
  return trimmed.startsWith('sha256:') ? trimmed.slice('sha256:'.length) : trimmed
}

/**
 * The agent skill root installed packages land in: `<DSH_HOME>/skills`, where
 * `DSH_HOME` falls back to `~/.loomloom`. The path is derived from the host
 * environment rather than a request so a client cannot choose a write target.
 */
export function resolveDefaultSkillRoot(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const configured = env.DSH_HOME?.trim()
  const base = configured === undefined || configured === '' ? join(home, '.loomloom') : configured
  return join(base, 'skills')
}

/** Locate the End Of Central Directory record by scanning backwards. */
function findEndOfCentralDirectory(archive: Buffer): number {
  const earliest = Math.max(0, archive.length - 65_557)
  for (let offset = archive.length - 22; offset >= earliest; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset
  }
  return -1
}

/**
 * Decode a ZIP entry name. The UTF-8 flag wins; otherwise the bytes are
 * treated as UTF-8 when they decode cleanly and latin1 when they do not.
 */
function decodeEntryName(raw: Buffer, flags: number): string {
  if ((flags & 0x0800) !== 0) return raw.toString('utf8')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    return raw.toString('latin1')
  }
}

/**
 * Reject entry names that could escape the extraction root: absolute paths,
 * drive letters, and any `.`/`..`/empty segment after normalizing separators.
 */
function assertSafeEntryName(name: string): void {
  const normalized = name.replace(/\\/gu, '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) {
    throw new LoomApiError(502, `skill package entry "${name}" uses an absolute path`)
  }
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new LoomApiError(502, `skill package entry "${name}" escapes the skill directory`)
    }
  }
}

/**
 * Minimal ZIP reader covering the shapes the backend publishes: stored and
 * deflate entries, no ZIP64. Everything is bounded so a hostile archive cannot
 * exhaust memory.
 */
export function readZipEntries(archive: Buffer): readonly ZipEntry[] {
  if (archive.length < 22) throw new LoomApiError(502, 'skill package archive is not a valid ZIP file')
  const end = findEndOfCentralDirectory(archive)
  if (end < 0) throw new LoomApiError(502, 'skill package archive is not a valid ZIP file')
  const entryCount = archive.readUInt16LE(end + 10)
  const centralOffset = archive.readUInt32LE(end + 16)
  if (entryCount === 0xffff || centralOffset === 0xffff_ffff) {
    throw new LoomApiError(502, 'skill package archive uses ZIP64, which is not supported')
  }

  const entries: ZipEntry[] = []
  let totalUncompressed = 0
  let cursor = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.length || archive.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) {
      throw new LoomApiError(502, 'skill package archive central directory is corrupt')
    }
    const flags = archive.readUInt16LE(cursor + 8)
    const method = archive.readUInt16LE(cursor + 10)
    const compressedSize = archive.readUInt32LE(cursor + 20)
    const uncompressedSize = archive.readUInt32LE(cursor + 24)
    const nameLength = archive.readUInt16LE(cursor + 28)
    const extraLength = archive.readUInt16LE(cursor + 30)
    const commentLength = archive.readUInt16LE(cursor + 32)
    const localOffset = archive.readUInt32LE(cursor + 42)

    const nameStart = cursor + 46
    if (nameStart + nameLength > archive.length) throw new LoomApiError(502, 'skill package archive entry name is truncated')
    const name = decodeEntryName(archive.subarray(nameStart, nameStart + nameLength), flags)
    cursor = nameStart + nameLength + extraLength + commentLength

    // Directory entries carry no payload; the extraction step creates parents.
    if (name.endsWith('/')) continue

    assertSafeEntryName(name)

    if (localOffset + 30 > archive.length || archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) {
      throw new LoomApiError(502, `skill package entry "${name}" has a corrupt local header`)
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26)
    const localExtraLength = archive.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > archive.length) throw new LoomApiError(502, `skill package entry "${name}" is truncated`)
    const raw = archive.subarray(dataStart, dataEnd)

    let data: Buffer
    if (method === 0) {
      data = Buffer.from(raw)
    } else if (method === 8) {
      try {
        data = inflateRawSync(raw)
      } catch {
        throw new LoomApiError(502, `skill package entry "${name}" could not be decompressed`)
      }
    } else {
      throw new LoomApiError(502, `skill package entry "${name}" uses unsupported compression method ${method}`)
    }
    if (uncompressedSize !== 0 && data.length !== uncompressedSize) {
      throw new LoomApiError(502, `skill package entry "${name}" size does not match its header`)
    }

    totalUncompressed += data.length
    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new LoomApiError(502, 'skill package expands beyond the size limit')
    entries.push({ name, data })
  }
  if (entries.length === 0) throw new LoomApiError(502, 'skill package archive contains no files')
  return entries
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Find an already-installed package for the same source whose recorded hash
 * matches, so a repeat install can report `unchanged` instead of re-downloading.
 */
export async function findInstalledSkillPackage(
  skillRoot: string,
  sourceRef: string,
  archiveHash: string,
): Promise<SkillPackageInstallResult | undefined> {
  const expected = normalizeArchiveHash(archiveHash)
  let dirents
  try {
    dirents = await readdir(skillRoot, { withFileTypes: true })
  } catch {
    return undefined
  }
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    const dir = join(skillRoot, dirent.name)
    let marker: SkillPackageMarker
    try {
      marker = JSON.parse(await readFile(join(dir, MARKER_NAME), 'utf8')) as SkillPackageMarker
    } catch {
      continue
    }
    if (marker.schemaVersion !== 1 || marker.source !== sourceRef) continue
    if (normalizeArchiveHash(String(marker.archiveHash)) !== expected) continue
    return {
      installed: true,
      updated: false,
      unchanged: true,
      skillName: dirent.name,
      dir,
      archiveHash: expected,
    }
  }
  return undefined
}

/**
 * Verify, unpack and atomically install one skill package archive.
 *
 * The archive is staged inside `skillRoot` and then renamed into place, so a
 * crash mid-install leaves either the previous version or nothing, never a
 * half-written skill.
 */
export async function installSkillPackage(options: SkillPackageInstallOptions): Promise<SkillPackageInstallResult> {
  const { skillRoot, sourceRef, archive } = options
  if (archive.length === 0) throw new LoomApiError(400, 'skill package archive is empty')
  if (archive.length > MAX_ARCHIVE_BYTES) throw new LoomApiError(502, 'skill package archive exceeds the 10 MiB limit')

  const actualHash = createHash('sha256').update(archive).digest('hex')
  const expectedHash = normalizeArchiveHash(options.archiveHash)
  if (expectedHash !== '' && expectedHash !== actualHash) {
    throw new LoomApiError(502, 'skill package archive does not match the published hash')
  }

  const entries = readZipEntries(archive)
  const roots = new Set(entries.map(entry => entry.name.replace(/\\/gu, '/').split('/')[0] ?? ''))
  if (roots.size !== 1) throw new LoomApiError(502, 'skill package must contain exactly one top-level directory')
  const skillName = [...roots][0] ?? ''
  if (skillName === '' || !/^[A-Za-z0-9._-]{1,100}$/u.test(skillName)) {
    throw new LoomApiError(502, `skill package top-level directory "${skillName}" is not a valid skill name`)
  }

  const skillMd = entries.find(entry => entry.name.replace(/\\/gu, '/') === `${skillName}/SKILL.md`)
  if (skillMd === undefined) throw new LoomApiError(502, `skill package must contain ${skillName}/SKILL.md`)
  if (skillMd.data.length > MAX_SKILL_MD_BYTES) throw new LoomApiError(502, 'skill package SKILL.md exceeds the 500 KiB limit')
  if (!skillMd.data.toString('utf8').replace(/^\uFEFF/u, '').startsWith('---')) {
    throw new LoomApiError(502, 'skill package SKILL.md must start with frontmatter')
  }

  await mkdir(skillRoot, { recursive: true })
  const stage = await mkdtemp(join(skillRoot, '.loomloom-skill-package-'))
  const stagedSkill = join(stage, skillName)
  try {
    for (const entry of entries) {
      const relative = entry.name.replace(/\\/gu, '/').slice(skillName.length + 1)
      const destination = join(stagedSkill, relative)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, entry.data, { mode: 0o644 })
    }
    const marker: SkillPackageMarker = { schemaVersion: 1, source: sourceRef, archiveHash: actualHash }
    await writeFile(join(stagedSkill, MARKER_NAME), `${JSON.stringify(marker)}\n`, { mode: 0o600 })

    const target = join(skillRoot, skillName)
    const hadPrevious = await exists(target)
    let backup: string | undefined
    if (hadPrevious) {
      backup = `${target}.backup-${Date.now()}`
      await rename(target, backup)
    }
    try {
      await rename(stagedSkill, target)
    } catch (cause) {
      // Put the previous version back so a failed upgrade is not destructive.
      if (backup !== undefined) await rename(backup, target).catch(() => undefined)
      throw cause
    }
    if (backup !== undefined) await rm(backup, { recursive: true, force: true })
    return { installed: true, updated: hadPrevious, unchanged: false, skillName, dir: target, archiveHash: actualHash }
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}

/**
 * Remove an installed skill directory. Only directories carrying a valid
 * marker are removed, so an unrelated folder in the skill root is never lost.
 */
export async function uninstallSkillPackage(skillRoot: string, skillName: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._-]{1,100}$/u.test(skillName)) throw new LoomApiError(400, 'invalid skill name')
  const dir = join(skillRoot, skillName)
  let marker: SkillPackageMarker
  try {
    marker = JSON.parse(await readFile(join(dir, MARKER_NAME), 'utf8')) as SkillPackageMarker
  } catch {
    return false
  }
  if (marker.schemaVersion !== 1) return false
  await rm(dir, { recursive: true, force: true })
  return true
}

/** An installed package as recorded by its marker file. */
export interface InstalledSkillPackage extends SkillPackageMarker {
  readonly skillName: string
  readonly dir: string
}

/** List installed packages recorded in one skill root. */
export async function listInstalledSkillPackages(skillRoot: string): Promise<readonly InstalledSkillPackage[]> {
  let dirents
  try {
    dirents = await readdir(skillRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const installed: InstalledSkillPackage[] = []
  for (const dirent of dirents) {
    if (!dirent.isDirectory() || dirent.name.startsWith('.')) continue
    try {
      const marker = JSON.parse(await readFile(join(skillRoot, dirent.name, MARKER_NAME), 'utf8')) as SkillPackageMarker
      if (marker.schemaVersion !== 1) continue
      installed.push({ ...marker, skillName: dirent.name, dir: join(skillRoot, dirent.name) })
    } catch {
      continue
    }
  }
  return installed
}
