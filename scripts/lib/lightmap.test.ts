import { describe, expect, it } from 'vitest'

import { type Lump, TAM_FACE, TAM_TEXINFO } from './bsp.ts'
import {
  construirAtlas,
  decodificarMuestra,
  empacar,
  exposicionDelMapa,
  uvLightmap,
  type CaraLightmap,
  type RectAtlas,
} from './lightmap.ts'

/**
 * Estos tests apuntan a las tres formas en que un atlas de lightmap sale
 * "casi bien" y no hay manera de notarlo mirando un número: el exponente
 * leído sin signo (el mapa sale quemado), el UV sin el medio texel o sin el
 * offset del rect (la luz queda corrida o directamente es la de otra pared),
 * y el empaquetado con rectángulos superpuestos (dos caras comparten
 * muestras).
 */

describe('decodificarMuestra (ColorRGBExp32)', () => {
  const conExponente = (r: number, g: number, b: number, e: number): Buffer => {
    const b4 = Buffer.alloc(4)
    b4.writeUInt8(r, 0)
    b4.writeUInt8(g, 1)
    b4.writeUInt8(b, 2)
    b4.writeInt8(e, 3)
    return b4
  }

  it('multiplica por 2^exp con exponente positivo', () => {
    expect(decodificarMuestra(conExponente(10, 20, 30, 2), 0)).toEqual([40, 80, 120])
  })

  it('el exponente es CON SIGNO: uno negativo oscurece, no explota', () => {
    // Éste es el test que importa. Leyendo el byte como unsigned, -2 se lee
    // como 254 y el factor pasa de 0.25 a 2^254: toda la sombra del mapa se
    // convierte en blanco infinito. Con signo, oscurece a un cuarto.
    expect(decodificarMuestra(conExponente(40, 80, 120, -2), 0)).toEqual([10, 20, 30])
  })

  it('exponente 0 deja la muestra tal cual', () => {
    expect(decodificarMuestra(conExponente(7, 8, 9, 0), 0)).toEqual([7, 8, 9])
  })

  it('respeta el offset dentro del buffer', () => {
    const buf = Buffer.concat([Buffer.alloc(4, 0xff), conExponente(1, 2, 3, 1)])
    expect(decodificarMuestra(buf, 4)).toEqual([2, 4, 6])
  })
})

describe('empacar', () => {
  /** ¿Se pisan dos rectángulos, contando el borde de padding de cada uno? */
  const seSuperponen = (a: RectAtlas, b: RectAtlas): boolean =>
    a.x - 1 < b.x + b.w + 1 && b.x - 1 < a.x + a.w + 1 && a.y - 1 < b.y + b.h + 1 && b.y - 1 < a.y + a.h + 1

  it('no superpone ningún par, ni contando el padding de 1 texel', () => {
    // Tamaños variados y no alineados a potencia de dos a propósito: con
    // rectángulos todos iguales, un packer roto igual da un resultado
    // prolijo y el test no ve nada.
    const tamanos = [
      { w: 33, h: 33 },
      { w: 5, h: 12 },
      { w: 17, h: 3 },
      { w: 1, h: 1 },
      { w: 9, h: 9 },
      { w: 2, h: 30 },
      { w: 14, h: 7 },
      { w: 6, h: 6 },
    ]
    const rects = empacar(tamanos, 128)
    expect(rects).not.toBeNull()
    const r = rects as RectAtlas[]

    for (let i = 0; i < r.length; i++) {
      for (let j = i + 1; j < r.length; j++) {
        expect(seSuperponen(r[i], r[j])).toBe(false)
      }
    }
  })

  it('conserva el tamaño pedido en cada rect y respeta el índice original', () => {
    const tamanos = [
      { w: 4, h: 20 },
      { w: 30, h: 2 },
      { w: 8, h: 8 },
    ]
    const r = empacar(tamanos, 64) as RectAtlas[]
    // El packer ordena por alto para empaquetar, pero devuelve los rects en
    // el orden de ENTRADA: si devolviera el orden de empaquetado, cada cara
    // recibiría el rect de otra.
    expect(r[0].w).toBe(4)
    expect(r[0].h).toBe(20)
    expect(r[1].w).toBe(30)
    expect(r[1].h).toBe(2)
    expect(r[2].w).toBe(8)
    expect(r[2].h).toBe(8)
  })

  it('deja todo dentro del atlas, con lugar para el padding', () => {
    const tamanos = Array.from({ length: 40 }, (_, i) => ({ w: 1 + (i % 7), h: 1 + (i % 5) }))
    const r = empacar(tamanos, 64) as RectAtlas[]
    for (const rect of r) {
      expect(rect.x - 1).toBeGreaterThanOrEqual(0)
      expect(rect.y - 1).toBeGreaterThanOrEqual(0)
      expect(rect.x + rect.w + 1).toBeLessThanOrEqual(64)
      expect(rect.y + rect.h + 1).toBeLessThanOrEqual(64)
    }
  })

  it('devuelve null si no entra, en vez de recortar en silencio', () => {
    expect(empacar([{ w: 100, h: 100 }], 64)).toBeNull()
  })
})

