/**
 * Selección de punto de spawn y ventana de invulnerabilidad post-respawn.
 * Matemática pura sobre Vec3 -- game.ts es quien decide CUÁNDO llamar a
 * esto (participante recién muerto, a punto de reaparecer) y quién aplica
 * el resultado (teletransportar, gatear el daño entrante).
 */

import type { Vec3 } from '@/game/math/vec3'

/**
 * Cuánto pesa "no salir encima de un compañero" frente a "no salir cerca de
 * un enemigo", y hasta dónde. El término de compañeros se topea en
 * ALLY_SPREAD_CAP_M metros: alcanza de sobra para desempatar entre spawns
 * de seguridad parecida (en nuketown los 16 spawns de una misma casa están
 * a 5-12 m entre sí) y nunca puede convencer a un bot de meterse en la mira
 * de un enemigo con tal de separarse de un aliado.
 *
 * El tope arrancó en 8 m y se bajó a 5 midiendo: con 8, en 6 min de
 * nuketown, la partida caía de 79 a 53 kills -- el término era tan fuerte
 * que mandaba a los bots a spawns peores en vez de sólo desempatar entre
 * spawns equivalentes, que es todo lo que tiene que hacer.
 */
const ALLY_SPREAD_WEIGHT = 1
const ALLY_SPREAD_CAP_M = 5

/**
 * Ventana y castigo del término de recencia. 4 s es del orden de lo que
 * tarda un bot en irse caminando de su punto de aparición, así que castiga
 * exactamente el caso malo -- dos muertes seguidas del mismo bando
 * resolviendo al mismo punto mientras el primero todavía está parado ahí --
 * y deja de castigar cuando el punto ya se despejó.
 *
 * 6 m es mayor que ALLY_SPREAD_CAP_M a propósito: reusar un punto recién
 * usado tiene que perder incluso contra un spawn algo peor, porque el
 * apilamiento se ve y "un poco más cerca de un enemigo" no. Igual que el
 * tope de compañeros, arrancó más alto (14 m) y se bajó midiendo: castigos
 * grandes distorsionan la elección de spawn mucho más de lo que arreglan.
 */
const RECENT_WINDOW_S = 4
const RECENT_PENALTY_M = 6

/**
 * Últimos spawns usados, en un anillo de tamaño fijo. Existe porque
 * `pickFarthestSpawn` es una función pura del estado del mundo y el estado
 * del mundo NO incluye "quién salió de acá hace dos segundos": sin memoria,
 * dos reapariciones separadas en el tiempo pero con el mismo cuadro de
 * enemigos vuelven a elegir el mismo punto.
 *
 * Arrays tipados y `next` circular: se crea una vez por partida y nunca
 * asigna después (mismo contrato de cero asignaciones por frame que el
 * resto del camino caliente).
 */
export interface SpawnHistory {
  indices: Int32Array
  times: Float64Array
  next: number
}

/** `capacity` entradas de historial, todas vacías (índice -1). Conviene que
 *  sea del orden del número de participantes: alcanza para cubrir una
 *  oleada de reapariciones simultáneas sin recorrer de más en el bucle
 *  caliente. */
export function createSpawnHistory(capacity: number): SpawnHistory {
  const indices = new Int32Array(capacity)
  indices.fill(-1)
  return { indices, times: new Float64Array(capacity), next: 0 }
}

/** Anota que `index` se usó en `nowS` (reloj de partida), pisando la entrada
 *  más vieja del anillo. Cero asignaciones. */
