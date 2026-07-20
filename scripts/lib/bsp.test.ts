import { describe, expect, it } from 'vitest'

import {
  METROS_POR_UNIDAD,
  bboxSourceAThreeMetros,
  ejesSourceAThree,
  planoSourceAThreeMetros,
  puntoSourceAThreeMetros,
  rotacionPropSourceAThree,
  yawSourceAThree,
} from './bsp.ts'

/**
 * Estos tests existen porque, según el brief de esta tarea, es fácil escribir
 * un test de conversión de ejes que pase con la transformación equivocada
 * porque usa un punto simétrico como (1,1,1) -- ahí da lo mismo si el bug
 * cambia el orden de los ejes o el signo, porque las tres componentes son
 * iguales. Todos los puntos de acá tienen las tres componentes DISTINTAS y
 * con signo mixto, para que cualquier permutación o signo equivocado cambie
 * el resultado.
 */

describe('ejesSourceAThree', () => {
  it('reordena (x,y,z) -> (x,z,-y) con un punto donde cada componente importa', () => {
    // Caso textual del brief: (1,2,3) sale en (1,3,-2).
    expect(ejesSourceAThree([1, 2, 3])).toEqual([1, 3, -2])
  })

  it('el signo de -y importa: con y negativo, z sale positivo', () => {
    // Si la implementación olvidara el signo (usara y en vez de -y), esto
    // daría [5, 9, -7] en vez de [5, 9, 7].
    expect(ejesSourceAThree([5, -7, 9])).toEqual([5, 9, 7])
  })
})

describe('puntoSourceAThreeMetros', () => {
  it('aplica la misma permutación que ejesSourceAThree y además escala a metros', () => {
    const S = METROS_POR_UNIDAD
    const [x, y, z] = puntoSourceAThreeMetros([1, 2, 3])
    expect(x).toBeCloseTo(1 * S, 10)
    expect(y).toBeCloseTo(3 * S, 10)
    expect(z).toBeCloseTo(-2 * S, 10)
  })
})

describe('planoSourceAThreeMetros', () => {
  it('rota la normal igual que un punto, pero d sólo se escala (no se reordena por eje)', () => {
    // Normal NO alineada a ejes, para no confundir "reordenar componentes"
    // con "casualmente da lo mismo" (pasaría con (0,1,0), por ejemplo).
    const S = METROS_POR_UNIDAD
    const { normal, d } = planoSourceAThreeMetros([0.6, 0.8, 0], 10)
    expect(normal[0]).toBeCloseTo(0.6, 10)
    expect(normal[1]).toBeCloseTo(0, 10)
    expect(normal[2]).toBeCloseTo(-0.8, 10)
    // Si `d` se reordenara por eje en vez de sólo escalarse, este valor
    // cambiaría (no hay "eje" del cual reordenar un escalar: es la prueba de
    // que el código no intenta hacerlo).
    expect(d).toBeCloseTo(10 * S, 10)
  })
})

describe('bboxSourceAThreeMetros', () => {
  it('transforma las dos esquinas y recalcula min/max: no asume qué esquina queda dónde', () => {
    // min/max con las tres componentes distintas y signo mixto. Si la
    // implementación reordenara min/max componente a componente SIN volver a
    // calcular cuál es cuál (bug típico: "min sigue siendo min"), el eje Z
    // saldría con min=3*S y max=-2*S -- invertido, porque Z_three = -Y_source
    // y por eso el signo se da vuelta justo en ese eje.
    const S = METROS_POR_UNIDAD
    const { min, max } = bboxSourceAThreeMetros([-2, -3, -4], [1, 2, 3])

    expect(min[0]).toBeCloseTo(-2 * S, 10)
    expect(min[1]).toBeCloseTo(-4 * S, 10)
    expect(min[2]).toBeCloseTo(-2 * S, 10)

    expect(max[0]).toBeCloseTo(1 * S, 10)
    expect(max[1]).toBeCloseTo(3 * S, 10)
    expect(max[2]).toBeCloseTo(3 * S, 10)

    // Invariante que cualquier bbox real tiene que cumplir. No alcanza sola
    // (una implementación que devuelve min=max=0 la pasaría), pero es una
    // segunda red además de los valores exactos de arriba.
    for (let i = 0; i < 3; i++) expect(min[i]).toBeLessThanOrEqual(max[i])
  })

  it('con una caja íntegramente del lado positivo de Y, el eje Z de three sale íntegramente negativo', () => {
    // Caso más simple para leer a ojo: Y en [10,20] (todo positivo) tiene
    // que salir como Z en [-20,-10]*S (todo negativo). Si el signo se
    // perdiera, saldría [10,20]*S en cambio.
    const S = METROS_POR_UNIDAD
    const { min, max } = bboxSourceAThreeMetros([1, 10, 5], [2, 20, 6])
    expect(min[2]).toBeCloseTo(-20 * S, 10)
    expect(max[2]).toBeCloseTo(-10 * S, 10)
  })
})

