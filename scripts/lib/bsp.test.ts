import { describe, expect, it } from 'vitest'

import {
  METROS_POR_UNIDAD,
  bboxSourceAThreeMetros,
  ejesSourceAThree,
  planoSourceAThreeMetros,
  puntoSourceAThreeMetros,
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
