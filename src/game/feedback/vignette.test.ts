import { describe, expect, it } from 'vitest'
import {
  createVignetteState,
  directionYaw,
  spawnVignette,
  stepVignette,
  vignetteBearing,
  vignetteOpacity,
  vignettePeakOpacity,
} from '@/game/feedback/vignette'
import { FEEDBACK } from '@/game/feedback/tuning'

describe('directionYaw + vignetteBearing', () => {
  it('daño desde adelante (misma dirección que mira el jugador): bearing 0', () => {
    const playerYaw = 0.4
    // El jugador mira hacia computeForward(0, playerYaw); un origen de daño
    // en esa misma dirección tiene sourceYawWorld === playerYaw.
    const bearing = vignetteBearing(playerYaw, playerYaw)
    expect(bearing).toBeCloseTo(0, 9)
  })

  it('daño desde atrás: bearing +-PI', () => {
    const playerYaw = 0
    const sourceYaw = directionYaw(0, 1) // +Z, detrás de la cámara en yaw=0 (forward es -Z)
    const bearing = vignetteBearing(playerYaw, sourceYaw)
    expect(Math.abs(bearing)).toBeCloseTo(Math.PI, 9)
  })

  it('daño desde la derecha del jugador da bearing negativo (misma convención de yaw que engine/input.ts)', () => {
    const playerYaw = 0
    const sourceYaw = directionYaw(1, 0) // +X: a la derecha cuando yaw=0 mira hacia -Z
    const bearing = vignetteBearing(playerYaw, sourceYaw)
    expect(bearing).toBeLessThan(0)
  })

  it('daño desde la izquierda del jugador da bearing positivo', () => {
    const playerYaw = 0
    const sourceYaw = directionYaw(-1, 0)
    const bearing = vignetteBearing(playerYaw, sourceYaw)
    expect(bearing).toBeGreaterThan(0)
  })

  it('el bearing sigue al jugador: girar 90° convierte "de frente" en "de la derecha" o "de la izquierda"', () => {
    const sourceYaw = 0 // el origen del daño está fijo en el mundo, mirando hacia -Z desde el origen
    const deFrente = vignetteBearing(0, sourceYaw)
    const girado = vignetteBearing(Math.PI / 2, sourceYaw)
    expect(deFrente).toBeCloseTo(0, 9)
    expect(Math.abs(girado)).toBeCloseTo(Math.PI / 2, 9)
  })

  it('vignetteBearing siempre devuelve un ángulo normalizado en (-PI, PI]', () => {
    for (let a = -20; a <= 20; a += 0.7) {
      const b = vignetteBearing(a, -a * 3)
      expect(b).toBeGreaterThan(-Math.PI - 1e-9)
      expect(b).toBeLessThanOrEqual(Math.PI + 1e-9)
    }
  })
})

describe('vignettePeakOpacity', () => {
  it('daño 0 da la opacidad base, no 0 (el flash siempre se nota algo)', () => {
    expect(vignettePeakOpacity(0)).toBeCloseTo(FEEDBACK.vignetteBaseOpacity, 9)
  })
  it('satura en vignetteMaxOpacity', () => {
    expect(vignettePeakOpacity(FEEDBACK.vignetteDamageForMaxOpacity * 3)).toBeCloseTo(
      FEEDBACK.vignetteMaxOpacity,
      9,
    )
  })
  it('es monótona no decreciente en el daño', () => {
    let prev = vignettePeakOpacity(0)
    for (let d = 1; d <= 80; d++) {
      const cur = vignettePeakOpacity(d)
      expect(cur).toBeGreaterThanOrEqual(prev - 1e-9)
      prev = cur
    }
  })
})

describe('vignetteOpacity: apagado lineal', () => {
  it('arranca en el pico', () => {
    expect(vignetteOpacity(0, 0.5, 0.6)).toBeCloseTo(0.5, 9)
  })
  it('llega a 0 al final de la duración', () => {
    expect(vignetteOpacity(0.6, 0.5, 0.6)).toBeCloseTo(0, 9)
  })
  it('es monótona no creciente', () => {
    let prev = vignetteOpacity(0, 0.5, 0.6)
    for (let t = 0; t <= 0.6; t += 0.02) {
      const cur = vignetteOpacity(t, 0.5, 0.6)
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      prev = cur
    }
  })
})

describe('pool de flashes de viñeta', () => {
  it('varios golpes desde direcciones distintas conviven activos a la vez', () => {
    const state = createVignetteState()
    spawnVignette(state, 0, 10)
    spawnVignette(state, Math.PI, 20)
    const activos = state.pool.items.filter((e) => e.active)
    expect(activos.length).toBe(2)
  })

  it('stepVignette desactiva un flash al cumplir su duración', () => {
    const state = createVignetteState()
    spawnVignette(state, 0, 10)
    stepVignette(state, FEEDBACK.vignetteDurationS + 0.01)
    expect(state.pool.items.some((e) => e.active)).toBe(false)
  })

  it('agotar el pool recicla el flash más viejo, nunca crece', () => {
    const state = createVignetteState()
    for (let i = 0; i < FEEDBACK.vignettePoolSize + 4; i++) spawnVignette(state, i, 10)
    expect(state.pool.items.length).toBe(FEEDBACK.vignettePoolSize)
  })

  it('cero asignaciones: miles de spawn/step no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')
    const state = createVignetteState()

    for (let i = 0; i < 2000; i++) {
      spawnVignette(state, i % 4, 15)
      stepVignette(state, 0.001)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 200_000; i++) {
      spawnVignette(state, i % 4, 15)
      stepVignette(state, 0.001)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
