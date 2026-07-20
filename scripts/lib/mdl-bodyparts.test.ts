import { describe, expect, it } from 'vitest'
import {
  chooseBodygroupModels,
  meshBaseName,
  parseBodyparts,
  type MdlBodypart,
} from './mdl-bodyparts.ts'

/**
 * Arma un `.mdl` sintético con la disposición real de `studiohdr_t` v49. Se
 * construye byte a byte en vez de usar un archivo del pack porque el pack es
 * contenido del Workshop y no se commitea: un test que dependiera de él no
 * podría correr en limpio. Los offsets que escribe son los MISMOS que lee el
 * parser, así que si alguien cambia una constante de un lado, este test lo
 * agarra.
 */
function buildMdl(
  bodyparts: readonly { name: string; models: readonly { name: string; verts: number }[] }[],
  opts: { magic?: string; version?: number } = {},
): Buffer {
  const HEADER = 300
  const SIZEOF_BODYPART = 16
  const SIZEOF_MODEL = 148

  const partsBase = HEADER
  const partsSize = bodyparts.length * SIZEOF_BODYPART
  // Cada bodypart apunta a su propio bloque de modelos y a su propio nombre.
  const blocks: Buffer[] = []
  let cursor = partsBase + partsSize

  const partsBuf = Buffer.alloc(partsSize)
  bodyparts.forEach((part, i) => {
    const base = partsBase + i * SIZEOF_BODYPART
    const modelsSize = part.models.length * SIZEOF_MODEL
    const modelsAt = cursor
    const modelsBuf = Buffer.alloc(modelsSize)
    part.models.forEach((m, j) => {
      modelsBuf.write(m.name, j * SIZEOF_MODEL, 'ascii')
      modelsBuf.writeInt32LE(m.verts, j * SIZEOF_MODEL + 80)
    })
    blocks.push(modelsBuf)
    cursor += modelsSize

    const nameBuf = Buffer.alloc(part.name.length + 1)
    nameBuf.write(part.name, 0, 'ascii')
    const nameAt = cursor
    blocks.push(nameBuf)
    cursor += nameBuf.length

    // Los dos offsets son RELATIVOS al inicio del bodypart.
    partsBuf.writeInt32LE(nameAt - base, i * SIZEOF_BODYPART)
    partsBuf.writeInt32LE(part.models.length, i * SIZEOF_BODYPART + 4)
    partsBuf.writeInt32LE(0, i * SIZEOF_BODYPART + 8)
    partsBuf.writeInt32LE(modelsAt - base, i * SIZEOF_BODYPART + 12)
  })

  const head = Buffer.alloc(HEADER)
  head.write(opts.magic ?? 'IDST', 0, 'ascii')
  head.writeInt32LE(opts.version ?? 49, 4)
  head.writeInt32LE(bodyparts.length, 232)
  head.writeInt32LE(partsBase, 236)

  return Buffer.concat([head, partsBuf, ...blocks])
}

/** El AK-47 de COD4 real: cuerpo + 4 bodyparts de accesorio con "ninguna". */
const AK47: readonly MdlBodypart[] = [
  { name: '0', models: [{ name: 'ak47.smd', vertexCount: 1916 }, { name: 'ak_tactical.smd', vertexCount: 2760 }] },
  { name: '1', models: [{ name: '', vertexCount: 0 }, { name: 'rail.smd', vertexCount: 174 }] },
  { name: '2', models: [{ name: '', vertexCount: 0 }, { name: 'stock_h.smd', vertexCount: 62 }, { name: 'stock_tac.smd', vertexCount: 161 }] },
  { name: '3', models: [{ name: '', vertexCount: 0 }, { name: 'gp25.smd', vertexCount: 640 }] },
]

