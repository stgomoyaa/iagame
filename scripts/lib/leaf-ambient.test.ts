import { describe, expect, it } from 'vitest'

import type { Lump } from './bsp.ts'
import { cuboEnPunto, hojaDePunto, leerAmbiente, promedioCubo } from './leaf-ambient.ts'

/**
 * Los .bsp de verdad no están en el repo (viven en `workshop-assets/`, que
 * es gitignoreado), así que estos tests arman a mano el pedazo de formato
 * que le importa a leaf-ambient.ts. Es más trabajo que cargar un archivo,
 * pero deja los casos borde -- hoja sólida, par LDR vacío, muestra lejana --
 * escritos explícitamente en vez de depender de que un mapa concreto los
 * contenga.
 */

const LUMP_PLANES = 1
const LUMP_NODES = 5
const LUMP_LEAFS = 10
const LUMP_AMB_INDEX_HDR = 51
const LUMP_AMB_INDEX = 52
const LUMP_AMB_HDR = 55
const LUMP_AMB = 56

interface Muestra {
  /** Los 6 colores del cubo como [r,g,b,exponente]. */
  cubo: [number, number, number, number][]
  /** Posición fraccionaria 0..255 dentro de la caja de la hoja. */
  frac: [number, number, number]
}

interface Hoja {
  min: [number, number, number]
  max: [number, number, number]
  muestras: Muestra[]
}

interface Nodo {
  plano: number
  /** Índice de nodo si es >= 0; hoja `h` se escribe como `-1 - h`. */
  hijos: [number, number]
}

/**
 * Arma un buffer con la forma de un .bsp: cabecera VBSP + directorio de 64
 * lumps + los datos. Sólo escribe los lumps que leaf-ambient.ts lee.
 */
