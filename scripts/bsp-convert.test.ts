import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeIO } from '@gltf-transform/core'
import { describe, expect, it } from 'vitest'

import { METROS_POR_UNIDAD } from './lib/bsp.ts'
import { convertir, esCaraDescartable } from './bsp-convert.ts'
import { ESPESOR_CIERRE_M, MARGEN_JUGABLE_M } from './lib/caja-jugable.ts'

const S = METROS_POR_UNIDAD

/**
 * Constructor de un .bsp mínimo, hecho a mano lump por lump. Sólo escribe
 * los bytes que `bsp-convert.ts` efectivamente lee (el resto de cada struct
 * queda en cero); eso es seguro porque `scripts/lib/bsp.ts` documenta
 * exactamente qué campos usa cada lector.
 */

const TAM_CABECERA = 8 + 64 * 16

interface LadoSintetico {
  planeIdx: number
  bevel?: number
  /** Índice de texinfo del lado. Sólo importa para el filtro de volúmenes de
   *  trigger (`leerBrushesSolidos` mira el material de cada lado). */
  texinfo?: number
}
interface BrushSintetico {
  contents: number
  lados: LadoSintetico[]
}
interface FaceSintetica {
  firstedge: number
  numedges: number
  texinfo: number
  dispinfo?: number
}
interface TexInfoSintetico {
  vecS?: [number, number, number, number]
  vecT?: [number, number, number, number]
  flags?: number
  texdata: number
}
interface TexDataSintetico {
  nameStringTableID: number
  width: number
  height: number
}

interface BspSintetico {
  planos?: Array<[number, number, number, number]>
  brushes?: BrushSintetico[]
  vertices?: Array<[number, number, number]>
  edges?: Array<[number, number]>
  surfedges?: number[]
  faces?: FaceSintetica[]
  texinfos?: TexInfoSintetico[]
  texdatas?: TexDataSintetico[]
  materiales?: string[]
  entidades?: Array<Record<string, string>>
}

function empaquetarPlanos(planos: Array<[number, number, number, number]>): Buffer {
  const buf = Buffer.alloc(planos.length * 20)
  planos.forEach(([nx, ny, nz, d], i) => {
    const o = i * 20
    buf.writeFloatLE(nx, o)
    buf.writeFloatLE(ny, o + 4)
    buf.writeFloatLE(nz, o + 8)
    buf.writeFloatLE(d, o + 12)
  })
  return buf
}

function empaquetarBrushes(brushes: BrushSintetico[]): { brushesBuf: Buffer; sidesBuf: Buffer } {
  const brushesBuf = Buffer.alloc(brushes.length * 12)
  const todosLados: LadoSintetico[] = []
  brushes.forEach((b, i) => {
    const o = i * 12
    brushesBuf.writeInt32LE(todosLados.length, o)
    brushesBuf.writeInt32LE(b.lados.length, o + 4)
    brushesBuf.writeInt32LE(b.contents, o + 8)
    todosLados.push(...b.lados)
  })
  const sidesBuf = Buffer.alloc(todosLados.length * 8)
  todosLados.forEach((l, i) => {
    const o = i * 8
    sidesBuf.writeUInt16LE(l.planeIdx, o)
    sidesBuf.writeInt16LE(l.texinfo ?? 0, o + 2)
    sidesBuf.writeInt16LE(-1, o + 4)
    sidesBuf.writeInt16LE(l.bevel ?? 0, o + 6)
  })
  return { brushesBuf, sidesBuf }
}

function empaquetarVertices(vs: Array<[number, number, number]>): Buffer {
  const buf = Buffer.alloc(vs.length * 12)
  vs.forEach(([x, y, z], i) => {
    const o = i * 12
    buf.writeFloatLE(x, o)
    buf.writeFloatLE(y, o + 4)
    buf.writeFloatLE(z, o + 8)
  })
  return buf
}

function empaquetarEdges(es: Array<[number, number]>): Buffer {
  const buf = Buffer.alloc(es.length * 4)
  es.forEach(([a, b], i) => {
    const o = i * 4
    buf.writeUInt16LE(a, o)
    buf.writeUInt16LE(b, o + 2)
  })
  return buf
}

function empaquetarSurfedges(ses: number[]): Buffer {
  const buf = Buffer.alloc(ses.length * 4)
  ses.forEach((v, i) => buf.writeInt32LE(v, i * 4))
  return buf
}

