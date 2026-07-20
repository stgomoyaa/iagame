/**
 * Mide con qué frecuencia salta cada medalla en partidas REALES.
 *
 *   npx vite-node scripts/medir-medallas.ts
 *
 * No es un test: es la herramienta con la que se calibraron las ventanas de
 * `match/medal-tracker.ts`, igual que `scripts/simular-rangos.ts` calibró
 * `expectedCombatScore`. Su salida es la tabla del reporte.
 *
 *
 * POR QUÉ ESTO Y NO EL SIMULADOR ESTADÍSTICO QUE YA EXISTÍA
 *
 * `progression/simulate.ts` resuelve una partida con una fórmula: tira
 * kills y muertes de una gaussiana según la diferencia de habilidad. Sirve
 * perfecto para lo que fue hecho (¿converge la escalera de rangos?), pero
 * es inútil para calibrar medallas, porque las medallas no dependen de
 * CUÁNTAS bajas hubo sino de CÓMO se repartieron en el tiempo y en el
 * espacio. "Doble baja" pregunta si dos bajas cayeron con menos de cuatro
 * segundos de diferencia; "tiro largo" pregunta a cuántos metros; "salvada"
 * pregunta a quién le estaban disparando. Nada de eso existe en una
 * gaussiana: habría que inventarlo, y entonces la medición estaría midiendo
 * los supuestos que puse yo, no el juego.
 *
 * Así que esto corre el juego de verdad, sin renderer: el mismo navgrid, el
 * mismo A*, la misma FSM, el mismo hitscan, el mismo control de disparo y
 * recarga, los mismos spawns y la misma invulnerabilidad post-respawn que
 * game.ts. Lo único que no está es dibujar.
 *
 *
 * QUIÉN ES "EL JUGADOR"
 *
 * Un bot. El participante 0 es un bot como los demás, y las medallas se
 * miden sobre él. Es una aproximación y hay que decirla: un humano se mueve
 * distinto, elige peleas distinto y tiene mejor puntería que la FSM. Lo que
 * la medición SÍ captura bien es la estructura temporal y espacial del
 * combate en este mapa con este ritmo -- separación entre bajas, distancias
 * de enfrentamiento, cuántos compañeros hay muertos a la vez -- que es
 * justamente de lo que dependen las ventanas. Para las medallas que
 * dependen de habilidad pura (rachas largas, sin morir) se corre además con
 * el participante 0 en una dificultad más alta que el resto, que es la
 * forma honesta de modelar "un jugador mejor que su lobby".
 */

import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import type { MapDef } from '@/game/map/types'
import { buildNavGrid } from '@/game/bots/navgrid'
import { createBotWorld, damageBot, registerGunshot, stepAllBotsMotor, stepBotCombat } from '@/game/bots/bot'
import { BOTS } from '@/game/bots/tuning'
import { createMatchBots, stepMatchBotsThink } from '@/game/match/squad'
import { createMatchTargets } from '@/game/match/targeting'
import { assignBotArchetypes } from '@/game/match/loadouts'
import { raycastMap } from '@/game/combat/hitscan'
import { TICK_DT } from '@/game/engine/constants'
import { createMatchState, recordDamage, recordKill, stepMatch } from '@/game/match/match'
import { MATCH } from '@/game/match/tuning'
import { isEnemy, type MatchMode } from '@/game/match/types'
import {
  createSpawnHistory,
  invulnerabilityExpiresAt,
  isInvulnerable,
  pickFarthestSpawn,
  recordSpawnUse,
} from '@/game/match/respawn'
import type { Hitbox } from '@/game/combat/hitboxes'
import { vec3, type Vec3 } from '@/game/math/vec3'
import {
  createKillContext,
  createMedalTracker,
  finalizarMedallas,
  MEDALLAS_TUNING,
  registrarDanoMedallas,
  registrarKillMedallas,
  registrarReaparicionMedallas,
  stepMedallas,
} from '@/game/match/medal-tracker'
import { CATALOGO_MEDALLAS } from '@/game/progression/medals'

