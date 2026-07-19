/**
 * Puente entre match/ y bots/: arma el escuadrón con dificultad y loadout
 * por bot (bots/bot.ts createBotSquad sólo acepta UN arquetipo y UNA
 * dificultad compartida por todos, sección 8 del spec de fase 2 -- acá se
 * generaliza a "uno por bot" sin tocar ese archivo) y hace pensar a cada
 * bot contra el enemigo vivo más cercano (match/targeting.ts) en vez de un
 * único objetivo fijo.
 *
 * Reusa `createBotState` y `stepBotThink`, ya exportados por bots/bot.ts,
 * tal cual -- este archivo no reimplementa nada de percepción, FSM ni
 * apuntado, sólo decide CON QUÉ datos llamarlos.
 */

import { createBotState, stepBotThink, type BotState, type BotWorld } from '@/game/bots/bot'
import { BOTS } from '@/game/bots/tuning'
import type { WeaponArchetype } from '@/game/weapons/archetypes'
import type { Vec3 } from '@/game/math/vec3'
import { resolveNearestEnemy, type MatchTargets } from '@/game/match/targeting'

/**
 * Crea `archetypes.length` bots repartidos por `spawns` (round-robin si hay
 * menos spawns que bots), con dificultad y arquetipo por índice --
 * `difficultyRanks[i]`/`archetypes[i]` para el bot `i`. Mismo escalonado de
 * IA que `createBotSquad` (bots/bot.ts): cada bot arranca con su
 * `aiAccumulator` desfasado en `i/count` del intervalo de 15Hz, así que
 * ningún tick de render hace pensar a todos a la vez.
 */
export function createMatchBots(
  spawns: readonly Vec3[],
  archetypes: readonly WeaponArchetype[],
  difficultyRanks: readonly number[],
): BotState[] {
  const count = archetypes.length
  const bots: BotState[] = []
  for (let i = 0; i < count; i++) {
    const spawn = spawns[i % spawns.length]
    const bot = createBotState(spawn, difficultyRanks[i], archetypes[i], 0x1000 + i * 7919)
    bot.aiAccumulator = (i / count) * (1 / BOTS.aiTickHz)
    bots.push(bot)
  }
  return bots
}

/**
 * Igual que `stepAllBotsThink` (bots/bot.ts) -- mismo escalonado de 15Hz por
 * bot, sin tocar ese archivo -- pero antes de cada `stepBotThink` reescribe
 * `world.targetEye` con el enemigo vivo más cercano a ESE bot
 * (match/targeting.ts), en vez de dejarlo apuntando siempre al mismo
 * objetivo fijo. `targets.positions`/`targets.alive` los mantiene al día el
 * llamador (game.ts) cada tick de física, igual que `world.targetEye` ya se
 * mantenía al día antes de esta tarea.
 *
 * El participante id de cada bot es `índice + 1` (0 es el jugador, ver
 * match/types.ts) -- `bots[i]` siempre corresponde a `targets.positions[i+1]`.
 */
export function stepMatchBotsThink(
  bots: readonly BotState[],
  world: BotWorld,
  targets: MatchTargets,
  dt: number,
): void {
  const interval = 1 / BOTS.aiTickHz
  for (let i = 0; i < bots.length; i++) {
    const bot = bots[i]
    bot.aiAccumulator += dt
    while (bot.aiAccumulator >= interval) {
      bot.aiAccumulator -= interval
      if (bot.health.alive) resolveNearestEnemy(targets, i + 1, world.targetEye)
      stepBotThink(bot, world, interval)
    }
  }
}