function empaquetarFaces(faces: FaceSintetica[]): Buffer {
  const buf = Buffer.alloc(faces.length * 56)
  faces.forEach((f, i) => {
    const o = i * 56
    buf.writeInt32LE(f.firstedge, o + 4)
    buf.writeInt16LE(f.numedges, o + 8)
    buf.writeInt16LE(f.texinfo, o + 10)
    buf.writeInt16LE(f.dispinfo ?? -1, o + 12)
  })
  return buf
}

function empaquetarTexInfos(tis: TexInfoSintetico[]): Buffer {
  const buf = Buffer.alloc(tis.length * 72)
  tis.forEach((t, i) => {
    const o = i * 72
    const vecS = t.vecS ?? [0, 0, 0, 0]
    const vecT = t.vecT ?? [0, 0, 0, 0]
    vecS.forEach((v, k) => buf.writeFloatLE(v, o + k * 4))
    vecT.forEach((v, k) => buf.writeFloatLE(v, o + 16 + k * 4))
    buf.writeInt32LE(t.flags ?? 0, o + 64)
    buf.writeInt32LE(t.texdata, o + 68)
  })
  return buf
}

function empaquetarTexDatas(tds: TexDataSintetico[]): Buffer {
  const buf = Buffer.alloc(tds.length * 32)
  tds.forEach((t, i) => {
    const o = i * 32
    buf.writeInt32LE(t.nameStringTableID, o + 12)
    buf.writeInt32LE(t.width, o + 16)
    buf.writeInt32LE(t.height, o + 20)
  })
  return buf
}

function empaquetarNombresMateriales(nombres: string[]): { tabla: Buffer; datos: Buffer } {
  const trozos = nombres.map((n) => Buffer.concat([Buffer.from(n, 'ascii'), Buffer.from([0])]))
  const tabla = Buffer.alloc(nombres.length * 4)
  let cursor = 0
  trozos.forEach((t, i) => {
    tabla.writeInt32LE(cursor, i * 4)
    cursor += t.length
  })
  return { tabla, datos: Buffer.concat(trozos) }
}

function empaquetarEntidades(entidades: Array<Record<string, string>>): Buffer {
  const texto = entidades
    .map((e) => `{\n${Object.entries(e).map(([k, v]) => `"${k}" "${v}"`).join('\n')}\n}\n`)
    .join('')
  return Buffer.from(texto, 'utf8')
}

/**
 * Arma el .bsp completo: cabecera VBSP + directorio de 64 lumps + el
 * contenido de cada lump concatenado. Los lumps no pasados quedan vacíos
 * (offset=0, largo=0), que es exactamente cómo los lee `scripts/lib/bsp.ts`
 * cuando un mapa real no tiene displacements, por ejemplo.
 */
function construirBspSintetico(opts: BspSintetico): Buffer {
  const { brushesBuf, sidesBuf } = empaquetarBrushes(opts.brushes ?? [])
  const { tabla, datos } = empaquetarNombresMateriales(opts.materiales ?? [])

  // LUMP_PLANES=1, LUMP_VERTEXES=3, LUMP_TEXINFO=6, LUMP_FACES=7, LUMP_EDGES=12,
  // LUMP_SURFEDGES=13, LUMP_BRUSHES=18, LUMP_BRUSHSIDES=19,
  // LUMP_TEXDATA_STRING_DATA=43, LUMP_TEXDATA_STRING_TABLE=44,
  // LUMP_ENTITIES=0, LUMP_TEXDATA=2. Mismos índices que scripts/lib/bsp.ts.
  const lumps: Partial<Record<number, Buffer>> = {
    0: empaquetarEntidades(opts.entidades ?? []),
    1: empaquetarPlanos(opts.planos ?? []),
    2: empaquetarTexDatas(opts.texdatas ?? []),
    3: empaquetarVertices(opts.vertices ?? []),
    6: empaquetarTexInfos(opts.texinfos ?? []),
    7: empaquetarFaces(opts.faces ?? []),
    12: empaquetarEdges(opts.edges ?? []),
    13: empaquetarSurfedges(opts.surfedges ?? []),
    18: brushesBuf,
    19: sidesBuf,
    43: datos,
    44: tabla,
  }

  const partes: Buffer[] = []
  const directorio: Array<{ offset: number; largo: number }> = Array.from({ length: 64 }, () => ({
    offset: 0,
    largo: 0,
  }))
  let cursor = TAM_CABECERA
  for (let i = 0; i < 64; i++) {
    const contenido = lumps[i]
    if (!contenido || contenido.length === 0) continue
    directorio[i] = { offset: cursor, largo: contenido.length }
    partes.push(contenido)
    cursor += contenido.length
  }

  const header = Buffer.alloc(TAM_CABECERA)
  header.write('VBSP', 0, 'ascii')
  header.writeInt32LE(20, 4)
  for (let i = 0; i < 64; i++) {
    const base = 8 + i * 16
    header.writeInt32LE(directorio[i].offset, base)
    header.writeInt32LE(directorio[i].largo, base + 4)
  }

  return Buffer.concat([header, ...partes])
}

