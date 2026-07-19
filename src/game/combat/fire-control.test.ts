import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type WeaponArchetype } from '@/game/weapons/archetypes'
import {
  createFireControlState,
  fireInterval,
  resetFireControl,
  stepFireControl,
  syncReloadState,
} from '@/game/combat/fire-control'

const DT = 1 / 1000 // paso chico: nunca dispara más de un tiro por llamada en este arsenal.

/** Sostiene el gatillo `seconds` segundos en pasos de DT y cuenta los tiros. */
function holdTrigger(
  state: ReturnType<typeof createFireControlState>,
  archetype: WeaponArchetype,
  seconds: number,
): number {
  let shots = 0
  const steps = Math.round(seconds / DT)
  for (let i = 0; i < steps; i++) {
    shots += stepFireControl(state, archetype, true, false, DT)
  }
  return shots
}

describe('modo auto', () => {
  const ar1 = ARCHETYPES['ar-1'] // 600 rpm -> intervalo 0.1s

  it('el primer paso con el gatillo sostenido dispara de inmediato', () => {
    const state = createFireControlState(ar1)
    const shots = stepFireControl(state, ar1, true, false, DT)
    expect(shots).toBe(1)
  })

  it('dispara a la cadencia del arquetipo mientras se sostiene (el primero es instantáneo, igual que ttkMs)', () => {
    // Mismo criterio que ttkMs (weapons/archetypes.ts): el primer disparo es
    // instantáneo, así que en una ventana de T segundos entran
    // T/intervalo + 1 disparos (uno en t=0, y uno por cada intervalo
    // completo transcurrido después) — no T/intervalo a secas.
    const state = createFireControlState(ar1)
    const shots = holdTrigger(state, ar1, 2) // 2s a 600rpm (intervalo 0.1s)
    expect(shots).toBe(2 / fireInterval(ar1) + 1)
  })

  it('soltar el gatillo detiene el fuego de inmediato', () => {
    const state = createFireControlState(ar1)
    stepFireControl(state, ar1, true, false, DT)
    let shots = 0
    for (let i = 0; i < 500; i++) shots += stepFireControl(state, ar1, false, false, DT)
    expect(shots).toBe(0)
  })

  it('no banca cadencia durante un período ocioso largo', () => {
    const state = createFireControlState(ar1)
    stepFireControl(state, ar1, true, false, DT) // dispara 1
    for (let i = 0; i < 5000; i++) stepFireControl(state, ar1, false, false, DT) // 5s ocioso
    // Si hubiera bancado 5s de cadencia, este apretón dispararía ~50 tiros
    // de golpe. Sólo tiene que disparar 1 (el mismo que dispararía tras
    // cualquier período de reposo, corto o largo).
    const shots = stepFireControl(state, ar1, true, false, DT)
    expect(shots).toBe(1)
  })

  it('se detiene cuando se queda sin munición', () => {
    const state = createFireControlState(ar1)
    const shots = holdTrigger(state, ar1, 10) // más que de sobra para vaciar el cargador
    expect(shots).toBe(ar1.magazine)
    expect(state.ammo).toBe(0)
  })
})

describe('modo semi', () => {
  const pistol = ARCHETYPES.pistol // 400 rpm -> intervalo 0.15s

  it('sostener el gatillo dispara una sola vez, no repite', () => {
    const state = createFireControlState(pistol)
    const shots = holdTrigger(state, pistol, 2)
    expect(shots).toBe(1)
  })

  it('cada flanco de apretar dispara un tiro más, si ya pasó el intervalo mecánico', () => {
    const state = createFireControlState(pistol)
    let total = 0
    for (let click = 0; click < 3; click++) {
      total += stepFireControl(state, pistol, true, false, DT) // apretar
      for (let i = 0; i < Math.round(0.2 / DT); i++) {
        total += stepFireControl(state, pistol, false, false, DT) // soltar y esperar
      }
    }
    expect(total).toBe(3)
  })

  it('clickear más rápido que el intervalo mecánico no dispara más rápido que fireRate', () => {
    const state = createFireControlState(pistol)
    let total = 0
    // 3 flancos separados por menos que el intervalo (0.15s): sólo la
    // primera pulsada dispara de inmediato.
    for (let click = 0; click < 3; click++) {
      total += stepFireControl(state, pistol, true, false, DT)
      for (let i = 0; i < Math.round(0.02 / DT); i++) {
        total += stepFireControl(state, pistol, false, false, DT)
      }
    }
    expect(total).toBe(1)
  })
})

