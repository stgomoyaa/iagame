/**
 * Banco de medición de un duelo bot-contra-blanco.
 *
 * Existe porque la pregunta "¿los bots son difíciles por buena puntería o
 * por moverse raro?" no se contesta mirando el juego: se contesta midiendo
 * tres números por corrida.
 *
 *   - precisión         impactos / disparos
 *   - ttffS             segundos desde que el bot VE al blanco hasta que
 *                       suelta su primer disparo
 *   - lateralMPorS      metros por segundo de desplazamiento PERPENDICULAR
 *                       a la línea bot->blanco, promediados sólo sobre el
 *                       tiempo con el gatillo apretado
 *
 * El tercero es el que retrata el zigzag: un bot que busca ángulo de verdad
 * tiene un lateral bajo y sostenido hacia UN lado; un bot que tiembla tiene
 * un lateral alto que no lo lleva a ninguna parte. Por eso además se reporta
 * `desplazamientoNetoM` (cuánto se corrió en neto) contra `recorridoLateralM`
 * (cuánto recorrió de lado en total): el cociente entre los dos es la
 * RECTITUD del movimiento lateral, y es la diferencia entre rodear y vibrar.
 *
 * El blanco es un poste inmóvil a propósito. No es realismo: es control. Con
 * un blanco que se mueve, la precisión mezcla la puntería del bot con la
 * suerte del recorrido del blanco, y ya sabemos (ver AGENTS.md) que esta
 * simulación tiene 70% de varianza entre corridas idénticas. Un blanco fijo
 * deja la varianza sólo del lado del bot, que es lo que se quiere medir.
 *
 * No se importa desde el juego: es herramienta de medición, la usan las
 * pruebas de esta carpeta y nada más.
 */

import { createBotState, createBotWorld, stepBotCombat, stepBotMotor, stepBotThink, type BotState, type BotWorld } from '@/game/bots/bot'
import { buildNavGrid } from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'
import { ARENA } from '@/game/map/arena'
import { buildMapBvh, raycastAgainstBvh } from '@/game/combat/hitscan'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { TICK_DT } from '@/game/engine/constants'
import { vec3 } from '@/game/math/vec3'
import type { Hitbox } from '@/game/combat/hitboxes'
import type { RaycastMapFn } from '@/game/bots/perception'

export interface MetricasDuelo {
  /** Impactos / disparos. NaN si no disparó nunca. */
  precision: number
  /** Segundos entre la primera vez que el bot ve al blanco y su primer
   *  disparo. null si nunca disparó. */
  ttffS: number | null
  /** Metros/segundo de movimiento perpendicular a la línea de tiro,
   *  promediado sobre el tiempo con el gatillo apretado. */
  lateralMPorS: number
  /** Recorrido lateral TOTAL (suma de |paso lateral|), metros. */
  recorridoLateralM: number
  /** Desplazamiento lateral NETO (|posición final - inicial| proyectado),
   *  metros. Muy por debajo del recorrido total = el bot vibró. */
  desplazamientoNetoM: number
  /** Cuántas veces cambió de sentido el movimiento lateral mientras
   *  disparaba. Es la lectura más directa del zigzag. */
  cambiosDeSentido: number
  disparos: number
  impactos: number
  /** Segundos con el gatillo apretado. */
  tiempoDisparandoS: number
}

/** Mundo de la arena, horneado una vez y reusado: el navgrid de la arena
 *  tarda bastante y cada corrida de medición lo pediría de nuevo. El bot no
 *  escribe nada en el mundo salvo targetEye/neighbour, que se resetean en
 *  cada corrida. */
let mundoCache: BotWorld | null = null

function mundoArena(): BotWorld {
  if (mundoCache !== null) return mundoCache
  const bvh = buildMapBvh(ARENA.boxes)
  const raycast: RaycastMapFn = (origin, dir, maxDistance, out) =>
    raycastAgainstBvh(bvh, origin, dir, maxDistance, out)
  const grid = buildNavGrid(ARENA, 1, 1.8)
  mundoCache = createBotWorld(ARENA.boxes, raycast, grid)
  return mundoCache
}

