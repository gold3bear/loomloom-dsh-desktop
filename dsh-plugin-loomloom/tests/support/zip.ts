import { deflateRawSync } from 'node:zlib'

export interface ZipInput {
  readonly name: string
  readonly data: string | Buffer
  readonly method?: 0 | 8
}

function crc32(buffer: Buffer): number {
  const table = (crc32 as unknown as { table?: number[] }).table ?? (() => {
    const built: number[] = []
    for (let index = 0; index < 256; index += 1) {
      let value = index
      for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
      built.push(value >>> 0)
    }
    ;(crc32 as unknown as { table?: number[] }).table = built
    return built
  })()
  let value = 0xffffffff
  for (const byte of buffer) value = table[(value ^ byte) & 0xff]! ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

/** Build a minimal ZIP archive so the reader can be tested without a dependency. */
export function buildZip(entries: readonly ZipInput[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
    const method = entry.method ?? 8
    const payload = method === 8 ? deflateRawSync(raw) : raw
    const checksum = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(0, 10)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(0, 12)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + payload.length
  }

  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...locals, centralDirectory, end])
}

export const SKILL_MD = '---\nname: demo-skill\ndescription: A demo skill\n---\n\n# Demo\n'

export function validPackage(name = 'demo-skill'): Buffer {
  return buildZip([
    { name: `${name}/SKILL.md`, data: SKILL_MD },
    { name: `${name}/references/notes.md`, data: '# Notes\n' },
    { name: `${name}/scripts/run.py`, data: 'print("hi")\n' },
  ])
}
