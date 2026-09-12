import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { SKILL_MD, buildZip, validPackage } from './support/zip.js'
import { LoomApiError } from '../src/loom-api.js'
import {
  findInstalledSkillPackage,
  installSkillPackage,
  listInstalledSkillPackages,
  normalizeArchiveHash,
  readZipEntries,
  resolveDefaultSkillRoot,
  uninstallSkillPackage,
} from '../src/skill-package.js'

async function withTempRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'loom-skill-test-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('reads stored and deflated zip entries', () => {
  const archive = buildZip([
    { name: 'a/one.txt', data: 'deflated', method: 8 },
    { name: 'a/two.txt', data: 'stored', method: 0 },
    { name: 'a/', data: '' },
  ])
  const entries = readZipEntries(archive)
  assert.deepEqual(entries.map(entry => entry.name), ['a/one.txt', 'a/two.txt'])
  assert.equal(entries[0]!.data.toString('utf8'), 'deflated')
  assert.equal(entries[1]!.data.toString('utf8'), 'stored')
})

test('rejects a buffer that is not a zip archive', () => {
  assert.throws(() => readZipEntries(Buffer.from('not a zip at all, definitely not')), (error: unknown) => error instanceof LoomApiError && error.status === 502)
})

test('rejects an entry that escapes the extraction root', () => {
  const archive = buildZip([
    { name: 'demo-skill/SKILL.md', data: SKILL_MD },
    { name: 'demo-skill/../../escape.txt', data: 'nope' },
  ])
  assert.throws(() => readZipEntries(archive), /escapes the skill directory/)
})

test('rejects an absolute entry path', () => {
  const archive = buildZip([{ name: '/etc/passwd', data: 'nope' }])
  assert.throws(() => readZipEntries(archive), /absolute path/)
})

test('installs a valid package and records a marker', async () => {
  await withTempRoot(async root => {
    const archive = validPackage()
    const result = await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive })
    assert.deepEqual(
      { installed: result.installed, updated: result.updated, unchanged: result.unchanged, skillName: result.skillName },
      { installed: true, updated: false, unchanged: false, skillName: 'demo-skill' },
    )
    assert.equal(await readFile(join(root, 'demo-skill', 'SKILL.md'), 'utf8'), SKILL_MD)
    assert.equal(await readFile(join(root, 'demo-skill', 'references', 'notes.md'), 'utf8'), '# Notes\n')
    const marker = JSON.parse(await readFile(join(root, 'demo-skill', '.loomloom-skill.json'), 'utf8')) as Record<string, unknown>
    assert.equal(marker.schemaVersion, 1)
    assert.equal(marker.source, 'market:listing-1')
    assert.equal(marker.archiveHash, result.archiveHash)
    // The staging directory must not survive the install.
    const leftovers = (await readdir(root)).filter(name => name.startsWith('.loomloom-skill-package-'))
    assert.deepEqual(leftovers, [])
  })
})

test('verifies the published archive hash', async () => {
  await withTempRoot(async root => {
    const archive = validPackage()
    await assert.rejects(
      () => installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: 'deadbeef', archive }),
      /does not match the published hash/,
    )
    // The real hash is accepted, including a `sha256:` prefixed form.
    const digest = createHash('sha256').update(archive).digest('hex')
    const accepted = await installSkillPackage({
      skillRoot: root,
      sourceRef: 'market:listing-1',
      archiveHash: `sha256:${digest}`,
      archive,
    })
    assert.equal(accepted.installed, true)
    assert.equal(accepted.archiveHash, digest)
  })
})

test('rejects a package without SKILL.md', async () => {
  await withTempRoot(async root => {
    const archive = buildZip([{ name: 'demo-skill/README.md', data: '# readme\n' }])
    await assert.rejects(
      () => installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive }),
      /must contain demo-skill\/SKILL.md/,
    )
  })
})

test('rejects a SKILL.md without frontmatter', async () => {
  await withTempRoot(async root => {
    const archive = buildZip([{ name: 'demo-skill/SKILL.md', data: '# no frontmatter\n' }])
    await assert.rejects(
      () => installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive }),
      /must start with frontmatter/,
    )
  })
})

test('rejects a package with more than one top-level directory', async () => {
  await withTempRoot(async root => {
    const archive = buildZip([
      { name: 'demo-skill/SKILL.md', data: SKILL_MD },
      { name: 'other-skill/SKILL.md', data: SKILL_MD },
    ])
    await assert.rejects(
      () => installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive }),
      /exactly one top-level directory/,
    )
  })
})