describe('modo burst (ar-2)', () => {
  const ar2 = ARCHETYPES['ar-2'] // 360 rpm -> intervalo de ráfaga ~0.1667s

  it('un apretón sostenido dispara exactamente 3 tiros y se detiene solo, aunque se siga sosteniendo', () => {
    const state = createFireControlState(ar2)
    const shots = holdTrigger(state, ar2, 5)
    expect(shots).toBe(3)
  })

  it('hace falta soltar y volver a apretar para la próxima ráfaga', () => {
    const state = createFireControlState(ar2)
    let total = holdTrigger(state, ar2, 5) // primera ráfaga completa: 3
    expect(total).toBe(3)

    // Soltar un rato.
    for (let i = 0; i < Math.round(0.5 / DT); i++) stepFireControl(state, ar2, false, false, DT)

    total += holdTrigger(state, ar2, 5) // segunda ráfaga: 3 más
    expect(total).toBe(6)
  })

  it('el intervalo entre los tres tiros de la ráfaga coincide con fireInterval(ar2)', () => {
    const state = createFireControlState(ar2)
    const interval = fireInterval(ar2)
    const shotTimes: number[] = []
    let t = 0
    for (let i = 0; i < Math.round(2 / DT); i++) {
      const shots = stepFireControl(state, ar2, true, false, DT)
      t += DT
      for (let s = 0; s < shots; s++) shotTimes.push(t)
    }
    expect(shotTimes.length).toBe(3)
    expect(shotTimes[1] - shotTimes[0]).toBeCloseTo(interval, 2)
    expect(shotTimes[2] - shotTimes[1]).toBeCloseTo(interval, 2)
  })
})

describe('recarga', () => {
  const ar1 = ARCHETYPES['ar-1']

  it('bloquea el disparo mientras reloading es true', () => {
    const state = createFireControlState(ar1)
    const shots = stepFireControl(state, ar1, true, true, DT)
    expect(shots).toBe(0)
  })

  it('syncReloadState rellena el cargador al detectar el flanco de fin de recarga', () => {
    const state = createFireControlState(ar1)
    holdTrigger(state, ar1, 1) // gasta munición
    expect(state.ammo).toBeLessThan(ar1.magazine)

    syncReloadState(state, ar1, true) // arranca recarga
    expect(state.ammo).toBeLessThan(ar1.magazine) // todavía no se rellenó
    syncReloadState(state, ar1, false) // termina recarga
    expect(state.ammo).toBe(ar1.magazine)
  })

  it('una recarga cancela una ráfaga o un semi pendientes', () => {
    const ar2 = ARCHETYPES['ar-2']
    const state = createFireControlState(ar2)
    stepFireControl(state, ar2, true, false, DT) // arranca una ráfaga (1 de 3 ya salió)
    expect(state.burstRemaining).toBeGreaterThan(0)

    syncReloadState(state, ar2, true)
    expect(state.burstRemaining).toBe(0)
  })
})

describe('resetFireControl', () => {
  it('vuelve la munición al cargador completo y limpia el estado transitorio', () => {
    const ar1 = ARCHETYPES['ar-1']
    const state = createFireControlState(ar1)
    holdTrigger(state, ar1, 1)
    resetFireControl(state, ar1)
    expect(state.ammo).toBe(ar1.magazine)
    expect(state.burstRemaining).toBe(0)
    expect(state.semiPending).toBe(false)
  })
})
