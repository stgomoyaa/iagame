/**
 * Resolución de "a quién le apunta cada bot" cuando hay más de un hostil
 * posible (jugador + otros bots, sección "Build" de la tarea: TDM y FFA
 * necesitan que los bots se disparen entre ellos, no sólo al jugador).
 *
 * bots/bot.ts nunca se toca: sigue recibiendo un único `BotWorld.targetEye`
 * (un Vec3 compartido) por diseño -- ver su comentario de cabecera. Esta
 * función corre ANTES de cada llamada a `stepBotThink` (ver match/squad.ts)
 * y reescribe ese Vec3 compartido con la posición del enemigo vivo más
 * cercano a ESE bot en particular, así que cada bot "ve" un objetivo
 * distinto en su propio tick de pensamiento aunque el campo sea uno solo.
 * Es matemática pura sobre índices; no sabe nada de FSM ni de percepción --
 * `canSee` (bots/perception.ts) sigue siendo quien decide si ese objetivo
 * es realmente visible.
 */

import type { Vec3 } from '@/game/math/vec3'
import type { MatchMode } from '@/game/match/types'
import { isEnemy } from '@/game/match/types'

/**
 * Posiciones y estado de vida de todos los participantes (0 = jugador, 1..N
 * = bots), indexados por id -- ver match/types.ts. `positions` se muta en
 * el sitio por el llamador cada tick (mismo patrón que BotWorld.targetEye):
 * nunca se reasigna ni se reemplaza el array.
 */
export interface MatchTargets {
  mode: MatchMode
  positions: Vec3[]
  alive: boolean[]
}

export function createMatchTargets(mode: MatchMode, participantCount: number): MatchTargets {
  const positions: Vec3[] = []
  const alive: boolean[] = []
  for (let i = 0; i < participantCount; i++) {
    positions.push({ x: 0, y: 0, z: 0 })
    alive.push(true)
  }
  return { mode, positions, alive }
}

/** Sentinela fuera de cualquier rango de visión real (BOTS.visionRangeM es
 *  45m, el hearingRadius 30m): cuando no hay ningún enemigo vivo, `out`
 *  queda escrito acá en vez de con la última posición conocida -- así
 *  `inVisionCone` (bots/perception.ts) descarta la distancia sin que el bot
 *  "vea" un fantasma en la última posición donde efectivamente había uno. */
const FAR_AWAY = 1e6

/**
 * Escribe en `out` la posición del participante vivo más cercano a `selfId`
 * y devuelve su distancia XZ (Infinity si `selfId` está solo en el mapa).
 *
 * A diferencia de `resolveNearestEnemy`, este NO mira equipos ni conos: no
 * pregunta a quién hay que dispararle, pregunta quién está ocupando el mismo
 * pedazo de vereda. Un compañero encima estorba igual que un enemigo encima
 * -- la captura que motivó esta tarea es un bot rojo y tres azules parados en
 * fila, o sea las dos cosas mezcladas.
 *
 * Sólo XZ, igual que el resto de las distancias de bots/: la altura no
 * cambia si dos cuerpos se están pisando.
 *
 * Cero asignaciones: `out` es el mismo Vec3 preasignado del llamador
 * (BotWorld.neighbourPos), y adentro sólo hay escalares.
 */
export function resolveNearestNeighbour(
  targets: MatchTargets,
  selfId: number,
  out: Vec3,
): number {
  const self = targets.positions[selfId]
  let best = Infinity
  let bestIndex = -1

  for (let i = 0; i < targets.positions.length; i++) {
    if (i === selfId || !targets.alive[i]) continue
    const p = targets.positions[i]
    const dx = p.x - self.x
    const dz = p.z - self.z
    const d = Math.sqrt(dx * dx + dz * dz)
    if (d < best) {
      best = d
      bestIndex = i
    }
  }

  if (bestIndex < 0) {
    out.x = FAR_AWAY
    out.y = FAR_AWAY
    out.z = FAR_AWAY
    return Infinity
  }

  const p = targets.positions[bestIndex]
  out.x = p.x
  out.y = p.y
  out.z = p.z
  return best
}