describe('yawSourceAThree', () => {
  /** Dirección de mirada que produce un yaw del motor (`camera.rotation.y`
   *  con orden YXZ): la cámara mira a -Z y el ángulo rota sobre Y. */
  function adelante(yaw: number): [number, number] {
    return [-Math.sin(yaw), -Math.cos(yaw)]
  }

  it('yaw 0 de Source (mirando a +X) mira a +X en three', () => {
    const [x, z] = adelante(yawSourceAThree(0))
    expect(x).toBeCloseTo(1)
    expect(z).toBeCloseTo(0)
  })

  it('yaw 180 de Source mira a -X en three', () => {
    // Son las dos direcciones reales de nuketown: los 16 spawns de un bando
    // a 0 grados y los 16 del otro a 180, enfrentados a lo largo del eje X.
    const [x, z] = adelante(yawSourceAThree(180))
    expect(x).toBeCloseTo(-1)
    expect(z).toBeCloseTo(0)
  })

  it('yaw 90 de Source (mirando a +Y de Source) mira a -Z en three', () => {
    // +Y de Source es -Z de three (ver ejesSourceAThree). Éste y el de 270
    // son los casos que distinguen un signo dado vuelta de una conversión
    // correcta: con los de 0 y 180 solos, las dos fórmulas coinciden.
    const [x, z] = adelante(yawSourceAThree(90))
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(-1)
  })

  it('yaw 270 de Source mira a +Z en three', () => {
    const [x, z] = adelante(yawSourceAThree(270))
    expect(x).toBeCloseTo(0)
    expect(z).toBeCloseTo(1)
  })
})

/**
 * `rotacionPropSourceAThree` se verifica por su PROPIEDAD DEFINITORIA y no
 * comparando contra números escritos a mano: si la rotación del prop es
 * correcta, rotar un vector en el mundo de Source y después cambiarlo de
 * ejes tiene que dar lo mismo que cambiarlo de ejes y después aplicarle el
 * cuaternión. O sea:
 *
 *     M(R_source · v)  ==  q_three · (M v)
 *
 * Los dos lados se calculan por caminos distintos (uno con la matriz de
 * Source y `ejesSourceAThree`, el otro con el cuaternión que devuelve la
 * función), así que un error en la conjugación no se cancela solo.
 *
 * Los ángulos de prueba incluyen valores que NO son múltiplos de 90: con
 * 0/90/180 -- que es casi todo lo que usa nuketown -- la versión
 * equivocada (rotar las columnas en vez de conjugar) da el mismo resultado
 * que la correcta y el test no vería nada.
 */
describe('rotacionPropSourceAThree', () => {
  /** Matriz de Source (la misma convención que documenta la función). */
  function matrizSource(pitch: number, yaw: number, roll: number): number[][] {
    const r = Math.PI / 180
    const sp = Math.sin(pitch * r)
    const cp = Math.cos(pitch * r)
    const sy = Math.sin(yaw * r)
    const cy = Math.cos(yaw * r)
    const sr = Math.sin(roll * r)
    const cr = Math.cos(roll * r)
    return [
      [cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy],
      [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy],
      [-sp, sr * cp, cr * cp],
    ]
  }

  function aplicarQuat(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
    const [x, y, z, w] = q
    // v' = v + 2w(q x v) + 2(q x (q x v))
    const cx = y * v[2] - z * v[1]
    const cy = z * v[0] - x * v[2]
    const cz = x * v[1] - y * v[0]
    const ccx = y * cz - z * cy
    const ccy = z * cx - x * cz
    const ccz = x * cy - y * cx
    return [v[0] + 2 * (w * cx + ccx), v[1] + 2 * (w * cy + ccy), v[2] + 2 * (w * cz + ccz)]
  }

  const casos: Array<[number, number, number]> = [
    [0, 0, 0],
    [0, 90, 0],
    [0, 180, 0],
    [0, -90, 0],
    // Los que de verdad discriminan: ángulos oblicuos y los tres ejes a la vez.
    [0, 37, 0],
    [23, 0, 0],
    [0, 0, 41],
    [17, 53, 29],
    [-12, 155, -74],
  ]

  // Vectores con las tres componentes distintas y de signo mixto, por el
  // mismo motivo que el resto de este archivo.
  const vectores: Array<[number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
    [2, -3, 5],
    [-7, 11, -1],
  ]

  for (const [pitch, yaw, roll] of casos) {
    it(`conmuta con el cambio de ejes en (pitch=${pitch}, yaw=${yaw}, roll=${roll})`, () => {
      const q = rotacionPropSourceAThree(pitch, yaw, roll)
      const R = matrizSource(pitch, yaw, roll)

      for (const v of vectores) {
        // Camino A: rotar en Source, después cambiar de ejes.
        const rv: [number, number, number] = [
          R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
          R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
          R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
        ]
        const a = ejesSourceAThree(rv)

        // Camino B: cambiar de ejes, después aplicar el cuaternión.
        const b = aplicarQuat(q, ejesSourceAThree(v))

        for (let i = 0; i < 3; i++) expect(b[i]).toBeCloseTo(a[i], 9)
      }
    })
  }

  it('con angles en cero devuelve la identidad (un prop sin rotar NO se toca)', () => {
    const [x, y, z, w] = rotacionPropSourceAThree(0, 0, 0)
    expect(x).toBeCloseTo(0, 12)
    expect(y).toBeCloseTo(0, 12)
    expect(z).toBeCloseTo(0, 12)
    expect(Math.abs(w)).toBeCloseTo(1, 12)
  })

  it('devuelve un cuaternión unitario', () => {
    for (const [p, y, r] of casos) {
      const q = rotacionPropSourceAThree(p, y, r)
      expect(Math.hypot(q[0], q[1], q[2], q[3])).toBeCloseTo(1, 10)
    }
  })

  it('el yaw de un prop gira sobre el eje Y del motor, sin el cuarto de vuelta de la cámara', () => {
    // yaw=90 en Source lleva el "adelante" (+X) a +Y de Source, que en
    // three es -Z. Si alguien reusara yawSourceAThree acá, el prop saldría
    // 90° corrido.
    const q = rotacionPropSourceAThree(0, 90, 0)
    const adelante = aplicarQuat(q, [1, 0, 0])
    expect(adelante[0]).toBeCloseTo(0, 9)
    expect(adelante[1]).toBeCloseTo(0, 9)
    expect(adelante[2]).toBeCloseTo(-1, 9)
  })
})