/** Hitboxes de un blanco humanoide inmóvil en (x,z), mismas alturas y radios
 *  que un bot (bots/tuning.ts) para que la precisión medida sea comparable
 *  con la de un duelo real entre bots. */
function hitboxesBlanco(x: number, y: number, z: number): Hitbox[] {
  return [
    { center: vec3(x, y + BOTS.torsoOffsetY, z), radius: BOTS.torsoRadius, part: 'torso', owner: 99 },
    { center: vec3(x, y + BOTS.headOffsetY, z), radius: BOTS.headRadius, part: 'head', owner: 99 },
    { center: vec3(x, y + BOTS.legsOffsetY, z), radius: BOTS.legsRadius, part: 'limb', owner: 99 },
  ]
}

export interface OpcionesDuelo {
  /** 0..1, el mismo escalar de bots/difficulty.ts. */
  rank: number
  /** Semilla del bot: cambia el PRNG del cono de error y los desempates. */
  seed: number
  /** Distancia bot-blanco, metros (a lo largo del carril izquierdo). */
  distanciaM: number
  /** Segundos de simulación. */
  duracionS: number
  /**
   * Grados que el blanco arranca FUERA del eje de apuntado del bot. Con 0 el
   * bot ya está encarado y el ttff mide sólo la decisión de disparar; con un
   * valor dentro del cono de visión (< visionHalfAngleDeg) mide además lo
   * que tarda en girar la mira, que es la mitad de lo que un jugador llama
   * "tiempo de reacción".
   */
  desvioInicialDeg: number
}

/**
 * Corre un duelo y devuelve sus tres números. Determinista dado (rank, seed,
 * distanciaM, duracionS, desvioInicialDeg): la varianza que interesa
 * reportar es la que hay ENTRE semillas, no la de correr dos veces lo mismo.
 */
