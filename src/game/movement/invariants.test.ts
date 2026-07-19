import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { ARENA } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

/**
 * PRNG determinista (mulberry32). A propósito no usa Math.random(): un fallo
 * de este test tiene que poder reproducirse byte a byte, no sólo "a veces".
 */
function mulberry32(seed: number): () => number {
  let a = seed | 0
  return function (): number {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260718
const TICKS = 8000
/** Mismo techo que usa el test de bhop para su tope suave: de sobra por
 *  encima del equilibrio real, pero no infinito. */
const SPEED_CEILING = MOVEMENT.bhopSoftCap * 1.5

describe('invariantes de movimiento bajo fuzz', () => {
  it('la velocidad horizontal y la posición se mantienen acotadas con crouch/jump/sprint alternando al azar', () => {
    const rand = mulberry32(SEED)
    const s = createPlayerState(vec3(0, 1, 0))

    const input: PlayerInput = {
      forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false,
    }

    for (let tick = 0; tick < TICKS; tick++) {
      // Flanco de crouch con alta probabilidad: es exactamente el patrón de
      // spam/macro que dispara el boost de slide en cada re-presionada.
      // jump se mantiene raro a propósito: sostenido produce auto-hop, que
      // saca al jugador del suelo casi todo el tiempo y nunca deja que la
      // condición de entrada al slide (requiere grounded) se ponga a prueba.
      if (rand() < 0.5) input.crouch = !input.crouch
      input.jump = rand() < 0.05
      input.sprint = rand() < 0.9
      input.forward = rand() < 0.85 ? 1 : rand() < 0.5 ? -1 : 0
      input.right = rand() < 0.3 ? (rand() < 0.5 ? 1 : -1) : 0
      input.yaw += (rand() - 0.5) * 0.1

      stepPlayer(s, input, ARENA.boxes, TICK_DT)

      const velHoriz = lengthHorizontal(s.velocity)
      expect(
        velHoriz,
        `tick ${tick}: velocidad horizontal ${velHoriz.toFixed(2)} supera el techo ${SPEED_CEILING.toFixed(2)}`,
      ).toBeLessThan(SPEED_CEILING)

      expect(
        s.position.x,
        `tick ${tick}: x=${s.position.x} fuera de ARENA.bounds`,
      ).toBeGreaterThan(ARENA.bounds.min.x)
      expect(
        s.position.x,
        `tick ${tick}: x=${s.position.x} fuera de ARENA.bounds`,
      ).toBeLessThan(ARENA.bounds.max.x)
      expect(
        s.position.y,
        `tick ${tick}: y=${s.position.y} fuera de ARENA.bounds`,
      ).toBeGreaterThan(ARENA.bounds.min.y)
      expect(
        s.position.y,
        `tick ${tick}: y=${s.position.y} fuera de ARENA.bounds`,
      ).toBeLessThan(ARENA.bounds.max.y)
      expect(
        s.position.z,
        `tick ${tick}: z=${s.position.z} fuera de ARENA.bounds`,
      ).toBeGreaterThan(ARENA.bounds.min.z)
      expect(
        s.position.z,
        `tick ${tick}: z=${s.position.z} fuera de ARENA.bounds`,
      ).toBeLessThan(ARENA.bounds.max.z)
    }
  })
})
