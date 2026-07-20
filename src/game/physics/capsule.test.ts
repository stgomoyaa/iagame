import { describe, expect, it } from 'vitest'
import { PLAYER_CAPSULE, resolveMove } from '@/game/physics/capsule'
import type { Capsule, MoveResult } from '@/game/physics/capsule'
import { box } from '@/game/map/arena'
import type { Convex } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

const piso = [box(-50, -1, -50, 50, 0, 50)]
const SIN_CONVEXOS: Convex[] = []
const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

/** Empaqueta una lista de planos (nx, ny, nz, d) en el Float32Array que espera Convex. */
function planosDe(...planos: [number, number, number, number][]): Float32Array {
  const out = new Float32Array(planos.length * 4)
  planos.forEach(([nx, ny, nz, d], i) => {
    out[i * 4] = nx
    out[i * 4 + 1] = ny
    out[i * 4 + 2] = nz
    out[i * 4 + 3] = d
  })
  return out
}

/**
 * El mismo cuerpo que `box(...)`, pero como intersección de 6 semiespacios
 * en vez de min/max. Sirve para probar que la ruta de planos y la ruta de
 * AABB resuelven la misma física contra la misma geometría.
 */
function cuboConvexo(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Convex {
  return {
    planes: planosDe(
      [-1, 0, 0, -minX],
      [1, 0, 0, maxX],
      [0, -1, 0, -minY],
      [0, 1, 0, maxY],
      [0, 0, -1, -minZ],
      [0, 0, 1, maxZ],
    ),
    count: 6,
    min: vec3(minX, minY, minZ),
    max: vec3(maxX, maxY, maxZ),
  }
}

/**
 * Cuña que sube en +X desde `(baseX, 0)` hasta `(baseX + alturaRampa /
 * tan(angulo), alturaRampa)`, acotada en Z entre `zMin` y `zMax`. Cinco
 * planos: la cara inclinada, el piso de la cuña, la cara trasera vertical
 * que la cierra arriba, y dos tapas en Z -- un brush convexo cerrado de
 * verdad, no un semiespacio infinito suelto.
 */
function cunia(
  baseX: number,
  alturaRampa: number,
  angulo: number,
  zMin: number,
  zMax: number,
): Convex {
  const run = alturaRampa / Math.tan(angulo)
  const topeX = baseX + run
  const nx = -Math.sin(angulo)
  const ny = Math.cos(angulo)
  const d = nx * baseX // la cara inclinada pasa por (baseX, 0, *)
  return {
    planes: planosDe(
      [nx, ny, 0, d],
      [0, -1, 0, 0],
      [1, 0, 0, topeX],
      [0, 0, -1, -zMin],
      [0, 0, 1, zMax],
    ),
    count: 5,
    min: vec3(baseX, 0, zMin),
    max: vec3(topeX, alturaRampa, zMax),
  }
}

describe('colisión de cápsula', () => {
  it('el movimiento libre en el aire no altera el delta', () => {
    const pos = vec3(0, 10, 0)
    resolveMove(pos, vec3(1, 0, 2), PLAYER_CAPSULE, piso, SIN_CONVEXOS, result)
    expect(pos.x).toBeCloseTo(1, 6)
    expect(pos.y).toBeCloseTo(10, 6)
    expect(pos.z).toBeCloseTo(2, 6)
    expect(result.hitGround).toBe(false)
  })

  it('caer sobre el piso lo detecta y deja los pies en la superficie', () => {
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -10, 0), PLAYER_CAPSULE, piso, SIN_CONVEXOS, result)
    expect(pos.y).toBeCloseTo(0, 4)
    expect(result.hitGround).toBe(true)
  })

  it('caminar contra una pared frena el eje bloqueado y deja libre el otro', () => {
    const pared = [...piso, box(2, 0, -10, 3, 4, 10)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(5, 0, 1), PLAYER_CAPSULE, pared, SIN_CONVEXOS, result)
    expect(pos.x).toBeLessThan(2)
    expect(pos.z).toBeCloseTo(1, 4)
    expect(result.hitWall).toBe(true)
  })

  it('a alta velocidad no atraviesa una pared delgada (sin tunneling)', () => {
    // La pared mide 0.2m de grosor y arranca en x=2. Con radio 0.4 el punto
    // de contacto real está en x=1.6; el capsule.test.ts original arrancaba
    // en x=0 con un delta de sólo 0.3125 -- nunca se acercaba ni remotamente
    // a la pared, así que "pos.x < 2" daba true incluso con la colisión de
    // cajas completamente desactivada (verificado a mano: comentar la
    // llamada a overlapAndResolve no hace fallar este test tal como estaba).
    // Acá el punto de partida (1.59) se elige a propósito para que, sin
    // colisión, el salto completo de un solo substep hipotético terminaría
    // pasado el otro lado de la pared (1.59 + 0.625 = 2.215 > 2.2): si el
    // motor no la detiene a medio camino, la atraviesa de verdad.
    const pared = [...piso, box(2, 0, -10, 2.2, 4, 10)]
    const pos = vec3(1.59, 0, 0)
    // 80 m/s en un tick de 128Hz: mucho más rápido que el tope de bhop (14.4)
    resolveMove(pos, vec3(80 / 128, 0, 0), PLAYER_CAPSULE, pared, SIN_CONVEXOS, result)
    expect(pos.x).toBeLessThan(2)
  })

  it('golpear un techo lo detecta', () => {
    const techo = [...piso, box(-5, 3, -5, 5, 4, 5)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(0, 5, 0), PLAYER_CAPSULE, techo, SIN_CONVEXOS, result)
    expect(result.hitCeiling).toBe(true)
    expect(pos.y).toBeLessThan(3)
  })

  it('quedarse quieto sobre el piso no lo hunde ni lo expulsa', () => {
    const pos = vec3(0, 0, 0)
    for (let i = 0; i < 100; i++) {
      resolveMove(pos, vec3(0, 0, 0), PLAYER_CAPSULE, piso, SIN_CONVEXOS, result)
    }
    expect(pos.y).toBeCloseTo(0, 4)
  })

  it('gravedad real integrada tick a tick lo mantiene apoyado sin hundirse ni flotar', () => {
    // A diferencia del test anterior (delta cero desde penetración cero, que
    // nunca dispara la rama de corrección), acá se integra gravedad real
    // cada tick como lo hará el sistema de movimiento, para ejercitar de
    // verdad el contacto en reposo del que depende todo el diseño de "sin
    // ground probe".
    const pos = vec3(0, 0, 0)
    const gravedad = 22
    const tick = 1 / 128
    const deltaY = -gravedad * tick * tick
    const iteraciones = 5000
    let contactos = 0
    for (let i = 0; i < iteraciones; i++) {
      resolveMove(pos, vec3(0, deltaY, 0), PLAYER_CAPSULE, piso, SIN_CONVEXOS, result)
      expect(Math.abs(pos.y)).toBeLessThan(1e-6)
      if (result.hitGround) contactos++
    }
    expect(contactos).toBe(iteraciones)
  })

  it('deslizarse por una esquina interior no lo traba', () => {
    const esquina = [...piso, box(2, 0, -10, 3, 4, 0), box(-10, 0, -1, 3, 4, 0)]
    const pos = vec3(0, 0, -3)
    const zAntes = pos.z
    resolveMove(pos, vec3(1, 0, 1), PLAYER_CAPSULE, esquina, SIN_CONVEXOS, result)
    expect(pos.z).toBeGreaterThan(zAntes - 0.01)
    expect(Number.isNaN(pos.x)).toBe(false)
  })

  it('es determinista: la misma entrada da la misma salida', () => {
    const a = vec3(0, 3, 0)
    const b = vec3(0, 3, 0)
    const pared = [...piso, box(1, 0, -5, 2, 4, 5)]
    for (let i = 0; i < 20; i++) {
      resolveMove(a, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, SIN_CONVEXOS, result)
      resolveMove(b, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, SIN_CONVEXOS, result)
    }
    expect(a).toEqual(b)
  })

  it('un delta no finito no corrompe la posición ni deja flags obsoletas', () => {
    const pos = vec3(0, 5, 0)
    const out: MoveResult = { hitGround: true, hitCeiling: true, hitWall: true }
    resolveMove(pos, vec3(NaN, 0, 0), PLAYER_CAPSULE, piso, SIN_CONVEXOS, out)
    expect(pos.x).toBe(0)
    expect(pos.y).toBe(5)
    expect(pos.z).toBe(0)
    expect(out.hitGround).toBe(false)
    expect(out.hitCeiling).toBe(false)
    expect(out.hitWall).toBe(false)
  })

  it('una cápsula de radio cero no cuelga el loop de substeps', () => {
    const capsuleDegenerada: Capsule = { radius: 0, height: 1.8 }
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -1, 0), capsuleDegenerada, piso, SIN_CONVEXOS, result)
    expect(Number.isFinite(pos.y)).toBe(true)
  }, 1000)
})