export interface CorridaMedallas {
  /** Veces que saltó cada medalla, indexado por MedalId. */
  conteo: number[]
  killsDelSeguido: number
  muertesDelSeguido: number
  killsTotales: number
  /** Todas las distancias de baja del seguido, metros -- para calibrar
   *  tiro largo y a quemarropa. */
  distancias: number[]
  /** Separación en segundos entre bajas consecutivas del seguido -- para
   *  calibrar la ventana de multikill. */
  separaciones: number[]
  /** Veces que el seguido entró en el estado "último vivo de mi equipo".
   *  Diagnóstico: separa "la medalla de clutch pide demasiado" de "la
   *  situación de clutch no ocurre nunca en este modo". */
  entradasClutch: number
  /** Bajas del seguido hechas con la vida en rojo (<= 25 de 100).
   *  Diagnóstico de la definición alternativa de clutch. */
  killsVidaBaja: number
  /** Vida del seguido en el instante de cada una de sus bajas. Para ver si
   *  existe ALGÚN umbral de "vida en rojo" que dispare a un ritmo útil. */
  vidaEnBajas: number[]
  /** Duración de cada vida del seguido, segundos. Para calibrar el umbral
   *  de supervivencia de "sin morir". */
  duracionVidas: number[]
  /** Bajas del seguido hechas estando su equipo en inferioridad numérica de
   *  vivos. Diagnóstico de la otra definición alternativa de clutch. */
  killsEnInferioridad: number
  /** Bajas del seguido que fueron headshot. Contra `killsDelSeguido` da la
   *  fracción, que es el diagnóstico clave del sesgo de este harness. */
  headshotsDelSeguido: number
  duracionS: number
}

/**
 * Corre una partida completa headless. `dificultadSeguido` en null significa
 * "igual que el resto" (enfrentamiento parejo).
 */
