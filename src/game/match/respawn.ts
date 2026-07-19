/**
 * Selección de punto de spawn y ventana de invulnerabilidad post-respawn.
 * Matemática pura sobre Vec3 -- game.ts es quien decide CUÁNDO llamar a
 * esto (participante recién muerto, a punto de reaparecer) y quién aplica
 * el resultado (teletransportar, gatear el daño entrante).
 */

import type { Vec3 } from '@/game/math/vec3'

/**
 * Elige, de `spawns`, el índice cuya distancia MÍNIMA a cualquier enemigo
 * vivo en `enemyPositions` es la más grande posible (maximin, no "más lejos
 * del centroide"): un spawn que en promedio está lejos pero pegado a UN
 * enemigo sigue siendo una reaparición en la mira de alguien, que es
 * exactamente lo que hay que evitar (spec de la tarea: "spawnear en la mira
 * de alguien es la forma más rápida de que una partida se sienta barata").
 * Sólo distancia horizontal (XZ): los 8 spawns de la arena están todos a la
 * misma altura (map/arena.ts), así que Y no aporta señal y sólo complicaría
 * la comparación.
 *
 * Sin enemigos vivos, cualquier spawn es igual de seguro -- devuelve el
 * primero, determinista (no hay ninguna señal para preferir otro).
 *
 * Cero asignaciones: sólo escalares, ningún array ni objeto nuevo.
 * `enemyCount` (por defecto `enemyPositions.length`) deja usar un buffer de
 * `enemyPositions` preasignado más grande de lo que hace falta en una
 * llamada dada -- game.ts lo llama potencialmente una vez por tick por cada
 * participante muerto (mientras elige dónde reaparecer), así que necesita
 * poder pasar el mismo array scratch siempre y decirle cuántas entradas de
 * ese array son válidas esta vez, sin reconstruirlo.
 */
export function pickFarthestSpawn(
  spawns: readonly Vec3[],
  enemyPositions: readonly Vec3[],
  enemyCount: number = enemyPositions.length,
): number {
  let bestIndex = 0
  let bestMinDist = -Infinity

  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i]
    let minDist = Infinity
    for (let j = 0; j < enemyCount; j++) {
      const enemy = enemyPositions[j]
      const d = Math.hypot(spawn.x - enemy.x, spawn.z - enemy.z)
      if (d < minDist) minDist = d
    }
    if (minDist > bestMinDist) {
      bestMinDist = minDist
      bestIndex = i
    }
  }

  return bestIndex
}

/** ¿Un participante reaparecido en `invulnerableUntilS` (reloj de partida,
 *  segundos) sigue invulnerable en `matchClockS`? Estrictamente menor: en el
 *  instante exacto en que expira, ya puede recibir daño otra vez. */
export function isInvulnerable(invulnerableUntilS: number, matchClockS: number): boolean {
  return matchClockS < invulnerableUntilS
}

/** Reloj de partida en el que expira la invulnerabilidad concedida ahora
 *  (`matchClockS`) por `durationS` segundos. */
export function invulnerabilityExpiresAt(matchClockS: number, durationS: number): number {
  return matchClockS + Math.max(0, durationS)
}
