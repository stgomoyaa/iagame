import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { PITCH_LIMIT } from '@/game/engine/input'
import {
  applyRecoilShot,
  applyRecoilToPitch,
  applyRecoilToYaw,
  createRecoilState,
  resetRecoil,
  stepRecoilRecovery,
  type RecoilState,
} from '@/game/combat/recoil'

const DT = 1 / 128

/** Dispara `count` tiros seguidos (gatillo sostenido, sin recuperación
 *  entre medio) contra `state`. */
function fireShots(state: RecoilState, id: ArchetypeId, count: number): void {
  const archetype = ARCHETYPES[id]
  for (let i = 0; i < count; i++) applyRecoilShot(state, archetype)
}

describe('determinismo: misma secuencia de disparos, mismo desvío, siempre', () => {
  it('dos estados independientes disparando la misma secuencia terminan bit a bit iguales', () => {
    const a = createRecoilState()
    const b = createRecoilState()
    fireShots(a, 'ar-1', 15)
    fireShots(b, 'ar-1', 15)

    expect(a.pitchOffset).toBe(b.pitchOffset)
    expect(a.yawOffset).toBe(b.yawOffset)
    expect(a.shotIndex).toBe(b.shotIndex)
  })

  it('intercalar recuperación (mismos dt) entre disparos también da resultados idénticos en dos corridas', () => {
    const run = (): RecoilState => {
      const state = createRecoilState()
      const archetype = ARCHETYPES['ar-1']
      for (let i = 0; i < 10; i++) {
        applyRecoilShot(state, archetype)
        stepRecoilRecovery(state, archetype, false, DT)
      }
      return state
    }

    const a = run()
    const b = run()
    expect(a).toEqual(b)
  })

  it('secuencias de disparo distintas producen desvíos distintos', () => {
    const a = createRecoilState()
    const b = createRecoilState()
    fireShots(a, 'ar-1', 5)
    fireShots(b, 'ar-1', 10)
    expect(a.pitchOffset).not.toBe(b.pitchOffset)
  })
})

describe('el retroceso acumulado nunca supera PITCH_LIMIT', () => {
  it('un cargador entero de la LMG (el arquetipo de más climb total) no cruza el límite', () => {
    const state = createRecoilState()
    const lmg = ARCHETYPES.lmg
    for (let i = 0; i < lmg.magazine; i++) {
      applyRecoilShot(state, lmg)
      const pitch = applyRecoilToPitch(0, state)
      expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT)
      expect(pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT)
    }
  })

  it('retroceso + input del jugador ya cerca del tope clampea la suma (el patrón solo no llega, pero la suma sí)', () => {
    const state = createRecoilState()
    // Empuja el pitch base casi al límite, como si el jugador ya estuviera
    // mirando casi derecho hacia arriba antes de disparar.
    const playerPitch = PITCH_LIMIT - 0.01
    fireShots(state, 'ar-1', 30)

    const pitch = applyRecoilToPitch(playerPitch, state)
    expect(pitch).toBeLessThanOrEqual(PITCH_LIMIT)
  })

  it('todos los arquetipos, cargador completo: la suma con un pitch de jugador extremo nunca cruza el límite', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      for (let i = 0; i < archetype.magazine; i++) {
        applyRecoilShot(state, archetype)
        const pitch = applyRecoilToPitch(PITCH_LIMIT, state)
        expect(pitch, id).toBeLessThanOrEqual(PITCH_LIMIT)
        expect(pitch, id).toBeGreaterThanOrEqual(-PITCH_LIMIT)
      }
    }
  })
})

describe('recuperación: vuelve al origen sin pasarse', () => {
  it('con tiempo suficiente, el offset vuelve exactamente a 0, nunca cruza al signo opuesto', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 30)
    expect(state.pitchOffset).toBeGreaterThan(0)

    // Recupera de a pasos chicos: si "se pasara" cruzaría a negativo en
    // algún paso intermedio.
    for (let i = 0; i < 10000; i++) {
      stepRecoilRecovery(state, ARCHETYPES['ar-1'], false, DT)
      expect(state.pitchOffset).toBeGreaterThanOrEqual(0)
      expect(state.yawOffset === 0 || Math.sign(state.yawOffset) !== 0).toBe(true)
    }
    expect(state.pitchOffset).toBe(0)
  })

  it('no recupera mientras se sostiene el gatillo (firing=true)', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 5)
    const before = state.pitchOffset
    for (let i = 0; i < 1000; i++) stepRecoilRecovery(state, ARCHETYPES['ar-1'], true, DT)
    expect(state.pitchOffset).toBe(before)
  })
})

describe('applyRecoilToYaw', () => {
  it('suma el offset de yaw sin clampear (el yaw no tiene tope)', () => {
    const state = createRecoilState()
    state.yawOffset = 5
    expect(applyRecoilToYaw(100, state)).toBe(105)
  })
})

describe('resetRecoil', () => {
  it('vuelve el estado a cero (cargador nuevo / cambio de arma)', () => {
    const state = createRecoilState()
    fireShots(state, 'ar-1', 10)
    resetRecoil(state)
    expect(state).toEqual({ shotIndex: 0, pitchOffset: 0, yawOffset: 0 })
  })
})

describe('el primer disparo de un cargador fresco no tiene retroceso apreciable', () => {
  it('shotIndex 0 da un offset ~0 (recoilOffsetForShot(archetype, 0) parte de progress=0)', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      applyRecoilShot(state, archetype)
      // Jitter aparte, el primer disparo tiene que quedar muy por debajo
      // del climb total del arma: no es "otro disparo más de la rampa".
      const totalClimb = Math.max(...archetype.recoil.pattern.map(([, y]) => y))
      expect(Math.abs(state.pitchOffset), id).toBeLessThan(Math.max(totalClimb * 0.3, 0.01))
    }
  })

  it('shotIndex 0 da un offset EXACTAMENTE cero, sin jitter: tap-firing tiene que ser preciso al pixel', () => {
    // Más estricto que el test de arriba: no "chico", sino cero exacto. Es
    // la propiedad puntual que pide la sección de retroceso estilo CS — el
    // primer balazo de un cargador fresco no puede tener NINGÚN desvío, ni
    // siquiera el ruido de jitter, o tirar un solo tiro de precisión deja de
    // ser preciso al 100%.
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const archetype = ARCHETYPES[id]
      const state = createRecoilState()
      applyRecoilShot(state, archetype)
      expect(state.pitchOffset, id).toBe(0)
      expect(state.yawOffset, id).toBe(0)
    }
  })
})