describe('parseBodyparts', () => {
  it('lee bodyparts, sus modelos y los conteos de vértices', () => {
    const buf = buildMdl([
      { name: 'body', models: [{ name: 'mp7.smd', verts: 3683 }] },
      { name: 'rail', models: [{ name: 'irons.smd', verts: 741 }, { name: '', verts: 0 }] },
    ])
    const parsed = parseBodyparts(buf)

    expect(parsed).toHaveLength(2)
    expect(parsed[0].name).toBe('body')
    expect(parsed[0].models[0]).toEqual({ name: 'mp7.smd', vertexCount: 3683 })
    expect(parsed[1].models.map((m) => m.name)).toEqual(['irons.smd', ''])
    expect(parsed[1].models[1].vertexCount).toBe(0)
  })

  /**
   * Este test existe por un fallo REAL de la tanda anterior de tests: con
   * `SIZEOF_MODEL` saboteado de 148 a 144 los tests seguían pasando, porque
   * todos los modelos que venían después del índice 0 eran la opción
   * "ninguna" (nombre vacío, cero vértices) y leerlos con el paso equivocado
   * caía igual sobre bytes en cero. Un stride mal calculado es el error más
   * probable de este parser y no lo detectaba nadie.
   *
   * Con TRES modelos seguidos, todos con nombre y conteo distintos, cualquier
   * paso que no sea 148 corre la lectura a mitad de la estructura vecina.
   */
  it('respeta el paso de mstudiomodel_t leyendo varios modelos con datos distintos', () => {
    const buf = buildMdl([
      {
        name: 'stock',
        models: [
          { name: 'stock_l.smd', verts: 111 },
          { name: 'stock_m.smd', verts: 222 },
          { name: 'stock_h.smd', verts: 333 },
        ],
      },
    ])
    const models = parseBodyparts(buf)[0].models

    expect(models.map((m) => m.name)).toEqual(['stock_l.smd', 'stock_m.smd', 'stock_h.smd'])
    expect(models.map((m) => m.vertexCount)).toEqual([111, 222, 333])
  })

  it('rechaza un archivo que no es .mdl en vez de devolver piezas inventadas', () => {
    expect(() => parseBodyparts(buildMdl([], { magic: 'GLTF' }))).toThrow(/IDST/)
  })

  it('rechaza una versión de .mdl con otra disposición de cabecera', () => {
    expect(() => parseBodyparts(buildMdl([], { version: 2531 }))).toThrow(/no soportada/)
  })
})

describe('chooseBodygroupModels', () => {
  it('toma el índice 0 de cada bodypart y descarta las variantes encimadas', () => {
    const elegidas = chooseBodygroupModels(AK47)
    // El cuerpo base entra; el cuerpo táctico alternativo NO (es el que
    // duplicaría el arma sobre sí misma).
    expect(elegidas).toContain('ak47')
    expect(elegidas).not.toContain('ak_tactical')
  })

  it('deja afuera los accesorios cuyo default es "ninguna"', () => {
    const elegidas = chooseBodygroupModels(AK47)
    expect(elegidas).not.toContain('rail')
    expect(elegidas).not.toContain('gp25')
  })

  it('rescata la culata cuando el default es "ninguna": un AK sin culata está roto', () => {
    expect(chooseBodygroupModels(AK47)).toContain('stock_h')
  })

  it('respeta el índice 0 cuando YA trae una pieza, aunque haya otra culata', () => {
    // Si el autor dejó una culata puesta por defecto, elegir otra sería
    // inventar una configuración distinta de la suya.
    const conCulataPuesta: readonly MdlBodypart[] = [
      { name: 'stock', models: [{ name: 'stock_m.smd', vertexCount: 78 }, { name: 'stock_l.smd', vertexCount: 78 }] },
    ]
    expect(chooseBodygroupModels(conCulataPuesta)).toEqual(['stock_m'])
  })

  it('no inventa una pieza cuando el bodypart entero es opcional', () => {
    const soloAccesorio: readonly MdlBodypart[] = [
      { name: 'optic', models: [{ name: '', vertexCount: 0 }, { name: 'acog.smd', vertexCount: 400 }] },
    ]
    expect(chooseBodygroupModels(soloAccesorio)).toEqual([])
  })

  it('normaliza el nombre de malla a lo que deja Blender', () => {
    expect(meshBaseName('25chunk/stock_l.smd')).toBe('stock_l')
    expect(meshBaseName('ak47.smd')).toBe('ak47')
  })
})