export function correrPartida(
  mapa: MapDef,
  mode: MatchMode,
  botCount: number,
  dificultadBase: number,
  dificultadSeguido: number | null,
  seed: number,
): CorridaMedallas {
  // CONVENCIÓN DE IDS: la misma que game.ts, y no una propia, porque
  // match/squad.ts la tiene horneada -- `stepMatchBotsThink` asume que
  // `bots[i]` es el participante `i+1`, dejando el id 0 para el jugador
  // humano. Acá no hay humano, así que el id 0 queda como un participante
  // FANTASMA permanentemente muerto (nunca se mueve, nunca dispara, nunca
  // lo pueden ver) y el "jugador" es el participante 1, o sea `bots[0]`.
  //
  // Es un rodeo, pero el correcto: la alternativa era reindexar y perder la
  // garantía de estar corriendo exactamente el mismo código de targeting
  // que el juego, que es el único motivo por el que esta medición vale algo.
  const combatientes = botCount + 1
  const participantCount = combatientes + 1
  const SEGUIDO = 1

  const grid = buildNavGrid(mapa)
  const world = createBotWorld(mapa.boxes, raycastMap, grid, mapa.convexes)
  const archetypes = assignBotArchetypes(combatientes)
  const dificultades: number[] = []
  for (let i = 0; i < combatientes; i++) {
    // Mismo reparto simétrico y determinista que game.ts resolveDifficultyRanks
    // en modo 'mixed': la partida tiene rivales más blandos y más duros, no
    // un nivel parejo de punta a punta.
    const paso = combatientes > 1 ? (i % 4) / 3 : 0.5
    const offset = (paso - 0.5) * 2 * MATCH.mixedDifficultySpread
    dificultades.push(Math.min(1, Math.max(0, dificultadBase + offset)))
  }
  // El seguido toma el CENTRO de la dificultad, no el escalón que le
  // tocaría por índice. En el juego real la dificultad de los bots se
  // reparte ALREDEDOR del rango del jugador (game.ts resolveDifficultyRanks),
  // así que dejar al seguido en `i=0` -- el escalón más blando del reparto --
  // lo pondría medio nivel por debajo de su propia partida y sesgaría hacia
  // abajo todas las medallas de habilidad.
  dificultades[0] = dificultadSeguido !== null ? dificultadSeguido : dificultadBase

  // Rotación de spawns por semilla. `createMatchBots` reparte
  // `spawns[i % spawns.length]`, así que sin rotar, el seguido (bots[0])
  // arranca SIEMPRE en el mismo punto y cualquier sesgo posicional de ese
  // punto -- estar en un rincón lejos del cruce, por ejemplo -- se repite
  // idéntico en las 20 corridas y se lee como si fuera una propiedad del
  // juego. Medido: sin esto, "primera sangre" daba exactamente 0 en 80
  // partidas, que con 9 combatientes es imposible por azar.
  const spawnsRotados = mapa.spawns.map(
    (_, i) => mapa.spawns[(i + (seed % mapa.spawns.length)) % mapa.spawns.length],
  )
  const bots = createMatchBots(spawnsRotados, archetypes, dificultades)
  // Desfase de semilla por corrida: createMatchBots siembra fijo, así que
  // sin esto todas las corridas del mismo escenario serían idénticas y
  // promediar cinco no diría más que correr una.
  for (let i = 0; i < bots.length; i++) {
    bots[i].aiAccumulator = (((i * 7919 + seed) % 1000) / 1000) * (1 / BOTS.aiTickHz)
  }

  const targets = createMatchTargets(mode, participantCount)
  // El fantasma nunca está vivo: así targeting.ts lo ignora en todas sus
  // búsquedas y no distorsiona a quién persigue nadie.
  targets.alive[0] = false
  targets.positions[0].x = Infinity
  targets.positions[0].z = Infinity

  const matchState = createMatchState(mode, participantCount, MATCH)
  const tracker = createMedalTracker(mode, participantCount, SEGUIDO, MEDALLAS_TUNING)
  // Un solo contexto reusado, igual que en game.ts: registrar una baja no
  // puede asignar.
  const killCtx = createKillContext()

  // Hitboxes con owner = id de participante (sin dianas de por medio, así
  // que no hay offset de targetCount como en game.ts).
  const todasLasHitboxes: Hitbox[] = []
  for (let i = 0; i < combatientes; i++) {
    for (const hb of bots[i].hitboxes) {
      hb.owner = i + 1
      todasLasHitboxes.push(hb)
    }
  }
  const hitboxesEnemigasDe: Hitbox[][] = []
  for (let pid = 0; pid < participantCount; pid++) {
    hitboxesEnemigasDe.push(todasLasHitboxes.filter((hb) => isEnemy(mode, pid, hb.owner)))
  }

  const spawnHistory = createSpawnHistory(participantCount)
  const invulnerableHasta = new Float64Array(participantCount)
  invulnerableHasta.fill(-Infinity)
  const estabaVivo = new Uint8Array(participantCount)
  estabaVivo.fill(1)
  const spawnElegido = new Int32Array(participantCount)

  const posScratch: Vec3[] = []
  const aliadosScratch: Vec3[] = []
  for (let i = 0; i < participantCount; i++) {
    posScratch.push(vec3())
    aliadosScratch.push(vec3())
  }

  function llenarEnemigos(dePid: number): number {
    let n = 0
    for (let b = 0; b < combatientes; b++) {
      const pid = b + 1
      if (pid === dePid || !bots[b].health.alive || !isEnemy(mode, dePid, pid)) continue
      posScratch[n].x = bots[b].player.position.x
      posScratch[n].y = bots[b].player.position.y
      posScratch[n].z = bots[b].player.position.z
      n++
    }
    return n
  }
  function llenarAliados(dePid: number): number {
    let n = 0
    for (let b = 0; b < combatientes; b++) {
      const pid = b + 1
      if (pid === dePid || !bots[b].health.alive || isEnemy(mode, dePid, pid)) continue
      aliadosScratch[n].x = bots[b].player.position.x
      aliadosScratch[n].y = bots[b].player.position.y
      aliadosScratch[n].z = bots[b].player.position.z
      n++
    }
    return n
  }

  const distancias: number[] = []
  const separaciones: number[] = []
  let ultimaKillDelSeguido = -Infinity
  let killsTotales = 0
  const entradasClutch = 0
  let headshotsDelSeguido = 0
  let killsVidaBaja = 0
  let killsEnInferioridad = 0
  const vidaEnBajas: number[] = []
  const duracionVidas: number[] = []
  let vidaEmpezoS = 0

  const pasos = Math.ceil(MATCH.timeLimitS / TICK_DT)
  for (let paso = 0; paso < pasos && matchState.phase === 'live'; paso++) {
    // --- respawn: los muertos eligen punto fresco antes de que
    // stepAllBotsMotor pueda revivirlos este mismo tick (igual que game.ts) ---
    for (let b = 0; b < combatientes; b++) {
      const pid = b + 1
      estabaVivo[pid] = bots[b].health.alive ? 1 : 0
      if (!bots[b].health.alive) {
        const idx = pickFarthestSpawn(
          mapa.spawns,
          posScratch,
          llenarEnemigos(pid),
          aliadosScratch,
          llenarAliados(pid),
          spawnHistory,
          matchState.elapsedS,
        )
        spawnElegido[pid] = idx
        bots[b].spawn.x = mapa.spawns[idx].x
        bots[b].spawn.y = mapa.spawns[idx].y
        bots[b].spawn.z = mapa.spawns[idx].z
      }
    }

    world.simTimeS += TICK_DT
    stepMatchBotsThink(bots, world, targets, TICK_DT)
    stepAllBotsMotor(bots, world, TICK_DT)

    for (let b = 0; b < combatientes; b++) {
      const pid = b + 1
      targets.positions[pid].x = bots[b].player.position.x
      targets.positions[pid].y = bots[b].player.position.y + bots[b].player.eyeHeight
      targets.positions[pid].z = bots[b].player.position.z
      targets.alive[pid] = bots[b].health.alive
      if (estabaVivo[pid] === 0 && bots[b].health.alive) {
        invulnerableHasta[pid] = invulnerabilityExpiresAt(matchState.elapsedS, MATCH.respawnInvulnerabilityS)
        recordSpawnUse(spawnHistory, spawnElegido[pid], matchState.elapsedS)
        // El tracker necesita saber quién volvió: de eso depende que el
        // estado de clutch se cierre cuando reaparece un compañero.
        registrarReaparicionMedallas(tracker, pid)
      }
    }

    // --- gate de invulnerabilidad por radio 0, igual que game.ts ---
    for (let b = 0; b < combatientes; b++) {
      const pid = b + 1
      const tocable = bots[b].health.alive && !isInvulnerable(invulnerableHasta[pid], matchState.elapsedS)
      if (!tocable) for (const hb of bots[b].hitboxes) hb.radius = 0
      else {
        bots[b].hitboxes[0].radius = BOTS.torsoRadius
        bots[b].hitboxes[1].radius = BOTS.headRadius
        bots[b].hitboxes[2].radius = BOTS.legsRadius
      }
    }

    // --- combate ---
    for (let b = 0; b < combatientes; b++) {
      const bot = bots[b]
      const pid = b + 1
      if (!bot.health.alive) continue
      const disparos = stepBotCombat(bot, hitboxesEnemigasDe[pid], TICK_DT)
      if (disparos > 0) registerGunshot(world.shots, bot.combatInput.origin, world.simTimeS)
      if (disparos <= 0 || !bot.shotResult.hit || bot.shotResult.part === 'none') continue
      const victimaPid = bot.shotResult.owner
      if (victimaPid < 1 || victimaPid >= participantCount) continue

      const dano = bot.shotResult.damage
      const murio = damageBot(bots[victimaPid - 1], dano)
      recordDamage(matchState, pid, dano)
      registrarDanoMedallas(tracker, pid, victimaPid, matchState.elapsedS)

      if (murio) {
        if (victimaPid === SEGUIDO) {
          duracionVidas.push(matchState.elapsedS - vidaEmpezoS)
          vidaEmpezoS = matchState.elapsedS
        }
        killsTotales++
        recordKill(matchState, pid, victimaPid, '', bot.shotResult.part === 'head')
        killCtx.killerId = pid
        killCtx.victimId = victimaPid
        killCtx.headshot = bot.shotResult.part === 'head'
        killCtx.distanciaM = bot.shotResult.distance
        killCtx.balasRestantes = bot.combat.fireControl.ammo
        killCtx.vidaDelKiller = bot.health.health
        killCtx.tiempoS = matchState.elapsedS
        registrarKillMedallas(tracker, killCtx, MEDALLAS_TUNING)
        if (pid === SEGUIDO) {
          if (bot.shotResult.part === 'head') headshotsDelSeguido++
          vidaEnBajas.push(bot.health.health)
          if (bot.health.health <= 25) killsVidaBaja++
          {
            let miosVivos = 0
            let rivalesVivos = 0
            for (let k = 0; k < combatientes; k++) {
              if (!bots[k].health.alive) continue
              if (isEnemy(mode, SEGUIDO, k + 1)) rivalesVivos++
              else miosVivos++
            }
            if (miosVivos < rivalesVivos) killsEnInferioridad++
          }
          distancias.push(bot.shotResult.distance)
          if (Number.isFinite(ultimaKillDelSeguido)) {
            separaciones.push(matchState.elapsedS - ultimaKillDelSeguido)
          }
          ultimaKillDelSeguido = matchState.elapsedS
        }
      }
    }

    stepMatch(matchState, TICK_DT, MATCH)
    stepMedallas(tracker, TICK_DT, matchState.elapsedS, MEDALLAS_TUNING)
  }

  finalizarMedallas(tracker)

  return {
    conteo: Array.from(tracker.conteo),
    killsDelSeguido: tracker.killsDelSeguido,
    muertesDelSeguido: tracker.muertesDelSeguido,
    killsTotales,
    distancias,
    separaciones,
    entradasClutch,
    killsVidaBaja,
    vidaEnBajas,
    duracionVidas,
    killsEnInferioridad,
    headshotsDelSeguido,
    duracionS: matchState.elapsedS,
  }
}