/**
 * Escribe en `out` la posición del enemigo vivo más cercano a
 * `targets.positions[selfId]` (excluyendo al propio `selfId` y a cualquier
 * participante del mismo equipo). Devuelve `false` (y deja `out` en el
 * sentinela FAR_AWAY) si no hay ningún enemigo vivo -- puede pasar en TDM
 * si todo el equipo contrario está muerto reapareciendo a la vez. Cero
 * asignaciones: `out` es siempre el mismo Vec3 preasignado por el llamador
 * (BotWorld.targetEye).
 *
 * Los tres últimos parámetros son OPCIONALES y, omitidos, dejan la función
 * exactamente como era (el más cercano y nada más). Con un cono (`facingYaw`
 * + `rangeM` + `halfAngleRad`) prefiere al enemigo más cercano DENTRO del
 * cono, y sólo cae al más cercano global si no hay ninguno adentro.
 *
 * Por qué: `canSee` (bots/perception.ts) mide el cono desde el yaw de
 * apuntado actual, y el apuntado sólo gira hacia un objetivo que el bot ya
 * "ve". Asignar siempre al más cercano cierra ese lazo en falso -- un
 * enemigo pegado pero fuera del cono no se ve nunca, así que el bot no entra
 * a Enfrentar, así que no gira, así que sigue sin verlo. Medido en 6 min de
 * nuketown: en el 23% de las muestras de bot vivo el enemigo asignado caía
 * fuera del cono, y en 5191 de esas muestras había OTRO enemigo dentro del
 * cono al que estaba ignorando. Eso es la captura: dos enemigos a dos
 * metros, cada uno mirando para otro lado.
 *
 * Sólo el cono, sin raycast de oclusión: es el filtro barato que arregla el
 * caso medido sin agregar un solo rayo al presupuesto por tick. Si el
 * elegido resulta estar detrás de una pared, `canSee` lo descarta igual que
 * antes y el bot no entra a Enfrentar ese tick. La caída al más cercano es
 * lo que mantiene vivos a Rotar y Reposicionar (perseguir a quien ya no se
 * ve).
 */
export function resolveNearestEnemy(
  targets: MatchTargets,
  selfId: number,
  out: Vec3,
  facingYaw: number | null = null,
  rangeM = Infinity,
  halfAngleRad = Math.PI,
): boolean {
  const selfPos = targets.positions[selfId]
  let bestDist = Infinity
  let bestIndex = -1
  let bestConeDist = Infinity
  let bestConeIndex = -1

  // yaw 0 mira hacia -Z (misma convención que movement/step.ts y que
  // bots/perception.ts inVisionCone).
  const usaCono = facingYaw !== null
  const forwardX = usaCono ? -Math.sin(facingYaw) : 0
  const forwardZ = usaCono ? -Math.cos(facingYaw) : 0
  const cosHalf = Math.cos(halfAngleRad)

  for (let i = 0; i < targets.positions.length; i++) {
    if (i === selfId) continue
    if (!targets.alive[i]) continue
    if (!isEnemy(targets.mode, selfId, i)) continue

    const p = targets.positions[i]
    const d = Math.hypot(p.x - selfPos.x, p.y - selfPos.y, p.z - selfPos.z)
    if (d < bestDist) {
      bestDist = d
      bestIndex = i
    }

    if (!usaCono || d > rangeM || d >= bestConeDist) continue
    // Cono en XZ, igual que inVisionCone: la componente vertical no entra en
    // el campo visual horizontal.
    const dx = p.x - selfPos.x
    const dz = p.z - selfPos.z
    const distXZ = Math.sqrt(dx * dx + dz * dz)
    const dentro = distXZ < 1e-6 || (dx / distXZ) * forwardX + (dz / distXZ) * forwardZ >= cosHalf
    if (dentro) {
      bestConeDist = d
      bestConeIndex = i
    }
  }

  if (bestConeIndex >= 0) bestIndex = bestConeIndex

  if (bestIndex < 0) {
    out.x = FAR_AWAY
    out.y = FAR_AWAY
    out.z = FAR_AWAY
    return false
  }

  const p = targets.positions[bestIndex]
  out.x = p.x
  out.y = p.y
  out.z = p.z
  return true
}