/** Seis planos de una caja alineada a ejes, normales hacia afuera. */
function planosDeCaja(min: [number, number, number], max: [number, number, number]): Array<[number, number, number, number]> {
  return [
    [-1, 0, 0, -min[0]],
    [1, 0, 0, max[0]],
    [0, -1, 0, -min[1]],
    [0, 1, 0, max[1]],
    [0, 0, -1, -min[2]],
    [0, 0, 1, max[2]],
  ]
}

const CONTENTS_SOLID = 0x1
const CONTENTS_WATER = 0x10

describe('bsp-convert: brush conocido sobrevive el viaje', () => {
  it('una caja asimétrica sale con sus 6 planos y bbox correctos, en metros', async () => {
    // Caja con las tres dimensiones y signos distintos a propósito (ver
    // advertencia del brief sobre puntos simétricos tipo (1,1,1)).
    const min: [number, number, number] = [-10, -20, -30]
    const max: [number, number, number] = [50, 60, 70]
    const planos = planosDeCaja(min, max)

    const buf = construirBspSintetico({
      planos,
      brushes: [{ contents: CONTENTS_SOLID, lados: planos.map((_, i) => ({ planeIdx: i })) }],
      entidades: [{ classname: 'info_player_start', origin: '0 0 0' }],
    })

    const { colision } = await convertir(buf, 'test-caja')
    expect(colision.brushes).toHaveLength(1)

    const brush = colision.brushes[0]
    expect(brush.planes).toHaveLength(24)

    // Calculado a mano (no reutilizando las funciones bajo prueba):
    // ejesSourceAThree(x,y,z) = (x,z,-y); d sólo se escala por S.
    const esperado = [
      [-1, 0, 0, 10 * S],
      [1, 0, 0, 50 * S],
      [0, 0, 1, 20 * S],
      [0, 0, -1, 60 * S],
      [0, -1, 0, 30 * S],
      [0, 1, 0, 70 * S],
    ].flat()
    esperado.forEach((v, i) => expect(brush.planes[i]).toBeCloseTo(v, 6))

    // bbox: min/max de Source transformados y recompuestos (no reordenados
    // ingenuamente -- ver scripts/lib/bsp.test.ts).
    expect(brush.min[0]).toBeCloseTo(-10 * S, 6)
    expect(brush.min[1]).toBeCloseTo(-30 * S, 6)
    expect(brush.min[2]).toBeCloseTo(-60 * S, 6)
    expect(brush.max[0]).toBeCloseTo(50 * S, 6)
    expect(brush.max[1]).toBeCloseTo(70 * S, 6)
    expect(brush.max[2]).toBeCloseTo(20 * S, 6)
  })
})