function percentil(valores: readonly number[], p: number): number {
  if (valores.length === 0) return NaN
  const orden = [...valores].sort((a, b) => a - b)
  const idx = Math.min(orden.length - 1, Math.max(0, Math.round((p / 100) * (orden.length - 1))))
  return orden[idx]
}

function media(valores: readonly number[]): number {
  if (valores.length === 0) return NaN
  return valores.reduce((a, b) => a + b, 0) / valores.length
}

export interface Escenario {
  nombre: string
  mapa: MapDef
  mode: MatchMode
  dificultadBase: number
  dificultadSeguido: number | null
  partidas: number
}

export function correrEscenario(esc: Escenario): {
  conteos: number[]
  distancias: number[]
  separaciones: number[]
  kills: number
  muertes: number
  killsTotales: number
  entradasClutch: number
  killsVidaBaja: number
  vidaEnBajas: number[]
  duracionVidas: number[]
  killsEnInferioridad: number
  headshots: number
  partidas: number
} {
  const conteos = new Array<number>(CATALOGO_MEDALLAS.length).fill(0)
  const distancias: number[] = []
  const separaciones: number[] = []
  let kills = 0
  let muertes = 0
  let killsTotales = 0
  let entradasClutch = 0
  let headshots = 0
  let killsVidaBaja = 0
  let killsEnInferioridad = 0
  const vidaEnBajas: number[] = []
  const duracionVidas: number[] = []

  for (let p = 0; p < esc.partidas; p++) {
    const r = correrPartida(
      esc.mapa,
      esc.mode,
      MATCH.botCount,
      esc.dificultadBase,
      esc.dificultadSeguido,
      0x51e7 + p * 104729,
    )
    for (let i = 0; i < conteos.length; i++) conteos[i] += r.conteo[i]
    distancias.push(...r.distancias)
    separaciones.push(...r.separaciones)
    kills += r.killsDelSeguido
    muertes += r.muertesDelSeguido
    killsTotales += r.killsTotales
    entradasClutch += r.entradasClutch
    killsVidaBaja += r.killsVidaBaja
    vidaEnBajas.push(...r.vidaEnBajas)
    duracionVidas.push(...r.duracionVidas)
    killsEnInferioridad += r.killsEnInferioridad
    headshots += r.headshotsDelSeguido
  }

  return {
    conteos,
    distancias,
    separaciones,
    kills,
    muertes,
    killsTotales,
    entradasClutch,
    killsVidaBaja,
    vidaEnBajas,
    duracionVidas,
    killsEnInferioridad,
    headshots,
    partidas: esc.partidas,
  }
}