describe('uvLightmap', () => {
  /**
   * Cara de 4x4 luxels alineada al plano XY: los lightmapVecs son los ejes
   * canónicos, así que el luxel de un vértice es directamente su coordenada.
   * Eso deja ver el offset del rect y el medio texel sin que la proyección
   * los tape.
   */
  const cara: CaraLightmap = {
    cara: 0,
    lightofs: 0,
    w: 4,
    h: 4,
    minU: 0,
    minV: 0,
    vecU: [1, 0, 0, 0],
    vecV: [0, 1, 0, 0],
  }
  const rect: RectAtlas = { x: 10, y: 20, w: 4, h: 4 }
  const LADO = 64

  it('pone el vértice del luxel (0,0) en el CENTRO de su texel del atlas', () => {
    const [u, v] = uvLightmap([0, 0, 0], cara, rect, LADO)
    // (10 + 0 + 0.5) / 64 y (20 + 0 + 0.5) / 64. Sin el medio texel daría
    // 10/64 y 20/64, que es el borde del texel: ahí el filtrado bilineal ya
    // mezcla con el vecino de al lado en el atlas.
    expect(u).toBeCloseTo(10.5 / 64, 10)
    expect(v).toBeCloseTo(20.5 / 64, 10)
  })

  it('avanza un texel del atlas por cada luxel', () => {
    const [u, v] = uvLightmap([3, 2, 0], cara, rect, LADO)
    expect(u).toBeCloseTo(13.5 / 64, 10)
    expect(v).toBeCloseTo(22.5 / 64, 10)
  })

  it('resta LightmapTextureMinsInLuxels', () => {
    // Una cara que arranca en el luxel 100 del espacio del mapa sigue
    // ocupando su rect desde el texel 0: sin restar los mins, el UV se va a
    // 100 texeles de distancia, o sea a la luz de cualquier otra cara.
    const corrida: CaraLightmap = { ...cara, minU: 100, minV: 50 }
    const [u, v] = uvLightmap([100, 50, 0], corrida, rect, LADO)
    expect(u).toBeCloseTo(10.5 / 64, 10)
    expect(v).toBeCloseTo(20.5 / 64, 10)
  })

  it('usa el offset w de lightmapVecs, no sólo la parte xyz', () => {
    const conOffset: CaraLightmap = { ...cara, vecU: [1, 0, 0, 2], vecV: [0, 1, 0, 3] }
    const [u, v] = uvLightmap([0, 0, 0], conOffset, rect, LADO)
    expect(u).toBeCloseTo(12.5 / 64, 10)
    expect(v).toBeCloseTo(23.5 / 64, 10)
  })

  it('clampea un vértice que cae afuera de la grilla, sin invadir la cara vecina', () => {
    // El compilador de Source deja vértices una fracción de luxel afuera.
    // Sin clamp, ese vértice muestrea más allá del rect: el borde replicado
    // primero y la cara de al lado del atlas después.
    const [u, v] = uvLightmap([99, -99, 0], cara, rect, LADO)
    expect(u).toBeCloseTo(13.5 / 64, 10) // clampeado a w-1 = 3
    expect(v).toBeCloseTo(20.5 / 64, 10) // clampeado a 0
  })
})

