import { describe, expect, it } from 'vitest'
import { ARENA, box } from '@/game/map/arena'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'
import type { Box } from '@/game/map/types'

/** Límite máximo de altura de mantle (metros) */
const MAX_MANTLE_HEIGHT = 1.2
/** Altura de los muros perimetrales (metros); marcan las superficies inescalables */
const PERIMETER_WALL_HEIGHT = 6
/** Qué tan cerca en planta (XZ) tiene que estar un escalón de apoyo real. */
const XZ_TOLERANCE = PLAYER_CAPSULE.radius

/**
 * Pico de un salto, en metros, derivado de las constantes de tuning (no
 * hardcodeado): parábola continua con v0 = jumpVelocity y g = gravity.
 * El motor real integra a pasos discretos de TICK_HZ (gravedad aplicada
 * el mismo tick que el impulso de salto), lo que da un pico algo más bajo
 * que la fórmula continua (con la tuning actual, ~0.935 real contra ~0.960
 * de la fórmula). La fórmula continua sobreestima el alcance real, así que
 * es una cota conservadora para esta prueba: si con este número más
 * generoso una superficie ya queda fuera de alcance, en el juego real
 * queda todavía más lejos.
 */
function jumpApex(): number {
  return MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity)
}

/**
 * Altura máxima de un borde mantleable alcanzable de un salto desde una
 * superficie a `surfaceHeight`. Saltando desde ahí los pies suben hasta
 * `surfaceHeight + jumpApex()` antes de empezar a caer, y el mantle agarra
 * cualquier borde hasta `mantleMaxHeight` por encima de los pies en el
 * instante del contacto (ver mantle.ts) — el mejor instante posible es el
 * pico del salto.
 */
function maxLedgeReachFrom(surfaceHeight: number): number {
  return surfaceHeight + jumpApex() + MOVEMENT.mantleMaxHeight
}

/**
 * Distancia horizontal máxima cubierta durante un salto completo (despegue
 * a aterrizaje a la misma altura), derivada de las mismas constantes de
 * tuning: tiempo de vuelo `2 * jumpVelocity / gravity` a la velocidad
 * horizontal máxima de desplazamiento (sprint).
 */
function maxJumpHorizontalDistance(): number {
  const tiempoDeVuelo = (2 * MOVEMENT.jumpVelocity) / MOVEMENT.gravity
  return MOVEMENT.sprintSpeed * tiempoDeVuelo
}

/** Distancia horizontal mínima en planta (XZ) entre dos cajas (0 si se solapan). */
function horizontalGapXZ(a: Box, b: Box): number {
  const dx = Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x)
  const dz = Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z)
  return Math.hypot(dx, dz)
}

/**
 * Muros de cobertura/separación de carriles: por diseño no son plataformas
 * para pararse encima, a diferencia de la estructura central (que arena.ts
 * llama explícitamente "plataforma" y sí tiene escalones de 1.1m a los
 * lados). Los comentarios de arena.ts los describen como "separadores...
 * con huecos para rotar" y "cobertura alta... para romper líneas de vista":
 * paredes que se rodean por planta baja, no algo que se mantlea. No tienen
 * ningún escalón real cerca (se verificó con el mismo algoritmo XZ-aware de
 * abajo) y quedan igual de "inescalables" que los muros perimetrales.
 * Identificados por su huella en XZ, igual que se identifica hoy a los
 * perimetrales por altura: si arena.ts cambia estas cajas, esta lista deja
 * de matchear y el test siguiente los vuelve a exigir alcanzables.
 */
const COBERTURA_NO_ESCALABLE: ReadonlyArray<readonly [number, number, number, number]> = [
  [-10, -22, -9, -10],
  [-10, 10, -9, 22],
  [9, -22, 10, -10],
  [9, 10, 10, 22],
  [-4, -26, 4, -24],
  [-4, 24, 4, 26],
]

function esCoberturaNoEscalable(b: Box): boolean {
  return COBERTURA_NO_ESCALABLE.some(
    ([minX, minZ, maxX, maxZ]) =>
      b.min.x === minX && b.min.z === minZ && b.max.x === maxX && b.max.z === maxZ,
  )
}

/** Overlap en planta (XZ) entre dos cajas, con margen de tolerancia. */
function overlapsXZ(a: Box, b: Box, tolerance: number): boolean {
  return (
    a.max.x + tolerance > b.min.x &&
    a.min.x - tolerance < b.max.x &&
    a.max.z + tolerance > b.min.z &&
    a.min.z - tolerance < b.max.z
  )
}