test('rejects an invalid top-level skill name', async () => {
  await withTempRoot(async root => {
    const archive = buildZip([{ name: 'bad name/SKILL.md', data: SKILL_MD }])
    await assert.rejects(
      () => installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive }),
      /not a valid skill name/,
    )
  })
})

test('reports an unchanged install for the same source and hash', async () => {
  await withTempRoot(async root => {
    const archive = validPackage()
    const first = await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive })
    const found = await findInstalledSkillPackage(root, 'market:listing-1', first.archiveHash)
    assert.ok(found)
    assert.equal(found.unchanged, true)
    assert.equal(found.skillName, 'demo-skill')
    // A different source never matches, even with the same hash.
    assert.equal(await findInstalledSkillPackage(root, 'market:listing-2', first.archiveHash), undefined)
    // A different hash never matches either.
    assert.equal(await findInstalledSkillPackage(root, 'market:listing-1', 'deadbeef'), undefined)
  })
})

test('upgrades an installed package in place and reports updated', async () => {
  await withTempRoot(async root => {
    await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive: validPackage() })
    const upgraded = buildZip([
      { name: 'demo-skill/SKILL.md', data: '---\nname: demo-skill\nversion: 2\n---\n\n# Demo v2\n' },
      { name: 'demo-skill/new.md', data: 'added\n' },
    ])
    const result = await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive: upgraded })
    assert.equal(result.updated, true)
    assert.equal(await readFile(join(root, 'demo-skill', 'new.md'), 'utf8'), 'added\n')
    // The previous version is fully replaced, not merged.
    await assert.rejects(() => readFile(join(root, 'demo-skill', 'references', 'notes.md'), 'utf8'))
    // No backup directory survives a successful upgrade.
    const leftovers = (await readdir(root)).filter(name => name.includes('.backup-'))
    assert.deepEqual(leftovers, [])
  })
})

test('uninstalls only directories carrying a valid marker', async () => {
  await withTempRoot(async root => {
    await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive: validPackage() })
    await mkdir(join(root, 'unrelated'), { recursive: true })
    await writeFile(join(root, 'unrelated', 'keep.txt'), 'keep\n')

    assert.equal(await uninstallSkillPackage(root, 'unrelated'), false)
    assert.equal(await readFile(join(root, 'unrelated', 'keep.txt'), 'utf8'), 'keep\n')
    assert.equal(await uninstallSkillPackage(root, 'demo-skill'), true)
    await assert.rejects(() => readdir(join(root, 'demo-skill')))
    // Uninstalling something absent is not an error, just false.
    assert.equal(await uninstallSkillPackage(root, 'demo-skill'), false)
  })
})

test('lists installed packages from their markers', async () => {
  await withTempRoot(async root => {
    assert.deepEqual(await listInstalledSkillPackages(join(root, 'missing')), [])
    const first = await installSkillPackage({ skillRoot: root, sourceRef: 'market:listing-1', archiveHash: '', archive: validPackage() })
    const second = await installSkillPackage({
      skillRoot: root,
      sourceRef: 'market:listing-2',
      archiveHash: '',
      archive: validPackage('other-skill'),
    })
    const installed = await listInstalledSkillPackages(root)
    assert.deepEqual(installed.map(item => item.skillName).sort(), ['demo-skill', 'other-skill'])
    const demo = installed.find(item => item.skillName === 'demo-skill')
    assert.equal(demo?.source, 'market:listing-1')
    assert.equal(demo?.archiveHash, first.archiveHash)
    assert.equal(installed.find(item => item.skillName === 'other-skill')?.archiveHash, second.archiveHash)
  })
})

test('normalizes archive hashes and resolves the default skill root', () => {
  assert.equal(normalizeArchiveHash('sha256:ABC123'), 'abc123')
  assert.equal(normalizeArchiveHash('  ABC123  '), 'abc123')
  assert.equal(resolveDefaultSkillRoot({ DSH_HOME: '/custom/home' }, '/home/user'), '/custom/home/skills')
  assert.equal(resolveDefaultSkillRoot({}, '/home/user'), '/home/user/.loomloom/skills')
  assert.equal(resolveDefaultSkillRoot({ DSH_HOME: '   ' }, '/home/user'), '/home/user/.loomloom/skills')
})