describe('bsp-convert: la rotación de ejes es correcta y única', () => {
  it('el mismo punto (1,2,3) sale como (1,3,-2)*escala en spawn, brush y vértice de mesh', async () => {
    // Brush: caja [0,0,0]-[1,2,3], así (1,2,3) es exactamente su esquina max.
    const minBrush: [number, number, number] = [0, 0, 0]
    const maxBrush: [number, number, number] = [1, 2, 3]
    const planos = planosDeCaja(minBrush, maxBrush)

    // Mesh: un único triángulo con (1,2,3) como uno de sus tres vértices, y
    // los otros dos NO colineales con él ni entre sí.
    const vertices: Array<[number, number, number]> = [
      [1, 2, 3],
      [0, 0, 0],
      [5, 0, 0],
    ]
    const edges: Array<[number, number]> = [
      [0, 1],
      [1, 2],
      [2, 0],
    ]
    const surfedges = [0, 1, 2]

    const buf = construirBspSintetico({
      planos,
      brushes: [{ contents: CONTENTS_SOLID, lados: planos.map((_, i) => ({ planeIdx: i })) }],
      entidades: [{ classname: 'info_player_deathmatch', origin: '1 2 3' }],
      vertices,
      edges,
      surfedges,
      faces: [{ firstedge: 0, numedges: 3, texinfo: 0 }],
      texinfos: [{ texdata: 0 }],
      texdatas: [{ nameStringTableID: 0, width: 1, height: 1 }],
      materiales: ['CONCRETE/FLOOR01'],
    })

    const { colision, doc } = await convertir(buf, 'test-ejes')

    // Punto de referencia EXACTO del brief: (1,2,3) -> (1,3,-2), escalado.
    const esperado: [number, number, number] = [1 * S, 3 * S, -2 * S]

    // 1) Spawn.
    expect(colision.spawns).toHaveLength(1)
    expect(colision.spawns[0][0]).toBeCloseTo(esperado[0], 6)
    expect(colision.spawns[0][1]).toBeCloseTo(esperado[1], 6)
    expect(colision.spawns[0][2]).toBeCloseTo(esperado[2], 6)

    // 2) Brush: (1,2,3) era la esquina `max` de la caja en Source. Tras la
    // rotación, x e y del punto transformado coinciden con el max del bbox
    // de salida, y su z coincide con el min (Z_three = -Y_source da vuelta
    // ese eje). Si la implementación mezclara los ejes distinto en brushes
    // que en spawns, esto dejaría de cumplirse aunque el spawn diera bien.
    const brush = colision.brushes[0]
    expect(brush.max[0]).toBeCloseTo(esperado[0], 6)
    expect(brush.max[1]).toBeCloseTo(esperado[1], 6)
    expect(brush.min[2]).toBeCloseTo(esperado[2], 6)

    // 3) Vértice de malla: alguna posición del GLB tiene que caer exactamente
    // en el punto esperado.
    const posiciones: number[] = []
    for (const mesh of doc.getRoot().listMeshes()) {
      for (const prim of mesh.listPrimitives()) {
        const pos = prim.getAttribute('POSITION')
        if (!pos) continue
        posiciones.push(...(pos.getArray() ?? []))
      }
    }
    let encontrado = false
    for (let i = 0; i + 2 < posiciones.length; i += 3) {
      const cerca =
        Math.abs(posiciones[i] - esperado[0]) < 1e-4 &&
        Math.abs(posiciones[i + 1] - esperado[1]) < 1e-4 &&
        Math.abs(posiciones[i + 2] - esperado[2]) < 1e-4
      if (cerca) {
        encontrado = true
        break
      }
    }
    expect(encontrado).toBe(true)
  })
})

describe('bsp-convert: filtra lo que no es sólido', () => {
  it('un brush sin CONTENTS_SOLID no aparece en la salida', async () => {
    const solidBox = planosDeCaja([0, 0, 0], [1, 1, 1])
    const waterBox = planosDeCaja([10, 10, 10], [11, 11, 11])
    const planos = [...solidBox, ...waterBox]

    const buf = construirBspSintetico({
      planos,
      brushes: [
        { contents: CONTENTS_SOLID, lados: solidBox.map((_, i) => ({ planeIdx: i })) },
        { contents: CONTENTS_WATER, lados: waterBox.map((_, i) => ({ planeIdx: solidBox.length + i })) },
      ],
      entidades: [{ classname: 'info_player_start', origin: '0 0 0' }],
    })

    const { colision } = await convertir(buf, 'test-solido')
    expect(colision.brushes).toHaveLength(1)
    // Es el que corresponde a la caja sólida, no a la de agua: su max en X
    // (antes de la rotación) era 1, no 11.
    expect(colision.brushes[0].max[0]).toBeCloseTo(1 * S, 6)
  })
})