function fijo(n: number, d = 2): string {
  return Number.isFinite(n) ? n.toFixed(d) : '--'
}

/**
 * Barrido de umbrales. Las medallas de distancia se pueden calibrar sin
 * volver a correr nada -- la distribución de distancias ya está medida y el
 * umbral sólo la corta -- así que el barrido de tiro largo y a quemarropa es
 * aritmética sobre la muestra. El de venganza sí exige volver a correr,
 * porque depende del orden de los eventos y no de una distribución.
 */
function barridoDistancias(distancias: readonly number[], partidas: number): void {
  console.log('   tiro largo: umbral -> medallas por partida')
  for (const umbral of [18, 20, 21, 22, 24, 28]) {
    const n = distancias.filter((d) => d >= umbral).length
    console.log(`     >= ${String(umbral).padStart(2)} m  ${fijo(n / partidas, 2).padStart(6)}`)
  }
  console.log('   a quemarropa: umbral -> medallas por partida')
  for (const umbral of [3, 4, 5, 6, 7, 8]) {
    const n = distancias.filter((d) => d <= umbral).length
    console.log(`     <= ${String(umbral).padStart(2)} m  ${fijo(n / partidas, 2).padStart(6)}`)
  }
}

function barridoVenganza(): void {
  console.log('')
  console.log('== Barrido de la ventana de venganza ==')
  const original = MEDALLAS_TUNING.ventanaVenganzaS
  for (const ventana of [10, 15, 20, 30]) {
    MEDALLAS_TUNING.ventanaVenganzaS = ventana
    const tdm = correrEscenario({
      nombre: 'tdm',
      mapa: ARENA,
      mode: 'tdm',
      dificultadBase: 0.5,
      dificultadSeguido: null,
      partidas: 12,
    })
    const ffa = correrEscenario({
      nombre: 'ffa',
      mapa: ARENA,
      mode: 'ffa',
      dificultadBase: 0.5,
      dificultadSeguido: null,
      partidas: 12,
    })
    console.log(
      `   ${String(ventana).padStart(2)}s -> TDM ${fijo(tdm.conteos[8] / tdm.partidas, 2)}/partida   FFA ${fijo(ffa.conteos[8] / ffa.partidas, 2)}/partida`,
    )
  }
  MEDALLAS_TUNING.ventanaVenganzaS = original
}