function bspFalso(opciones: {
  planos: { n: [number, number, number]; d: number }[]
  nodos: Nodo[]
  hojas: Hoja[]
  /** En qué par van las muestras. El otro queda relleno de ceros. */
  par?: 'ldr' | 'hdr'
  /** Deja el par elegido con muestras en cero (energía nula). */
  vacio?: boolean
}): Buffer {
  const { planos, nodos, hojas, par = 'ldr', vacio = false } = opciones

  const bufPlanos = Buffer.alloc(planos.length * 20)
  planos.forEach((p, i) => {
    bufPlanos.writeFloatLE(p.n[0], i * 20)
    bufPlanos.writeFloatLE(p.n[1], i * 20 + 4)
    bufPlanos.writeFloatLE(p.n[2], i * 20 + 8)
    bufPlanos.writeFloatLE(p.d, i * 20 + 12)
  })

  const bufNodos = Buffer.alloc(nodos.length * 32)
  nodos.forEach((n, i) => {
    bufNodos.writeInt32LE(n.plano, i * 32)
    bufNodos.writeInt32LE(n.hijos[0], i * 32 + 4)
    bufNodos.writeInt32LE(n.hijos[1], i * 32 + 8)
  })

  // dleaf_t v1: 32 bytes, con mins/maxs (short) en +8..+18.
  const bufHojas = Buffer.alloc(hojas.length * 32)
  hojas.forEach((h, i) => {
    for (let e = 0; e < 3; e++) {
      bufHojas.writeInt16LE(h.min[e], i * 32 + 8 + e * 2)
      bufHojas.writeInt16LE(h.max[e], i * 32 + 14 + e * 2)
    }
  })

  const todas = hojas.flatMap((h) => h.muestras)
  const bufIndice = Buffer.alloc(hojas.length * 4)
  let primera = 0
  hojas.forEach((h, i) => {
    bufIndice.writeUInt16LE(h.muestras.length, i * 4)
    bufIndice.writeUInt16LE(primera, i * 4 + 2)
    primera += h.muestras.length
  })

  const bufMuestras = Buffer.alloc(todas.length * 28)
  todas.forEach((m, i) => {
    if (!vacio) {
      for (let d = 0; d < 6; d++) {
        const c = m.cubo[d]
        bufMuestras.writeUInt8(c[0], i * 28 + d * 4)
        bufMuestras.writeUInt8(c[1], i * 28 + d * 4 + 1)
        bufMuestras.writeUInt8(c[2], i * 28 + d * 4 + 2)
        bufMuestras.writeInt8(c[3], i * 28 + d * 4 + 3)
      }
    }
    bufMuestras.writeUInt8(m.frac[0], i * 28 + 24)
    bufMuestras.writeUInt8(m.frac[1], i * 28 + 25)
    bufMuestras.writeUInt8(m.frac[2], i * 28 + 26)
  })

  // El par que NO se usa queda con el mismo tamaño pero en cero, que es
  // como vienen los mapas reales (nuketown tiene el HDR así, lasertag el LDR).
  const idxA = par === 'ldr' ? LUMP_AMB_INDEX : LUMP_AMB_INDEX_HDR
  const ambA = par === 'ldr' ? LUMP_AMB : LUMP_AMB_HDR
  const idxB = par === 'ldr' ? LUMP_AMB_INDEX_HDR : LUMP_AMB_INDEX
  const ambB = par === 'ldr' ? LUMP_AMB_HDR : LUMP_AMB

  const piezas: { lump: number; datos: Buffer }[] = [
    { lump: LUMP_PLANES, datos: bufPlanos },
    { lump: LUMP_NODES, datos: bufNodos },
    { lump: LUMP_LEAFS, datos: bufHojas },
    { lump: idxA, datos: bufIndice },
    { lump: ambA, datos: bufMuestras },
    { lump: idxB, datos: Buffer.alloc(bufIndice.length) },
    { lump: ambB, datos: Buffer.alloc(bufMuestras.length) },
  ]

  const cabecera = 8 + 64 * 16
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

/** Cubo de un solo color en las 6 direcciones. */
function cuboPlano(r: number, g: number, b: number, exp: number): [number, number, number, number][] {
  return Array.from({ length: 6 }, () => [r, g, b, exp] as [number, number, number, number])
}

/**
 * Mundo mínimo: un plano en x=0 parte el espacio en dos hojas. La hoja 0
 * (x >= 0) es aire brillante; la hoja 1 (x < 0) es aire oscuro.
 */
function mundoDosHojas(): { buf: Buffer; lumps: Lump[] } {
  const buf = bspFalso({
    planos: [{ n: [1, 0, 0], d: 0 }],
    // hijo[0] = lado positivo del plano -> hoja 0; hijo[1] -> hoja 1
    nodos: [{ plano: 0, hijos: [-1, -2] }],
    hojas: [
      {
        min: [0, 0, 0],
        max: [100, 100, 100],
        muestras: [{ cubo: cuboPlano(128, 128, 128, 0), frac: [128, 128, 128] }],
      },
      {
        min: [-100, 0, 0],
        max: [0, 100, 100],
        muestras: [{ cubo: cuboPlano(32, 32, 32, 0), frac: [128, 128, 128] }],
      },
    ],
  })
  return { buf, lumps: lumpsDe(buf) }
}

describe('leerAmbiente', () => {
  it('lee hojas y muestras de un mapa con datos en el par LDR', () => {
    const { buf, lumps } = mundoDosHojas()
    const a = leerAmbiente(buf, lumps)
    expect(a).not.toBeNull()
    expect(a!.hojas).toBe(2)
    expect(a!.muestras).toBe(2)
  })

  it('elige el par HDR cuando el LDR está en cero', () => {
    // Es el caso de gm_lasertag_arena: los dos pares existen y tienen el
    // mismo tamaño, pero la luz está sólo en el HDR. Elegir el LDR "porque
    // es el primero" deja todos los props en negro.
    const buf = bspFalso({
      planos: [{ n: [1, 0, 0], d: 0 }],
      nodos: [{ plano: 0, hijos: [-1, -2] }],
      hojas: [
        { min: [0, 0, 0], max: [100, 100, 100], muestras: [{ cubo: cuboPlano(200, 200, 200, 0), frac: [128, 128, 128] }] },
        { min: [-100, 0, 0], max: [0, 100, 100], muestras: [{ cubo: cuboPlano(200, 200, 200, 0), frac: [128, 128, 128] }] },
      ],
      par: 'hdr',
    })
    const a = leerAmbiente(buf, lumpsDe(buf))
    expect(a).not.toBeNull()
    const cubo = new Float32Array(18)
    expect(cuboEnPunto(a!, 50, 50, 50, cubo)).toBe('hoja')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(200, 5)
  })

  it('devuelve null si ningún par trae energía', () => {
    const buf = bspFalso({
      planos: [{ n: [1, 0, 0], d: 0 }],
      nodos: [{ plano: 0, hijos: [-1, -2] }],
      hojas: [
        { min: [0, 0, 0], max: [100, 100, 100], muestras: [{ cubo: cuboPlano(0, 0, 0, 0), frac: [0, 0, 0] }] },
        { min: [-100, 0, 0], max: [0, 100, 100], muestras: [{ cubo: cuboPlano(0, 0, 0, 0), frac: [0, 0, 0] }] },
      ],
      vacio: true,
    })
    expect(leerAmbiente(buf, lumpsDe(buf))).toBeNull()
  })

  it('resuelve la posición de mundo de cada muestra desde su fracción de hoja', () => {
    // Las muestras guardan x/y/z como 0..255 relativo a la caja de SU hoja,
    // no como unidades de Source. Leerlas como absolutas amontona todas las
    // muestras del mapa en un cubo de 255 unidades cerca del origen.
    const { buf, lumps } = mundoDosHojas()
    const a = leerAmbiente(buf, lumps)!
    // frac 128/255 sobre la caja [0,100] de la hoja 0
    expect(a.posiciones[0]).toBeCloseTo((128 / 255) * 100, 3)
    // la hoja 1 va de -100 a 0 en x: su muestra tiene que caer en negativo
    expect(a.posiciones[3]).toBeCloseTo(-100 + (128 / 255) * 100, 3)
  })
})

describe('hojaDePunto', () => {
  it('baja el árbol hasta la hoja que contiene el punto', () => {
    const { buf, lumps } = mundoDosHojas()
    const a = leerAmbiente(buf, lumps)!
    expect(hojaDePunto(a, 50, 50, 50)).toBe(0)
    expect(hojaDePunto(a, -50, 50, 50)).toBe(1)
  })
})

describe('cuboEnPunto', () => {
  it('usa la muestra de la propia hoja cuando la hay', () => {
    const { buf, lumps } = mundoDosHojas()
    const a = leerAmbiente(buf, lumps)!
    const cubo = new Float32Array(18)
    expect(cuboEnPunto(a, 50, 50, 50, cubo)).toBe('hoja')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(128, 5)
    expect(cuboEnPunto(a, -50, 50, 50, cubo)).toBe('hoja')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(32, 5)
  })

  it('sondea el vecindario cuando el punto cae en una hoja sin muestras', () => {
    // Es el caso de las persianas y las lámparas de nuketown: su origen
    // está DENTRO del brush donde están clavadas. La hoja sólida (la 1) no
    // tiene muestras y hay que buscar el aire de al lado.
    const buf = bspFalso({
      planos: [{ n: [1, 0, 0], d: 0 }],
      nodos: [{ plano: 0, hijos: [-1, -2] }],
      hojas: [
        { min: [0, 0, 0], max: [100, 100, 100], muestras: [{ cubo: cuboPlano(200, 200, 200, 0), frac: [0, 128, 128] }] },
        { min: [-100, 0, 0], max: [0, 100, 100], muestras: [] },
      ],
    })
    const a = leerAmbiente(buf, lumpsDe(buf))!
    const cubo = new Float32Array(18)
    // x=-8 cae en la hoja sólida; a 16 unidades hacia +x hay aire.
    expect(cuboEnPunto(a, -8, 50, 50, cubo)).toBe('vecindario')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(200, 5)
  })

  it('entre dos hojas vecinas elige la muestra más cercana, no la primera sondeada', () => {
    // Un prop dentro de una pared tiene aire a los DOS lados. Los sondeos
    // salen en orden (+x antes que -x), así que quedarse con el primero que
    // aparezca le da la luz del lado equivocado. Acá el lado +x se sondea
    // primero pero su muestra está a 60 unidades, y la del lado -x -- la
    // que le corresponde al prop -- está a 12.
    const buf = bspFalso({
      // x > 10 : hoja 0 | -10..10 : hoja 1 (sólida) | x < -10 : hoja 2
      planos: [
        { n: [1, 0, 0], d: 10 },
        { n: [1, 0, 0], d: -10 },
      ],
      nodos: [
        { plano: 0, hijos: [-1, 1] },
        { plano: 1, hijos: [-2, -3] },
      ],
      hojas: [
        // muestra en x ~= 60, lejos del prop
        { min: [10, 0, 0], max: [200, 100, 100], muestras: [{ cubo: cuboPlano(255, 255, 255, 0), frac: [67, 128, 128] }] },
        { min: [-10, 0, 0], max: [10, 100, 100], muestras: [] },
        // muestra en x ~= -12, pegada al prop
        { min: [-200, 0, 0], max: [-10, 100, 100], muestras: [{ cubo: cuboPlano(64, 64, 64, 0), frac: [252, 128, 128] }] },
      ],
    })
    const a = leerAmbiente(buf, lumpsDe(buf))!
    const cubo = new Float32Array(18)
    expect(cuboEnPunto(a, 0, 50, 50, cubo)).toBe('vecindario')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(64, 5)
  })

  it('cae a la muestra más lejana antes que devolver nada', () => {
    // Sin muestras cerca, un prop sin luz saldría NEGRO. Es preferible una
    // respuesta mala y acotada.
    const buf = bspFalso({
      planos: [{ n: [1, 0, 0], d: 0 }],
      nodos: [{ plano: 0, hijos: [-1, -2] }],
      hojas: [
        { min: [0, 0, 0], max: [20000, 100, 100], muestras: [{ cubo: cuboPlano(90, 90, 90, 0), frac: [255, 128, 128] }] },
        { min: [-20000, 0, 0], max: [0, 100, 100], muestras: [] },
      ],
    })
    const a = leerAmbiente(buf, lumpsDe(buf))!
    const cubo = new Float32Array(18)
    // Bien adentro de la hoja sin muestras, más lejos que el radio máximo
    // de sondeo (128 unidades).
    expect(cuboEnPunto(a, -10000, 50, 50, cubo)).toBe('lejano')
    expect(promedioCubo(cubo)[0]).toBeCloseTo(90, 5)
  })

  it('decodifica el exponente CON SIGNO', () => {
    // El cubo ambiental usa exponentes típicamente negativos (-7 en
    // nuketown). Leer el byte sin signo convierte 2^-7 en 2^249 y el mapa
    // entero sale blanco.
    const buf = bspFalso({
      planos: [{ n: [1, 0, 0], d: 0 }],
      nodos: [{ plano: 0, hijos: [-1, -2] }],
      hojas: [
        { min: [0, 0, 0], max: [100, 100, 100], muestras: [{ cubo: cuboPlano(128, 128, 128, -7), frac: [128, 128, 128] }] },
        { min: [-100, 0, 0], max: [0, 100, 100], muestras: [{ cubo: cuboPlano(128, 128, 128, -7), frac: [128, 128, 128] }] },
      ],
    })
    const a = leerAmbiente(buf, lumpsDe(buf))!
    const cubo = new Float32Array(18)
    cuboEnPunto(a, 50, 50, 50, cubo)
    expect(promedioCubo(cubo)[0]).toBeCloseTo(128 * Math.pow(2, -7), 5)
  })
})

describe('promedioCubo', () => {
  it('promedia las 6 direcciones', () => {
    const cubo = new Float32Array(18)
    // Una sola dirección iluminada: el promedio es 1/6 de su valor.
    cubo[0] = 6
    cubo[1] = 12
    cubo[2] = 18
    expect(promedioCubo(cubo)).toEqual([1, 2, 3])
  })
})