describe('arena', () => {
  it('box construye min y max ordenados', () => {
    const b = box(0, 0, 0, 2, 3, 4)
    expect(b.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(b.max).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('toda caja tiene min estrictamente menor que max en los tres ejes', () => {
    for (const b of ARENA.boxes) {
      expect(b.max.x).toBeGreaterThan(b.min.x)
      expect(b.max.y).toBeGreaterThan(b.min.y)
      expect(b.max.z).toBeGreaterThan(b.min.z)
    }
  })

  it('tiene al menos 8 spawns', () => {
    expect(ARENA.spawns.length).toBeGreaterThanOrEqual(8)
  })

  it('todos los spawns caen dentro de los límites del mapa', () => {
    for (const s of ARENA.spawns) {
      expect(s.x).toBeGreaterThan(ARENA.bounds.min.x)
      expect(s.x).toBeLessThan(ARENA.bounds.max.x)
      expect(s.z).toBeGreaterThan(ARENA.bounds.min.z)
      expect(s.z).toBeLessThan(ARENA.bounds.max.z)
    }
  })

  it('ningún spawn queda dentro de una caja sólida', () => {
    for (const s of ARENA.spawns) {
      for (const b of ARENA.boxes) {
        const dentro =
          s.x > b.min.x && s.x < b.max.x &&
          s.y > b.min.y && s.y < b.max.y &&
          s.z > b.min.z && s.z < b.max.z
        expect(dentro).toBe(false)
      }
    }
  })

  it('el conteo de cajas se mantiene bajo el presupuesto de draw calls', () => {
    expect(ARENA.boxes.length).toBeLessThanOrEqual(200)
  })

  it('toda superficie escalable tiene un escalón de apoyo que realmente está debajo, en XZ', () => {
    // Antes esto sólo miraba el conjunto global de alturas: cualquier caja
    // de 1.1m en cualquier parte del mapa "probaba" que una de 2.2m en la
    // otra punta era alcanzable. Pasaría igual con los escalones movidos a
    // la esquina opuesta del mapa respecto de la plataforma que sirven. Acá
    // el escalón de apoyo tiene que solaparse en planta (XZ) con la caja
    // que sube, con margen de un radio de cápsula.

    const escalables = ARENA.boxes.filter(
      (b) => b.max.y > 0 && b.max.y !== PERIMETER_WALL_HEIGHT && !esCoberturaNoEscalable(b),
    )

    // BFS: el piso es la base (cualquier caja escalable a <= max mantle
    // height del piso es alcanzable sin apoyo previo). Desde ahí, una caja
    // es alcanzable si algún soporte ya alcanzado está a <= max mantle
    // height de diferencia de altura Y se solapa con ella en XZ.
    const alcanzables = new Set<Box>()
    let cambio = true
    while (cambio) {
      cambio = false
      for (const b of escalables) {
        if (alcanzables.has(b)) continue

        const desdeElPiso = b.max.y <= MAX_MANTLE_HEIGHT
        const conApoyo = [...alcanzables].some(
          (soporte) =>
            Math.abs(b.max.y - soporte.max.y) <= MAX_MANTLE_HEIGHT &&
            overlapsXZ(b, soporte, XZ_TOLERANCE),
        )

        if (desdeElPiso || conApoyo) {
          alcanzables.add(b)
          cambio = true
        }
      }
    }

    for (const b of escalables) {
      if (!alcanzables.has(b)) {
        throw new Error(
          `Caja en [${b.min.x}, ${b.min.y}, ${b.min.z}] a [${b.max.x}, ${b.max.y}, ${b.max.z}] no tiene un escalón de apoyo real (solapado en XZ) dentro de max mantle height`,
        )
      }
      expect(alcanzables.has(b)).toBe(true)
    }
  })

  it('ninguna cobertura alta queda parable al alcance de un salto encadenado con mantle', () => {
    // Mirror del test anterior: ahí probamos que todo lo escalable ES
    // alcanzable; acá probamos que la cobertura alta marcada como "bloquea
    // línea de vista de pie" (COBERTURA_NO_ESCALABLE, misma lista) NO lo es,
    // ni siquiera encadenando una caja mantleable de 1m como escalón previo.
    // Ese encadenamiento es justo el exploit real: una caja suelta de 1m
    // (cobertura baja, pensada para encadenar movimiento) puesta cerca de un
    // separador de 2.2m convierte a este último en una escalera de dos
    // pasos. Por eso el chequeo necesita dos componentes, no sólo altura:
    // un salto real también tiene que poder cubrir la distancia horizontal
    // hasta el borde.
    const maxHorizontal = maxJumpHorizontalDistance()

    const candidatas = ARENA.boxes.filter(
      (b) => b.max.y > 0 && b.max.y !== PERIMETER_WALL_HEIGHT,
    )

    // Mismo BFS que arriba, pero la condición de salto entre dos apoyos usa
    // el alcance derivado de jump apex + mantle (no un límite fijo de
    // mantle), y exige además que el hueco horizontal entre las dos cajas
    // entre en el alcance de un salto completo.
    const alcanzables = new Set<Box>()
    let cambio = true
    while (cambio) {
      cambio = false
      for (const b of candidatas) {
        if (alcanzables.has(b)) continue

        const desdeElPiso = b.max.y <= maxLedgeReachFrom(0)
        const conApoyo = [...alcanzables].some(
          (soporte) =>
            b.max.y <= maxLedgeReachFrom(soporte.max.y) &&
            horizontalGapXZ(b, soporte) <= maxHorizontal,
        )

        if (desdeElPiso || conApoyo) {
          alcanzables.add(b)
          cambio = true
        }
      }
    }

    const coberturaAlta = ARENA.boxes.filter(esCoberturaNoEscalable)
    for (const b of coberturaAlta) {
      if (alcanzables.has(b)) {
        throw new Error(
          `Cobertura alta en [${b.min.x}, ${b.min.z}] a [${b.max.x}, ${b.max.z}] queda parable: un salto encadenado (jump apex ${jumpApex().toFixed(4)}m + mantle ${MOVEMENT.mantleMaxHeight}m, alcance horizontal ${maxHorizontal.toFixed(4)}m) la alcanza. Rompe "bloquea línea de vista de pie".`,
        )
      }
      expect(alcanzables.has(b)).toBe(false)
    }
  })
})