function main(): void {
  const escenarios: Escenario[] = [
    {
      nombre: 'TDM arena, parejo',
      mapa: ARENA,
      mode: 'tdm',
      dificultadBase: 0.5,
      dificultadSeguido: null,
      partidas: 20,
    },
    {
      nombre: 'FFA arena, parejo',
      mapa: ARENA,
      mode: 'ffa',
      dificultadBase: 0.5,
      dificultadSeguido: null,
      partidas: 20,
    },
    {
      nombre: 'TDM arena, jugador fuerte',
      mapa: ARENA,
      mode: 'tdm',
      dificultadBase: 0.35,
      dificultadSeguido: 0.9,
      partidas: 20,
    },
    {
      nombre: 'TDM arena, jugador MUY superior (piso de "sin morir")',
      mapa: ARENA,
      mode: 'tdm',
      dificultadBase: 0.05,
      dificultadSeguido: 1,
      partidas: 20,
    },
    {
      nombre: 'TDM bunker, parejo',
      mapa: BUNKER,
      mode: 'tdm',
      dificultadBase: 0.5,
      dificultadSeguido: null,
      partidas: 20,
    },
  ]

  for (const esc of escenarios) {
    const t0 = Date.now()
    const r = correrEscenario(esc)
    const segundos = (Date.now() - t0) / 1000

    console.log('')
    console.log(`== ${esc.nombre} (${r.partidas} partidas de 6 min, ${fijo(segundos, 1)}s de cómputo) ==`)
    console.log(
      `   jugador: ${fijo(r.kills / r.partidas, 1)} bajas / ${fijo(r.muertes / r.partidas, 1)} muertes por partida; ${fijo(r.killsTotales / r.partidas, 0)} bajas totales en la partida`,
    )
    console.log(
      `   distancia de baja: p01 ${fijo(percentil(r.distancias, 1), 1)}  p05 ${fijo(percentil(r.distancias, 5), 1)}  p10 ${fijo(percentil(r.distancias, 10), 1)}  mediana ${fijo(percentil(r.distancias, 50), 1)}  p90 ${fijo(percentil(r.distancias, 90), 1)}  p95 ${fijo(percentil(r.distancias, 95), 1)}  p99 ${fijo(percentil(r.distancias, 99), 1)}  max ${fijo(percentil(r.distancias, 100), 1)} (m)`,
    )
    console.log(
      `   separación entre bajas: p10 ${fijo(percentil(r.separaciones, 10), 1)}s  p25 ${fijo(percentil(r.separaciones, 25), 1)}s  mediana ${fijo(percentil(r.separaciones, 50), 1)}s  media ${fijo(media(r.separaciones), 1)}s`,
    )
    console.log(
      `   diagnóstico: headshots ${fijo((100 * r.headshots) / Math.max(1, r.kills), 0)}% de las bajas; entradas a "último vivo" ${fijo(r.entradasClutch / r.partidas, 2)}/partida; bajas con vida en rojo ${fijo(r.killsVidaBaja / r.partidas, 2)}/partida; bajas en inferioridad ${fijo(r.killsEnInferioridad / r.partidas, 2)}/partida`,
    )
    console.log(
      `   vida del jugador al matar: p05 ${fijo(percentil(r.vidaEnBajas, 5), 0)}  p10 ${fijo(percentil(r.vidaEnBajas, 10), 0)}  p25 ${fijo(percentil(r.vidaEnBajas, 25), 0)}  mediana ${fijo(percentil(r.vidaEnBajas, 50), 0)} (de 100)`,
    )
    console.log(
      `   duración de cada vida: mediana ${fijo(percentil(r.duracionVidas, 50), 0)}s  p75 ${fijo(percentil(r.duracionVidas, 75), 0)}s  p90 ${fijo(percentil(r.duracionVidas, 90), 0)}s  p95 ${fijo(percentil(r.duracionVidas, 95), 0)}s  max ${fijo(percentil(r.duracionVidas, 100), 0)}s`,
    )
    console.log('   medalla                por partida    total')
    for (const def of CATALOGO_MEDALLAS) {
      const total = r.conteos[def.id]
      console.log(
        `     ${def.slug.padEnd(18)} ${fijo(total / r.partidas, 2).padStart(10)} ${String(total).padStart(8)}`,
      )
    }
    barridoDistancias(r.distancias, r.partidas)
  }

  barridoVenganza()
}

// vite-node corre el módulo entero: sólo ejecutar el reporte cuando se lo
// invoca como script, no cuando lo importa un test. La bandera va por
// variable de entorno y no por argv porque `vite-node -c <config>` reordena
// los argumentos y el guard por argv[1] queda mudo sin avisar.
if (process.env.MEDIR_MEDALLAS === '1') main()