describe('bsp-convert: filtra los volúmenes de trigger', () => {
  it('un brush con todos los lados en TOOLS/TOOLSTRIGGER no aparece, aunque diga CONTENTS_SOLID', async () => {
    const muro = planosDeCaja([0, 0, 0], [1, 1, 1])
    const trigger = planosDeCaja([10, 10, 10], [11, 11, 11])
    const planos = [...muro, ...trigger]

    // texinfo 0 -> texdata 0 -> material 0 ("CONCRETE/FLOOR01")
    // texinfo 1 -> texdata 1 -> material 1 ("TOOLS/TOOLSTRIGGER")
    const buf = construirBspSintetico({
      planos,
      materiales: ['CONCRETE/FLOOR01', 'TOOLS/TOOLSTRIGGER'],
      texdatas: [
        { nameStringTableID: 0, width: 64, height: 64 },
        { nameStringTableID: 1, width: 64, height: 64 },
      ],
      texinfos: [{ texdata: 0 }, { texdata: 1 }],
      brushes: [
        { contents: CONTENTS_SOLID, lados: muro.map((_, i) => ({ planeIdx: i, texinfo: 0 })) },
        {
          contents: CONTENTS_SOLID,
          lados: trigger.map((_, i) => ({ planeIdx: muro.length + i, texinfo: 1 })),
        },
      ],
      entidades: [{ classname: 'info_player_start', origin: '0 0 0' }],
    })

    const { colision } = await convertir(buf, 'test-trigger')
    // Sólo sobrevive el muro: el trigger es atravesable en el juego real
    // pese a su CONTENTS_SOLID (ver esVolumenDeTrigger en lib/bsp.ts).
    expect(colision.brushes).toHaveLength(1)
    expect(colision.brushes[0].max[0]).toBeCloseTo(1 * S, 6)
  })

  it('un brush sólido con UN lado de trigger sigue siendo sólido', async () => {
    // El filtro exige que TODOS los lados sean trigger: si mirara "alguno",
    // una cara mal texturada borraría un muro real del mapa.
    const muro = planosDeCaja([0, 0, 0], [1, 1, 1])
    const buf = construirBspSintetico({
      planos: muro,
      materiales: ['CONCRETE/FLOOR01', 'TOOLS/TOOLSTRIGGER'],
      texdatas: [
        { nameStringTableID: 0, width: 64, height: 64 },
        { nameStringTableID: 1, width: 64, height: 64 },
      ],
      texinfos: [{ texdata: 0 }, { texdata: 1 }],
      brushes: [
        {
          contents: CONTENTS_SOLID,
          lados: muro.map((_, i) => ({ planeIdx: i, texinfo: i === 0 ? 1 : 0 })),
        },
      ],
      entidades: [{ classname: 'info_player_start', origin: '0 0 0' }],
    })

    const { colision } = await convertir(buf, 'test-trigger-parcial')
    expect(colision.brushes).toHaveLength(1)
  })
})

describe('bsp-convert: descarta los lados bevel', () => {
  it('un lado bevel no aparece entre los planos del brush de salida', async () => {
    const caja = planosDeCaja([0, 0, 0], [1, 1, 1])
    // Séptimo plano: no forma parte de la geometría real de la caja, sólo
    // simula el plano de colisión extra que agrega vbsp.
    const bevel: [number, number, number, number] = [1, 1, 1, 100]
    const planos = [...caja, bevel]

    const buf = construirBspSintetico({
      planos,
      brushes: [
        {
          contents: CONTENTS_SOLID,
          lados: [...caja.map((_, i) => ({ planeIdx: i })), { planeIdx: 6, bevel: 1 }],
        },
      ],
      entidades: [{ classname: 'info_player_start', origin: '0 0 0' }],
    })

    const { colision } = await convertir(buf, 'test-bevel')
    expect(colision.brushes).toHaveLength(1)
    // 6 planos * 4 números, no 7*4: el bevel quedó afuera.
    expect(colision.brushes[0].planes).toHaveLength(24)
  })
})

describe('bsp-convert: contra los mapas reales', () => {
  const MAPAS = [
    {
      nombre: 'dm_nuketown',
      ruta: '/Users/santiago/dev/iagame/workshop-assets/maps/nuketown/maps/dm_nuketown.bsp',
    },
    {
      nombre: 'gm_lasertag_arena',
      ruta: '/Users/santiago/dev/iagame/workshop-assets/maps/lasertag/maps/gm_lasertag_arena.bsp',
    },
  ]

  for (const mapa of MAPAS) {
    const disponible = existsSync(mapa.ruta)

    // it.skip si el archivo no está (son ~40-50MB, no viven en el repo ni en
    // este worktree). Si SÍ está, el test corre en serio: no puede pasar en
    // falso porque `disponible` decide en tiempo de definición, antes de que
    // el cuerpo del test pueda tragarse un error.
    ;(disponible ? it : it.skip)(
      `${mapa.nombre}: convierte sin tirar, produce >1000 brushes, >0 spawns y un GLB válido`,
      async () => {
        const buf = readFileSync(mapa.ruta)
        const { colision, doc } = await convertir(buf, mapa.nombre)

        expect(colision.brushes.length).toBeGreaterThan(1000)
        expect(colision.spawns.length).toBeGreaterThan(0)

        const dirTmp = mkdtempSync(join(tmpdir(), 'bsp-convert-test-'))
        const rutaGlb = join(dirTmp, `${mapa.nombre}.glb`)
        const io = new NodeIO()
        await io.write(rutaGlb, doc)

        // Si el GLB estuviera corrupto, esta lectura tira.
        const releido = await io.read(rutaGlb)
        let triangulos = 0
        for (const mesh of releido.getRoot().listMeshes()) {
          for (const prim of mesh.listPrimitives()) {
            const idx = prim.getIndices()
            triangulos += idx ? Math.floor(idx.getCount() / 3) : 0
          }
        }
        expect(triangulos).toBeGreaterThan(0)
      },
      30_000,
    )
  }
})