export function medirDuelo(op: OpcionesDuelo): MetricasDuelo {
  const world = mundoArena()

  // Carril izquierdo de la arena, despejado entre z=-8 y z=+8 a x=-22: no
  // hay separador ni cobertura baja en el medio, así que la línea de vista
  // depende sólo de la distancia pedida y no de qué caja se cruzó.
  const botX = -22
  const botZ = -op.distanciaM / 2
  const blancoX = -22
  const blancoZ = op.distanciaM / 2

  const bot = createBotState(vec3(botX, 0.1, botZ), op.rank, ARCHETYPES['ar-1'], op.seed)
  // Yaw exacto hacia el blanco (mismo convenio que aim.ts lookAt: yaw 0 mira
  // a -Z), más el desvío pedido.
  const yawAlBlanco = Math.atan2(-(blancoX - botX), -(blancoZ - botZ))
  bot.aimMotor.yaw = yawAlBlanco + (op.desvioInicialDeg * Math.PI) / 180

  const blanco = hitboxesBlanco(blancoX, 0.1, blancoZ)
  world.targetEye.x = blancoX
  world.targetEye.y = 0.1 + 1.65
  world.targetEye.z = blancoZ
  world.neighbourDistM = Infinity
  world.simTimeS = 0

  // Eje lateral: perpendicular horizontal a la línea bot->blanco. Fijo
  // durante toda la corrida (el blanco no se mueve), así que proyectar sobre
  // él es exactamente "cuánto se corrió de lado respecto de su línea de
  // tiro".
  const dx = blancoX - botX
  const dz = blancoZ - botZ
  const largo = Math.hypot(dx, dz)
  const latX = -dz / largo
  const latZ = dx / largo

  let disparos = 0
  let impactos = 0
  let tiempoDisparandoS = 0
  let recorridoLateralM = 0
  let cambiosDeSentido = 0
  let sentidoPrevio = 0
  let lateralInicial = NaN
  let lateralUltimo = 0
  let tVioS = -1
  let tPrimerDisparoS = -1

  const intervalo = 1 / BOTS.aiTickHz
  const pasos = Math.round(op.duracionS / TICK_DT)

  for (let i = 0; i < pasos; i++) {
    const t = i * TICK_DT
    world.simTimeS = t

    bot.aiAccumulator += TICK_DT
    while (bot.aiAccumulator >= intervalo) {
      bot.aiAccumulator -= intervalo
      stepBotThink(bot, world, intervalo)
    }

    stepBotMotor(bot, world, TICK_DT)

    // "Ve al blanco" = el think lo dejó en un estado que reconoce al
    // objetivo. `timeSinceSeenS` se resetea a 0 en el tick en que lo ve.
    if (tVioS < 0 && bot.timeSinceSeenS === 0) tVioS = t

    const gatillo = bot.combatInput.triggerHeld
    // OJO: stepBotCombat devuelve la CANTIDAD DE DISPAROS, no el daño. El
    // impacto vive en `bot.shotResult` (combat/shot.ts ShotResult), que
    // fireShot reescribe por disparo. Medir "acertó" con el valor de retorno
    // da precisión 1.000 siempre -- una métrica que no puede fallar. Se
    // detectó rompiendo el apuntado a propósito (cono de 25° permanente) y
    // viendo que la precisión no se movía; ver bots/medicion.test.ts, que
    // ancla justamente ese caso para que no vuelva a pasar.
    const tiros = stepBotCombat(bot, blanco, TICK_DT)

    if (tiros > 0) {
      disparos += tiros
      // Con cualquier arquetipo del arsenal la cadencia máxima queda muy por
      // debajo de un tiro por tick de 128Hz, así que `shotResult` describe
      // sin ambigüedad a ESE disparo. `owner === 99` es el blanco de este
      // banco: sin el chequeo, pegarle a una pared contaría como acierto.
      if (bot.shotResult.hit && bot.shotResult.owner === 99) impactos++
      if (tPrimerDisparoS < 0) tPrimerDisparoS = t
    }

    if (gatillo) tiempoDisparandoS += TICK_DT

    const lateral = bot.player.position.x * latX + bot.player.position.z * latZ
    if (Number.isNaN(lateralInicial)) {
      lateralInicial = lateral
      lateralUltimo = lateral
    } else if (gatillo) {
      const paso = lateral - lateralUltimo
      recorridoLateralM += Math.abs(paso)
      // Umbral de 1mm: por debajo de eso es ruido numérico del integrador,
      // no un cambio de intención. Sin el umbral, un bot perfectamente
      // quieto "cambia de sentido" cada tick por el último bit del float.
      const sentido = paso > 1e-3 ? 1 : paso < -1e-3 ? -1 : 0
      if (sentido !== 0) {
        if (sentidoPrevio !== 0 && sentido !== sentidoPrevio) cambiosDeSentido++
        sentidoPrevio = sentido
      }
      lateralUltimo = lateral
    } else {
      lateralUltimo = lateral
    }
  }

  const desplazamientoNetoM = Math.abs(lateralUltimo - lateralInicial)

  return {
    precision: disparos > 0 ? impactos / disparos : NaN,
    ttffS: tPrimerDisparoS >= 0 && tVioS >= 0 ? Math.max(0, tPrimerDisparoS - tVioS) : null,
    lateralMPorS: tiempoDisparandoS > 0 ? recorridoLateralM / tiempoDisparandoS : 0,
    recorridoLateralM,
    desplazamientoNetoM,
    cambiosDeSentido,
    disparos,
    impactos,
    tiempoDisparandoS,
  }
}

/** Resumen de una tanda: mediana y rango, que es lo único que se puede
 *  afirmar honestamente con una simulación ruidosa. */
export interface Resumen {
  n: number
  mediana: number
  min: number
  max: number
}

export function resumir(valores: readonly number[]): Resumen {
  const limpios = valores.filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
  if (limpios.length === 0) return { n: 0, mediana: NaN, min: NaN, max: NaN }
  const m = limpios.length >> 1
  const mediana = limpios.length % 2 === 1 ? limpios[m] : (limpios[m - 1] + limpios[m]) / 2
  return { n: limpios.length, mediana, min: limpios[0], max: limpios[limpios.length - 1] }
}

/** ¿Se solapan los rangos de dos tandas? Si se solapan, NO se puede declarar
 *  mejora -- es la barra que pide AGENTS.md, escrita una sola vez para que
 *  ninguna prueba la afloje por su cuenta. */
export function rangosSeSolapan(a: Resumen, b: Resumen): boolean {
  return a.min <= b.max && b.min <= a.max
}
