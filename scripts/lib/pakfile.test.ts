import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { extractPakfileFromBsp, normalizeZipPath, parsePakfile } from './pakfile.ts'

interface FixtureEntry {
  name: string
  data: Buffer
  method?: 0 | 8
}

/**
 * Arma un .zip mínimo (local headers + directorio central + EOCD) a mano,
 * para probar el parser de pakfile sin depender de un .bsp real. Sólo
 * implementa lo que un zip de bspzip realmente usa: método 0 (guardado) y 8
 * (deflate), sin zip64.
 */
function buildZip(entries: FixtureEntry[]): Buffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const e of entries) {
    const method = e.method ?? 0
    const compressed = method === 8 ? deflateRawSync(e.data) : e.data
    const nameBuf = Buffer.from(e.name, 'utf8')

    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt16LE(0, 10)
    localHeader.writeUInt16LE(0, 12)
    localHeader.writeUInt32LE(0, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(e.data.length, 22)
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)

    const localOffset = offset
    const localEntry = Buffer.concat([localHeader, nameBuf, compressed])
    localParts.push(localEntry)
    offset += localEntry.length

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(0, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt16LE(0, 12)
    centralHeader.writeUInt16LE(0, 14)
    centralHeader.writeUInt32LE(0, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(e.data.length, 24)
    centralHeader.writeUInt16LE(nameBuf.length, 28)
    centralHeader.writeUInt16LE(0, 30)
    centralHeader.writeUInt16LE(0, 32)
    centralHeader.writeUInt16LE(0, 34)
    centralHeader.writeUInt16LE(0, 36)
    centralHeader.writeUInt32LE(0, 38)
    centralHeader.writeUInt32LE(localOffset, 42)

    centralParts.push(Buffer.concat([centralHeader, nameBuf]))
  }

  const centralDirOffset = offset
  const centralDir = Buffer.concat(centralParts)
  offset += centralDir.length

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(centralDirOffset, 16)
  eocd.writeUInt16LE(0, 20)

  return Buffer.concat([...localParts, centralDir, eocd])
}

describe('normalizeZipPath', () => {
  it('convierte backslashes a forward slashes y todo a minúsculas', () => {
    expect(normalizeZipPath('MATERIALS\\Plaster\\WallPaper01.VTF')).toBe('materials/plaster/wallpaper01.vtf')
  })

  it('saca las barras iniciales', () => {
    expect(normalizeZipPath('/materials/x.vtf')).toBe('materials/x.vtf')
  })
})

describe('parsePakfile', () => {
  it('lee una entrada guardada sin comprimir (método 0)', () => {
    const zip = buildZip([{ name: 'materials/x.vmt', data: Buffer.from('hola') }])
    const pakfile = parsePakfile(zip)
    expect(pakfile.readEntry('materials/x.vmt')?.toString('utf8')).toBe('hola')
  })

  it('lee una entrada comprimida con deflate (método 8)', () => {
    const original = Buffer.from('contenido de un vmt de verdad, con algo de texto repetido repetido repetido')
    const zip = buildZip([{ name: 'materials/y.vmt', data: original, method: 8 }])
    const pakfile = parsePakfile(zip)
    expect(pakfile.readEntry('materials/y.vmt')).toEqual(original)
  })

  it('busca sin importar mayúsculas ni el separador de ruta', () => {
    const zip = buildZip([{ name: 'materials/Plaster/WallPaper01.vtf', data: Buffer.from('x') }])
    const pakfile = parsePakfile(zip)
    expect(pakfile.readEntry('MATERIALS\\PLASTER\\wallpaper01.VTF')).toBeDefined()
  })

  it('una ruta que no existe da undefined, no revienta', () => {
    const zip = buildZip([{ name: 'materials/x.vmt', data: Buffer.from('x') }])
    const pakfile = parsePakfile(zip)
    expect(pakfile.readEntry('materials/no_existe.vmt')).toBeUndefined()
  })

  it('varias entradas quedan todas indexadas y son legibles independientemente', () => {
    const zip = buildZip([
      { name: 'materials/a.vmt', data: Buffer.from('A') },
      { name: 'materials/b.vtf', data: Buffer.from('B'.repeat(50)), method: 8 },
      { name: 'materials/plaster/c.vmt', data: Buffer.from('C') },
    ])
    const pakfile = parsePakfile(zip)
    expect(pakfile.entriesByNormalizedName.size).toBe(3)
    expect(pakfile.readEntry('materials/a.vmt')?.toString()).toBe('A')
    expect(pakfile.readEntry('materials/plaster/c.vmt')?.toString()).toBe('C')
  })

  it('un método de compresión no soportado revienta con un mensaje claro (no intenta adivinar)', () => {
    const zip = buildZip([{ name: 'materials/x.vmt', data: Buffer.from('x') }])
    // Método 99 no existe en la práctica de bspzip; se fuerza a mano para probar el guard.
    zip.writeUInt16LE(99, 10) // compression method en el local header
    const centralDirOffset = zip.readUInt32LE(zip.length - 22 + 16)
    zip.writeUInt16LE(99, centralDirOffset + 10) // y en el central directory
    const pakfile = parsePakfile(zip)
    expect(() => pakfile.readEntry('materials/x.vmt')).toThrow(/método de compresión 99/)
  })
})

const HEADER_SIZE = 8 + 64 * 16
const PAKFILE_LUMP_OFFSET = 8 + 40 * 16

function buildFakeBsp(zip: Buffer): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE + zip.length)
  buf.write('VBSP', 0, 'ascii')
  buf.writeInt32LE(20, 4)
  buf.writeInt32LE(HEADER_SIZE, PAKFILE_LUMP_OFFSET)
  buf.writeInt32LE(zip.length, PAKFILE_LUMP_OFFSET + 4)
  zip.copy(buf, HEADER_SIZE)
  return buf
}

describe('extractPakfileFromBsp', () => {
  it('ubica el lump 40 y lo parsea como el zip del pakfile', () => {
    const zip = buildZip([{ name: 'materials/x.vmt', data: Buffer.from('contenido') }])
    const bsp = buildFakeBsp(zip)
    const pakfile = extractPakfileFromBsp(bsp)
    expect(pakfile.readEntry('materials/x.vmt')?.toString()).toBe('contenido')
  })

  it('rechaza un archivo que no empieza con la firma "VBSP"', () => {
    const bsp = Buffer.alloc(HEADER_SIZE)
    bsp.write('NOPE', 0, 'ascii')
    expect(() => extractPakfileFromBsp(bsp)).toThrow(/no es un \.bsp/)
  })
})
