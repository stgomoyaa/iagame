import { describe, expect, it } from 'vitest'
import { ARENA } from '@/game/map/arena'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import {
  applyHit,
  createDefaultTargetDefs,
  createTargets,
  laneBlocked,
  stepTargets,
  targetHitFlash,
  type TargetDef,
} from '@/game/targets/targets'
import { TARGETS } from '@/game/targets/tuning'

const DT = 1 / 128

describe('laneBlocked: guarda que el corredor de tiro elegido siga libre', () => {
  it('el corredor z=6 usado por createDefaultTargetDefs está libre de cajas del mapa', () => {
    // Rango de altura que cubre torso + cabeza de cualquier diana, y el
    // ancho jugable en X: -28..28, adentro de los muros perimetrales (que
    // ocupan x en [-30,-29] y [29,30], ver map/arena.ts) -- un jugador real
    // nunca camina exactamente contra el muro, la cápsula de colisión ya lo
    // frena antes.
    const bloqueado = laneBlocked(
      ARENA.boxes,
      6,
      TARGETS.torsoRadius,
      1.5 + TARGETS.headOffsetY + TARGETS.headRadius,
      -28,
      28,
    )
    expect(bloqueado).toBe(false)
  })

  it('sanity check de la función: z=0 SÍ está bloqueado por la estructura central', () => {
    const bloqueado = laneBlocked(ARENA.boxes, 0, 1.5, 1.8, -29, 29)
    expect(bloqueado).toBe(true)
  })
})

describe('createDefaultTargetDefs: rango observable de caída de daño', () => {
  it('hay una diana estática a rango óptimo típico y otra más allá del maxRange del AR base', () => {
    const defs = createDefaultTargetDefs()
    const estaticas = defs.filter((d) => d.kind === 'static')
    expect(estaticas.length).toBeGreaterThanOrEqual(2)

    const ar1 = ARCHETYPES['ar-1']
    // Vantage típico: pegado al muro oeste jugable.
    const shooterX = -29
    const distancias = estaticas.map((d) => Math.abs(d.baseX - shooterX)).sort((a, b) => a - b)

    expect(distancias[0]).toBeLessThanOrEqual(ar1.damage.optimalRange)
    expect(distancias[distancias.length - 1]).toBeGreaterThan(ar1.damage.maxRange)
  })
})

describe('createTargets', () => {
  it('produce exactamente 2 hitboxes por diana (torso + cabeza)', () => {
    const state = createTargets(createDefaultTargetDefs())
    expect(state.hitboxes.length).toBe(state.targets.length * 2)
  })

  it('el owner de cada par de hitboxes coincide con el índice de la diana', () => {
    const state = createTargets(createDefaultTargetDefs())
    for (let i = 0; i < state.targets.length; i++) {
      expect(state.hitboxes[i * 2].owner).toBe(i)
      expect(state.hitboxes[i * 2].part).toBe('torso')
      expect(state.hitboxes[i * 2 + 1].owner).toBe(i)
      expect(state.hitboxes[i * 2 + 1].part).toBe('head')
    }
  })

  it('la hitbox de torso comparte el mismo objeto Vec3 que target.position', () => {
    const state = createTargets(createDefaultTargetDefs())
    expect(state.hitboxes[0].center).toBe(state.targets[0].position)
  })

  it('arrancan vivas, con vida completa', () => {
    const state = createTargets(createDefaultTargetDefs())
    for (const t of state.targets) {
      expect(t.alive).toBe(true)
      expect(t.health).toBe(TARGETS.maxHealth)
    }
  })
})

describe('stepTargets: movimiento', () => {
  it('una diana estática (amplitude 0) nunca se mueve en X', () => {
    const defs: TargetDef[] = [
      { kind: 'static', baseX: 5, baseY: 1.5, baseZ: 6, amplitude: 0, speed: 0, phase: 0 },
    ]
    const state = createTargets(defs)
    for (let i = 0; i < 1000; i++) stepTargets(state, DT)
    expect(state.targets[0].position.x).toBe(5)
  })

  it('una diana móvil oscila en X dentro de [baseX - amplitude, baseX + amplitude]', () => {
    const defs: TargetDef[] = [
      { kind: 'moving', baseX: 0, baseY: 1.5, baseZ: 6, amplitude: 6, speed: 1.5, phase: 0 },
    ]
    const state = createTargets(defs)
    let min = Infinity
    let max = -Infinity
    for (let i = 0; i < 5000; i++) {
      stepTargets(state, DT)
      const x = state.targets[0].position.x
      min = Math.min(min, x)
      max = Math.max(max, x)
      expect(x).toBeGreaterThanOrEqual(-6 - 1e-9)
      expect(x).toBeLessThanOrEqual(6 + 1e-9)
    }
    // Con 5000 pasos a velocidad angular 1.5 rad/s y DT=1/128 recorre de
    // sobra varios ciclos completos: tiene que haber llegado cerca de
    // ambos extremos, no quedarse rondando el centro.
    expect(min).toBeLessThan(-5)
    expect(max).toBeGreaterThan(5)
  })

  it('la hitbox de cabeza sigue a la diana desplazada en Y', () => {
    const defs: TargetDef[] = [
      { kind: 'moving', baseX: 0, baseY: 1.5, baseZ: 6, amplitude: 4, speed: 2, phase: 0.3 },
    ]
    const state = createTargets(defs)
    for (let i = 0; i < 50; i++) {
      stepTargets(state, DT)
      const head = state.hitboxes[1]
      expect(head.center.x).toBeCloseTo(state.targets[0].position.x, 9)
      expect(head.center.y).toBeCloseTo(state.targets[0].position.y + TARGETS.headOffsetY, 9)
    }
  })
})

