/**
 * Invariantes de diseño que TODO mapa tiene que cumplir, como matemática
 * pura sobre sus cajas -- no como una lista de asserts copiada en el test de
 * cada mapa.
 *
 * Existe porque los dos chequeos que importan nacieron de bugs reales en la
 * arena (ver map/arena.test.ts, que sigue siendo el test de detalle de ese
 * mapa):
 *
 * 1. Una plataforma central a la que no se llegaba: el chequeo viejo miraba
 *    el conjunto global de alturas, así que una caja de 1.1m en cualquier
 *    rincón "probaba" que una de 2.2m en la punta opuesta era alcanzable.
 *    Acá el escalón de apoyo tiene que solaparse en planta (XZ) con la caja
 *    que sube.
 * 2. Una escalera de dos pasos hasta arriba de una cobertura que existía
 *    para bloquear la vista: caja suelta de 1m + salto con mantle. Por eso
 *    el segundo chequeo mide alcance real (pico del salto + mantle) Y
 *    distancia horizontal, no sólo diferencia de altura.
 *
 * Los dos alcances salen de MOVEMENT (jumpVelocity/gravity/mantleMaxHeight),
 * nunca de un número escrito a mano: si mañana se sube el salto, los mapas
 * que quedaran mal se enteran solos.
 */

import type { Box, MapDef } from '@/game/map/types'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'

/** Qué tan cerca en planta (XZ) tiene que estar un escalón de apoyo real. */
const XZ_TOLERANCE = PLAYER_CAPSULE.radius

/**
 * Pico de un salto, en metros, derivado de las constantes de tuning:
 * parábola continua con v0 = jumpVelocity y g = gravity. El motor real
 * integra a pasos discretos y llega algo más bajo, así que esta fórmula
 * sobreestima: es una cota conservadora (si algo ya queda fuera de alcance
 * con este número generoso, en el juego real queda más lejos todavía).
 */
export function jumpApex(): number {
  return MOVEMENT.jumpVelocity ** 2 / (2 * MOVEMENT.gravity)
}

/**
 * Altura máxima de un borde mantleable alcanzable de un salto desde una
 * superficie a `surfaceHeight`: los pies suben hasta el pico y el mantle
 * agarra cualquier borde hasta mantleMaxHeight por encima de los pies.
 */
export function maxLedgeReachFrom(surfaceHeight: number): number {
  return surfaceHeight + jumpApex() + MOVEMENT.mantleMaxHeight
}

/**
 * Distancia horizontal máxima cubierta durante un salto completo (despegue
 * y aterrizaje a la misma altura) a velocidad de sprint.
 */
export function maxJumpHorizontalDistance(): number {
  const tiempoDeVuelo = (2 * MOVEMENT.jumpVelocity) / MOVEMENT.gravity
  return MOVEMENT.sprintSpeed * tiempoDeVuelo
}

/** Distancia horizontal mínima en planta (XZ) entre dos cajas (0 si se solapan). */
export function horizontalGapXZ(a: Box, b: Box): number {
  const dx = Math.max(0, b.min.x - a.max.x, a.min.x - b.max.x)
  const dz = Math.max(0, b.min.z - a.max.z, a.min.z - b.max.z)
  return Math.hypot(dx, dz)
}

/** Overlap en planta (XZ) entre dos cajas, con margen de tolerancia. */
export function overlapsXZ(a: Box, b: Box, tolerance: number): boolean {
  return (
    a.max.x + tolerance > b.min.x &&
    a.min.x - tolerance < b.max.x &&
    a.max.z + tolerance > b.min.z &&
    a.min.z - tolerance < b.max.z
  )
}

function esMuro(map: MapDef, b: Box): boolean {
  return map.wallHeight !== undefined && b.max.y === map.wallHeight
}

function esBlockingCover(map: MapDef, b: Box): boolean {
  return map.blockingCover !== undefined && map.blockingCover.includes(b)
}

/**
 * Cajas que el mapa promete como PLATAFORMA: todo lo que sobresale del
 * suelo y no es muro ni cobertura declarada como bloqueante. Cada una tiene
 * que ser alcanzable (ver superficiesInalcanzables).
 */
export function plataformas(map: MapDef): Box[] {
  return map.boxes.filter((b) => b.max.y > 0 && !esMuro(map, b) && !esBlockingCover(map, b))
}

/**
 * Cajas que se pueden alcanzar SUBIENDO de a un mantle por vez, exigiendo
 * que el escalón de apoyo esté realmente debajo (solapado en XZ). Punto de
 * partida: el piso. Es el criterio "esta plataforma se sube caminando y
 * mantleando", no "se llega de un salto acrobático" -- ese lo mide
 * alcanzablesConSalto.
 */