/**
 * Un .bsp sintético con una malla visible CHICA y colisión GRANDE, que es
 * exactamente la forma del bug de nuketown: la geometría de colisión abarca
 * mucho más que lo que el mapa dibuja, y el jugador termina caminando sobre
 * piso invisible.
 *
 * La malla es un triángulo en el cuadrado de Source [0..100] x [0..100]; la
 * colisión son tres brushes: uno adentro, uno que se pasa por un lado, y uno
 * a 5000 unidades (el papel de la maqueta del skybox 3D).
 */
function bspMallaChicaColisionGrande(conSkyCamera: boolean) {
  const dentro = planosDeCaja([10, 10, -10], [90, 90, 0])
  const cruza = planosDeCaja([10, 10, 0], [5000, 90, 10])
  const lejos = planosDeCaja([9000, 9000, 0], [9100, 9100, 10])
  const planos = [...dentro, ...cruza, ...lejos]
  const idx = (base: number) => planos.slice(base, base + 6).map((_, i) => ({ planeIdx: base + i }))

  const entidades: Array<Record<string, string>> = [
    { classname: 'info_player_deathmatch', origin: '50 50 8' },
  ]
  if (conSkyCamera) entidades.push({ classname: 'sky_camera', origin: '9050 9050 8', scale: '16' })

  return construirBspSintetico({
    planos,
    brushes: [
      { contents: CONTENTS_SOLID, lados: idx(0) },
      { contents: CONTENTS_SOLID, lados: idx(6) },
      { contents: CONTENTS_SOLID, lados: idx(12) },
    ],
    entidades,
    vertices: [
      [0, 0, 0],
      [100, 0, 0],
      [0, 100, 0],
    ],
    edges: [
      [0, 1],
      [1, 2],
      [2, 0],
    ],
    surfedges: [0, 1, 2],
    faces: [{ firstedge: 0, numedges: 3, texinfo: 0 }],
    texinfos: [{ texdata: 0 }],
    texdatas: [{ nameStringTableID: 0, width: 1, height: 1 }],
    materiales: ['CONCRETE/FLOOR01'],
  })
}

