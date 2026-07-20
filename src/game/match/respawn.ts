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

/**
 * Reparte `count` participantes entre `spawns` al ARRANCAR la partida,
 * devolviendo un índice de spawn por participante (el 0 es el jugador).
 *
 * Por qué hace falta algo distinto de "spawns[0] para el jugador y el resto
 * en orden": los mapas de Source traen los spawns agrupados por bando, y
 * dentro de cada grupo están pegados entre sí porque en el juego original
 * cada ronda arranca con todo el equipo saliendo de la misma casa. nuketown
 * son 32 spawns en dos racimos de 16, cada racimo de unos 5 x 12 m, con los
 * dos racimos separados 61 m. Repartirlos en el orden en que vienen mete a
 * los primeros 16 participantes en la misma casa: con 5 bots, cuatro
 * aparecían a 2.44, 3.86, 4.15 y 4.88 m del jugador, o sea a distancia de
 * escopeta antes del primer input. Ese es el "los spawns son raros" que se
 * ve jugando.
 *
 * La regla es la misma que la de reaparecer (maximin, ver
 * `pickFarthestSpawn`), sólo que aplicada de a uno y acumulando: cada
 * participante toma el spawn cuya distancia mínima a los YA colocados es la
 * mayor. Con dos racimos eso alterna de casa en casa, que es exactamente lo
 * que uno haría a mano.
 *
 * El primero va al spawn 0 -- sin nadie colocado todavía no hay ninguna
 * señal para preferir otro, y que sea determinista hace el arranque
 * reproducible. Si hay más participantes que spawns se repite: quedarse sin
 * spawns no puede dejar a nadie sin posición.
 *
 * Asigna al armar la partida (una vez, en createGame), no por frame: acá el
 * array de salida es aceptable.
 */
export function spreadInitialSpawns(spawns: readonly Vec3[], count: number): number[] {
  const out: number[] = []
  if (spawns.length === 0 || count <= 0) return out

  for (let n = 0; n < count; n++) {
    if (out.length >= spawns.length) {
      // Más participantes que spawns: se recicla en el mismo orden ya
      // elegido, que sigue siendo el más repartido que había.
      out.push(out[n % spawns.length])
      continue
    }

    let bestIndex = 0
    let bestMinDist = -Infinity
    for (let i = 0; i < spawns.length; i++) {
      if (out.includes(i)) continue
      const spawn = spawns[i]
      let minDist = Infinity
      for (let j = 0; j < out.length; j++) {
        const otro = spawns[out[j]]
        const d = Math.hypot(spawn.x - otro.x, spawn.z - otro.z)
        if (d < minDist) minDist = d
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist
        bestIndex = i
      }
    }
    out.push(bestIndex)
  }

  return out
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