export function recordSpawnUse(history: SpawnHistory, index: number, nowS: number): void {
  history.indices[history.next] = index
  history.times[history.next] = nowS
  history.next = (history.next + 1) % history.indices.length
}

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
 *
 * Los tres últimos parámetros son OPCIONALES y, omitidos, dejan la función
 * exactamente como era (maximin puro sobre enemigos). Existen porque ese
 * maximin puro, medido en una partida real de nuketown, reparte 76
 * reapariciones sobre apenas 10 de los 32 spawns: es determinista y sólo
 * mira enemigos, así que todos los compañeros que reaparecen con el mismo
 * cuadro de enemigos resuelven al MISMO argmax y salen apilados (medido:
 * compañeros apareciendo a 0.58 m, racimos de 3-4 bots durante hasta 10 s).
 *
 * - `allyPositions`/`allyCount`: compañeros vivos de quien reaparece, para
 *   no salir encima de ellos (término topeado, ver ALLY_SPREAD_CAP_M).
 * - `history`/`nowS`: qué spawns se usaron hace poco, para no repetir el
 *   mismo punto dos veces seguidas (ver RECENT_WINDOW_S).
 *
 * Sigue sin asignar nada: los dos términos nuevos son escalares sobre
 * buffers que el llamador ya tiene vivos.
 */
export function pickFarthestSpawn(
  spawns: readonly Vec3[],
  enemyPositions: readonly Vec3[],
  enemyCount: number = enemyPositions.length,
  allyPositions: readonly Vec3[] | null = null,
  allyCount = 0,
  history: SpawnHistory | null = null,
  nowS = 0,
): number {
  let bestIndex = 0
  let bestScore = -Infinity

  for (let i = 0; i < spawns.length; i++) {
    const spawn = spawns[i]

    // Término principal, el de siempre: distancia al enemigo vivo más
    // cercano (maximin). Sin enemigos vivos vale 0 y no Infinity -- con
    // Infinity todos los spawns empatarían y los dos términos de abajo no
    // podrían desempatar nada, que es justamente cuando más falta hacen
    // (equipo entero muerto reapareciendo junto).
    let dEnemy = Infinity
    for (let j = 0; j < enemyCount; j++) {
      const enemy = enemyPositions[j]
      const dx = spawn.x - enemy.x
      const dz = spawn.z - enemy.z
      // sqrt y no hypot: hypot protege del overflow a costa de ser ~10x más
      // lento, y acá esto corre 128 veces por segundo por cada participante
      // muerto sobre los 32 spawns de nuketown. Las coordenadas de un mapa
      // no se acercan ni de lejos al rango donde hypot importa.
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d < dEnemy) dEnemy = d
    }
    if (dEnemy === Infinity) dEnemy = 0

    let score = dEnemy

    // Término de compañeros: el maximin de arriba sólo mira ENEMIGOS, así
    // que dos compañeros que reaparecen con el mismo cuadro de enemigos
    // resuelven al mismo argmax y salen uno encima del otro. Medido en
    // nuketown antes de este término: 76 reapariciones repartidas en sólo
    // 10 de los 32 spawns, con compañeros apareciendo a 0.58 m.
    //
    // Va topeado (ALLY_SPREAD_CAP_M) para que sólo desempate entre spawns
    // parecidos en seguridad: alejarse de un compañero nunca puede valer
    // más que meterse en la mira de un enemigo.
    if (allyPositions !== null && allyCount > 0) {
      let dAlly = Infinity
      for (let j = 0; j < allyCount; j++) {
        const ally = allyPositions[j]
        const dx = spawn.x - ally.x
        const dz = spawn.z - ally.z
        const d = Math.sqrt(dx * dx + dz * dz)
        if (d < dAlly) dAlly = d
      }
      if (dAlly !== Infinity) {
        score += ALLY_SPREAD_WEIGHT * (dAlly < ALLY_SPREAD_CAP_M ? dAlly : ALLY_SPREAD_CAP_M)
      }
    }

    // Término de recencia: aunque no haya nadie cerca AHORA, repetir el
    // mismo punto una y otra vez concentra a todo el equipo ahí en cuanto
    // dos muertes caen con pocos segundos de diferencia. Penaliza los
    // spawns usados hace poco, con la penalización decayendo a cero al
    // final de la ventana.
    if (history !== null) {
      let penalty = 0
      for (let j = 0; j < history.indices.length; j++) {
        if (history.indices[j] !== i) continue
        const age = nowS - history.times[j]
        if (age < 0 || age >= RECENT_WINDOW_S) continue
        const p = RECENT_PENALTY_M * (1 - age / RECENT_WINDOW_S)
        if (p > penalty) penalty = p
      }
      score -= penalty
    }

    if (score > bestScore) {
      bestScore = score
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