describe('bsp-convert: la colisión no se sale de la caja jugable', () => {
  it('descarta el brush lejano, recorta el que cruza y sella el recinto', async () => {
    const { colision, reporte } = await convertir(bspMallaChicaColisionGrande(true), 'test-jugable')
    const j = reporte.jugable

    expect(j.caja).not.toBeNull()
    expect(j.descartados).toBe(1)
    expect(j.enSkybox3D).toBe(1)
    expect(j.recortados).toBe(1)
    expect(j.dentro).toBe(1)
    expect(j.cierre).toBe(5)

    // La caja jugable sale de la malla (0..100 unidades de Source en X, que
    // son 0..1.905 m) más el margen, NO de los 5000 de la colisión.
    const caja = j.caja!
    expect(caja.max[0]).toBeLessThan(100 * S + MARGEN_JUGABLE_M + 1e-6)

    // Ningún brush emitido se va de la caja jugable, salvo los muros de
    // cierre, que por definición viven pegados por afuera.
    const fuera = colision.brushes.filter(
      (b) => b.min[0] > caja.max[0] + 1e-6 || b.max[0] < caja.min[0] - 1e-6,
    )
    expect(fuera).toHaveLength(0)

    // El brush que cruzaba llegaba a 5000 unidades (95 m) y ahora termina en
    // el borde de la caja. Sin el recorte esto seguiría dando 95.
    const maxX = Math.max(...colision.brushes.map((b) => b.max[0]))
    expect(maxX).toBeLessThan(caja.max[0] + ESPESOR_CIERRE_M + 1e-6)
  })

  it('sin sky_camera igual recorta, pero no atribuye nada a la maqueta del skybox', async () => {
    // El brush lejano se sigue descartando -- no toca la caja jugable -- pero
    // sin la entidad que marca la maqueta no se lo puede LLAMAR skybox 3D.
    // Distinguir las dos cosas es lo que hace que el reporte sirva.
    const { reporte } = await convertir(bspMallaChicaColisionGrande(false), 'test-sin-sky')
    expect(reporte.jugable.descartados).toBe(1)
    expect(reporte.jugable.enSkybox3D).toBe(0)
  })

  it('el jugador queda encerrado: los muros de cierre rodean la caja por los cuatro costados', async () => {
    const { colision, reporte } = await convertir(bspMallaChicaColisionGrande(true), 'test-cierre')
    const caja = reporte.jugable.caja!
    // Se toman los brushes que están AFUERA de la caja (los de cierre) y se
    // comprueba que hay uno en cada uno de los cuatro rumbos horizontales.
    const afuera = colision.brushes.filter(
      (b) =>
        b.max[0] <= caja.min[0] + 1e-6 ||
        b.min[0] >= caja.max[0] - 1e-6 ||
        b.max[2] <= caja.min[2] + 1e-6 ||
        b.min[2] >= caja.max[2] - 1e-6,
    )
    expect(afuera.some((b) => b.max[0] <= caja.min[0] + 1e-6)).toBe(true)
    expect(afuera.some((b) => b.min[0] >= caja.max[0] - 1e-6)).toBe(true)
    expect(afuera.some((b) => b.max[2] <= caja.min[2] + 1e-6)).toBe(true)
    expect(afuera.some((b) => b.min[2] >= caja.max[2] - 1e-6)).toBe(true)
  })
})

describe('bsp-convert: las caras de herramienta no llegan a la malla', () => {
  it('un material TOOLS/TOOLSSKYBOX no aporta triángulos ni agranda la caja jugable', async () => {
    // Es el caso real de nuketown: la cáscara de toolsskybox mide 136 m de
    // profundidad contra los 76 del mapa. Si se colara a la malla, la caja
    // jugable saldría de ella y el filtro de colisión no filtraría nada.
    expect(esCaraDescartable(0, 'TOOLS/TOOLSSKYBOX')).toBe(true)
    expect(esCaraDescartable(0, 'TOOLS/TOOLSBLACK')).toBe(true)
    expect(esCaraDescartable(0, 'CONCRETE/FLOOR01')).toBe(false)

    const planos = planosDeCaja([0, 0, 0], [10, 10, 10])
    const buf = construirBspSintetico({
      planos,
      brushes: [{ contents: CONTENTS_SOLID, lados: planos.map((_, i) => ({ planeIdx: i })) }],
      entidades: [{ classname: 'info_player_deathmatch', origin: '5 5 5' }],
      vertices: [
        [0, 0, 0],
        [100, 0, 0],
        [0, 100, 0],
        [0, 0, 0],
        [4000, 0, 0],
        [0, 4000, 0],
      ],
      edges: [
        [0, 1],
        [1, 2],
        [2, 0],
        [3, 4],
        [4, 5],
        [5, 3],
      ],
      surfedges: [0, 1, 2, 3, 4, 5],
      faces: [
        { firstedge: 0, numedges: 3, texinfo: 0 },
        { firstedge: 3, numedges: 3, texinfo: 1 },
      ],
      texinfos: [{ texdata: 0 }, { texdata: 1 }],
      texdatas: [
        { nameStringTableID: 0, width: 1, height: 1 },
        { nameStringTableID: 1, width: 1, height: 1 },
      ],
      materiales: ['CONCRETE/FLOOR01', 'TOOLS/TOOLSSKYBOX'],
    })

    const { reporte } = await convertir(buf, 'test-tools')
    // Sólo el triángulo de concreto.
    expect(reporte.triangulos).toBe(1)
    // Y la caja jugable sale de ESE triángulo (100 unidades), no del de
    // toolsskybox (4000).
    expect(reporte.jugable.caja!.max[0]).toBeLessThan(100 * S + MARGEN_JUGABLE_M + 1e-6)
  })
})