function alcanzablesPorMantle(candidatas: Box[]): Set<Box> {
  const alcanzables = new Set<Box>()
  let cambio = true
  while (cambio) {
    cambio = false
    for (const b of candidatas) {
      if (alcanzables.has(b)) continue
      const desdeElPiso = b.max.y <= MOVEMENT.mantleMaxHeight
      let conApoyo = false
      for (const soporte of alcanzables) {
        if (
          Math.abs(b.max.y - soporte.max.y) <= MOVEMENT.mantleMaxHeight &&
          overlapsXZ(b, soporte, XZ_TOLERANCE)
        ) {
          conApoyo = true
          break
        }
      }
      if (desdeElPiso || conApoyo) {
        alcanzables.add(b)
        cambio = true
      }
    }
  }
  return alcanzables
}

/**
 * Plataformas del mapa a las que NO se llega por ninguna cadena de mantles
 * desde el piso. Lista vacía = el mapa cumple la invariante.
 */
export function superficiesInalcanzables(map: MapDef): Box[] {
  const candidatas = plataformas(map)
  const alcanzables = alcanzablesPorMantle(candidatas)
  return candidatas.filter((b) => !alcanzables.has(b))
}

/**
 * Cajas alcanzables encadenando SALTOS (pico + mantle) además de mantles
 * simples, exigiendo que el hueco horizontal entre apoyo y destino entre en
 * un salto completo. Incluye la cobertura bloqueante como posible escalón:
 * el exploit real que esto persigue es justo encadenar por encima de ella.
 */
function alcanzablesConSalto(map: MapDef): Set<Box> {
  const maxHorizontal = maxJumpHorizontalDistance()
  const candidatas = map.boxes.filter((b) => b.max.y > 0 && !esMuro(map, b))

  const alcanzables = new Set<Box>()
  let cambio = true
  while (cambio) {
    cambio = false
    for (const b of candidatas) {
      if (alcanzables.has(b)) continue
      const desdeElPiso = b.max.y <= maxLedgeReachFrom(0)
      let conApoyo = false
      for (const soporte of alcanzables) {
        if (
          b.max.y <= maxLedgeReachFrom(soporte.max.y) &&
          horizontalGapXZ(b, soporte) <= maxHorizontal
        ) {
          conApoyo = true
          break
        }
      }
      if (desdeElPiso || conApoyo) {
        alcanzables.add(b)
        cambio = true
      }
    }
  }
  return alcanzables
}

/**
 * Cobertura declarada como bloqueante que igual queda PARABLE encadenando
 * saltos. Lista vacía = el mapa cumple la invariante.
 */
export function coberturaParable(map: MapDef): Box[] {
  if (map.blockingCover === undefined || map.blockingCover.length === 0) return []
  const alcanzables = alcanzablesConSalto(map)
  return map.blockingCover.filter((b) => alcanzables.has(b))
}

/**
 * Muros declarados que en realidad SÍ se pueden pisar encadenando saltos.
 * Declarar `wallHeight` saca esas cajas de los dos chequeos de arriba, así
 * que sin esto sería un agujero: bastaría poner toda la geometría difícil a
 * la altura de muro para que ningún mapa fallara nunca.
 */
export function murosEscalables(map: MapDef): Box[] {
  if (map.wallHeight === undefined) return []
  const muros = map.boxes.filter((b) => esMuro(map, b))
  if (muros.length === 0) return []

  const maxHorizontal = maxJumpHorizontalDistance()
  const alcanzables = alcanzablesConSalto(map)
  // Un muro es escalable si algún apoyo alcanzable llega a su tope. Los
  // muros no entran en `alcanzables` (alcanzablesConSalto los excluye a
  // propósito, para que un muro no sirva de escalón de otro muro), así que
  // el chequeo se hace acá contra el conjunto ya cerrado.
  return muros.filter((muro) => {
    if (muro.max.y <= maxLedgeReachFrom(0)) return true
    for (const soporte of alcanzables) {
      if (
        muro.max.y <= maxLedgeReachFrom(soporte.max.y) &&
        horizontalGapXZ(muro, soporte) <= maxHorizontal
      ) {
        return true
      }
    }
    return false
  })
}

/** Spawns que caen dentro de una caja sólida. Lista vacía = mapa sano. */
export function spawnsDentroDeSolido(map: MapDef): number[] {
  const malos: number[] = []
  for (let i = 0; i < map.spawns.length; i++) {
    const s = map.spawns[i]
    for (const b of map.boxes) {
      if (
        s.x > b.min.x && s.x < b.max.x &&
        s.y > b.min.y && s.y < b.max.y &&
        s.z > b.min.z && s.z < b.max.z
      ) {
        malos.push(i)
        break
      }
    }
  }
  return malos
}