describe('colisión de cápsula contra convexos', () => {
  it('subir una rampa de 30°: termina más arriba de donde arrancó (imposible con sólo cajas)', () => {
    const angulo = Math.PI / 6 // 30°
    const rampa = cunia(2, 2, angulo, -5, 5)
    const pos = vec3(1.5, 0, 0)
    const y0 = pos.y
    // Empujada de lleno contra la rampa: si el motor sólo supiera resolver
    // contra AABBs, esto se trabaría contra un "escalón" de 2m invisible en
    // vez de resbalar hacia arriba por la cara inclinada.
    resolveMove(pos, vec3(3, 0, 0), PLAYER_CAPSULE, [], [rampa], result)
    expect(pos.y).toBeGreaterThan(y0 + 0.5)
    // Y no quedó pegada al pie de la rampa: avanzó de verdad más allá.
    expect(pos.x).toBeGreaterThan(2)
  })

  it('a alta velocidad no atraviesa un muro convexo delgado (sin tunneling)', () => {
    // Mismo razonamiento que el equivalente con Box de arriba: el punto de
    // partida se elige para que, sin colisión, el salto completo terminaría
    // ya pasado el otro lado del muro.
    const muro = cuboConvexo(2, 0, -10, 2.2, 4, 10)
    const pos = vec3(1.59, 0, 0)
    resolveMove(pos, vec3(80 / 128, 0, 0), PLAYER_CAPSULE, [], [muro], result)
    expect(pos.x).toBeLessThan(2)
  })

  it('el plano separador corta temprano: lejos de un convexo no hay contacto ni movimiento propio', () => {
    // El punto de sondeo cae DENTRO de la caja envolvente de la cuña (así
    // que el descarte rápido por AABB no alcanza para probar nada) pero por
    // encima de la cara inclinada -- fuera del sólido real. Si el chequeo
    // por plano no cortara temprano acá, algo lo estaría empujando aunque
    // no haya cuerpo debajo.
    const angulo = Math.PI / 6
    const rampa = cunia(2, 2, angulo, -5, 5)
    const pos = vec3(4, 1.9, 0) // altura de la rampa en x=4 es (4-2)*tan(30°) ≈ 1.15
    const out: MoveResult = { hitGround: true, hitCeiling: true, hitWall: true }
    resolveMove(pos, vec3(0.1, 0, 0), PLAYER_CAPSULE, [], [rampa], out)
    expect(pos.x).toBeCloseTo(4.1, 6)
    expect(pos.y).toBeCloseTo(1.9, 6)
    expect(out.hitGround).toBe(false)
    expect(out.hitCeiling).toBe(false)
    expect(out.hitWall).toBe(false)
  })

  it('un cubo como Convex resuelve igual que el mismo cubo como Box', () => {
    const cuboBox = box(1, 0, -5, 2, 4, 5)
    const cuboPlanos = cuboConvexo(1, 0, -5, 2, 4, 5)

    const posBox = vec3(0, 3, 0)
    const posConvex = vec3(0, 3, 0)
    const outBox: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }
    const outConvex: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

    // Misma secuencia contra las dos representaciones: caída, choque de
    // costado y contacto en reposo, para ejercitar varias caras del cubo
    // (piso, techo y pared) y no sólo la primera que se toca.
    const deltas = [
      vec3(0.3, -0.2, 0.1), vec3(0.3, -0.2, 0.1), vec3(0.3, 0, 0.1),
      vec3(0.3, 0, 0.1), vec3(0, 0, 0), vec3(0, 0, 0),
    ]
    for (const d of deltas) {
      resolveMove(posBox, vec3(d.x, d.y, d.z), PLAYER_CAPSULE, [cuboBox], SIN_CONVEXOS, outBox)
      resolveMove(posConvex, vec3(d.x, d.y, d.z), PLAYER_CAPSULE, [], [cuboPlanos], outConvex)
    }

    expect(posConvex.x).toBeCloseTo(posBox.x, 4)
    expect(posConvex.y).toBeCloseTo(posBox.y, 4)
    expect(posConvex.z).toBeCloseTo(posBox.z, 4)
    expect(outConvex.hitGround).toBe(outBox.hitGround)
    expect(outConvex.hitCeiling).toBe(outBox.hitCeiling)
    expect(outConvex.hitWall).toBe(outBox.hitWall)
  })
})