describe('applyHit + respawn', () => {
  it('un impacto que no mata resta vida y no rompe la diana', () => {
    const state = createTargets(createDefaultTargetDefs())
    const murio = applyHit(state, 0, 30)
    expect(murio).toBe(false)
    expect(state.targets[0].alive).toBe(true)
    expect(state.targets[0].health).toBe(TARGETS.maxHealth - 30)
  })

  it('un impacto que baja la vida a 0 o menos rompe la diana y pone sus hitboxes en radio 0', () => {
    const state = createTargets(createDefaultTargetDefs())
    const murio = applyHit(state, 0, TARGETS.maxHealth + 50)
    expect(murio).toBe(true)
    expect(state.targets[0].alive).toBe(false)

    stepTargets(state, DT)
    expect(state.hitboxes[0].radius).toBe(0)
    expect(state.hitboxes[1].radius).toBe(0)
  })

  it('una diana rota reaparece con vida completa después de respawnDelayS', () => {
    const state = createTargets(createDefaultTargetDefs())
    applyHit(state, 0, TARGETS.maxHealth + 10)
    expect(state.targets[0].alive).toBe(false)

    const pasos = Math.ceil((TARGETS.respawnDelayS + 0.1) / DT)
    for (let i = 0; i < pasos; i++) stepTargets(state, DT)

    expect(state.targets[0].alive).toBe(true)
    expect(state.targets[0].health).toBe(TARGETS.maxHealth)
    expect(state.hitboxes[0].radius).toBe(TARGETS.torsoRadius)
  })

  it('impactar una diana ya rota (mientras espera respawn) es un no-op', () => {
    const state = createTargets(createDefaultTargetDefs())
    applyHit(state, 0, TARGETS.maxHealth + 10)
    const murioDeNuevo = applyHit(state, 0, 50)
    expect(murioDeNuevo).toBe(false)
    expect(state.targets[0].health).toBe(0)
  })

  it('un owner fuera de rango no revienta (índice inválido, defensivo)', () => {
    const state = createTargets(createDefaultTargetDefs())
    expect(() => applyHit(state, 999, 10)).not.toThrow()
    expect(applyHit(state, 999, 10)).toBe(false)
  })
})

describe('targetHitFlash', () => {
  it('está en su pico justo después de un impacto', () => {
    const state = createTargets(createDefaultTargetDefs())
    applyHit(state, 0, 10)
    expect(targetHitFlash(state.targets[0])).toBeCloseTo(1, 9)
  })

  it('se apaga a 0 al cumplirse hitFlashDurationS', () => {
    const state = createTargets(createDefaultTargetDefs())
    applyHit(state, 0, 10)
    for (let i = 0; i < Math.ceil((TARGETS.hitFlashDurationS + 0.01) / DT); i++) stepTargets(state, DT)
    expect(targetHitFlash(state.targets[0])).toBe(0)
  })

  it('es monótono no creciente entre un impacto y el siguiente', () => {
    const state = createTargets(createDefaultTargetDefs())
    applyHit(state, 0, 10)
    let prev = targetHitFlash(state.targets[0])
    for (let i = 0; i < 20; i++) {
      stepTargets(state, DT)
      const cur = targetHitFlash(state.targets[0])
      expect(cur).toBeLessThanOrEqual(prev + 1e-9)
      prev = cur
    }
  })
})

describe('presupuesto de asignaciones', () => {
  it('stepTargets no hace crecer el heap de forma sostenida, incluso con impactos y respawns mezclados', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createTargets(createDefaultTargetDefs())

    function frame(i: number): void {
      stepTargets(state, DT)
      if (i % 97 === 0) applyHit(state, i % state.targets.length, 40)
    }

    for (let i = 0; i < 5000; i++) frame(i)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 300_000; i++) frame(i)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1.5)
  })
})