/**
 * `exposicionDelMapa` existe para que `bsp-props.ts` divida la luz de los
 * props por el MISMO número que `construirAtlas` usó para las paredes. El
 * riesgo no es que dé un valor raro, sino que dé un valor DISTINTO: props y
 * paredes quedarían expuestos diferente y el desajuste sería exactamente el
 * que el tinte por instancia vino a arreglar. Por eso el test compara las
 * dos funciones sobre el mismo mapa en vez de comprobar un número fijo.
 */
describe('exposicionDelMapa', () => {
  /** .bsp mínimo con LUMP_FACES + LUMP_TEXINFO + LUMP_LIGHTING. */
  function bspConLuz(muestras: [number, number, number, number][]): Buffer {
    const nCaras = 1
    const bufFaces = Buffer.alloc(nCaras * TAM_FACE)
    bufFaces.writeInt16LE(0, 10) // texinfo
    bufFaces.writeInt32LE(0, 20) // lightofs
    bufFaces.writeInt32LE(0, 28) // minU
    bufFaces.writeInt32LE(0, 32) // minV
    bufFaces.writeInt32LE(muestras.length - 1, 36) // size u (grilla = size+1)
    bufFaces.writeInt32LE(0, 40) // size v

    const bufTexinfo = Buffer.alloc(TAM_TEXINFO)
    bufTexinfo.writeFloatLE(1, 32)
    bufTexinfo.writeFloatLE(1, 48)

    const bufLight = Buffer.alloc(muestras.length * 4)
    muestras.forEach((m, i) => {
      bufLight.writeUInt8(m[0], i * 4)
      bufLight.writeUInt8(m[1], i * 4 + 1)
      bufLight.writeUInt8(m[2], i * 4 + 2)
      bufLight.writeInt8(m[3], i * 4 + 3)
    })

    const cabecera = 8 + 64 * 16
    const piezas: { lump: number; datos: Buffer }[] = [
      { lump: 6, datos: bufTexinfo },
      { lump: 7, datos: bufFaces },
      { lump: 8, datos: bufLight },
    ]
    const total = piezas.reduce((a, p) => a + p.datos.length, cabecera)
    const buf = Buffer.alloc(total)
    buf.write('VBSP', 0, 'ascii')
    buf.writeInt32LE(20, 4)
    let offset = cabecera
    for (const p of piezas) {
      buf.writeInt32LE(offset, 8 + p.lump * 16)
      buf.writeInt32LE(p.datos.length, 8 + p.lump * 16 + 4)
      p.datos.copy(buf, offset)
      offset += p.datos.length
    }
    return buf
  }

  function lumpsDe(buf: Buffer): Lump[] {
    const lumps: Lump[] = []
    for (let i = 0; i < 64; i++) {
      lumps.push({ offset: buf.readInt32LE(8 + i * 16), largo: buf.readInt32LE(8 + i * 16 + 4) })
    }
    return lumps
  }

  it('da exactamente la misma exposición que el atlas', () => {
    // Muestras por encima de 255 (exponente 1) para que el percentil caiga
    // arriba de 1.0 y la exposición no sea el piso trivial.
    const muestras: [number, number, number, number][] = Array.from(
      { length: 20 },
      (_, i) => [200 + i * 2, 200 + i * 2, 200 + i * 2, 1],
    )
    const buf = bspConLuz(muestras)
    const lumps = lumpsDe(buf)
    const atlas = construirAtlas(buf, lumps)
    expect(atlas).not.toBeNull()
    expect(exposicionDelMapa(buf, lumps)).toBe(atlas!.exposicion)
  })

  it('nunca baja de 1: un mapa tenue no se normaliza hacia arriba', () => {
    const buf = bspConLuz(Array.from({ length: 8 }, () => [40, 40, 40, 0]))
    expect(exposicionDelMapa(buf, lumpsDe(buf))).toBe(1)
  })

  it('devuelve null si el mapa no trae caras con lightmap', () => {
    const buf = bspConLuz([])
    expect(exposicionDelMapa(buf, lumpsDe(buf))).toBeNull()
  })
})
