import { describe, expect, it } from 'vitest'
import { ARCHETYPES, ttkMs, type ArchetypeId, type WeaponArchetype } from '@/game/weapons/archetypes'
import { vec3 } from '@/game/math/vec3'
import { createFireControlState, stepFireControl } from '@/game/combat/fire-control'
import { computeForward, createShotResult, fireShot, MAX_SHOT_DISTANCE } from '@/game/combat/shot'
import type { Hitbox } from '@/game/combat/hitboxes'

describe('computeForward', () => {
  it('pitch=0, yaw=0 mira hacia -Z (convención de Three, YXZ)', () => {
    const out = vec3()
    computeForward(0, 0, out)
    expect(out.x).toBeCloseTo(0, 9)
    expect(out.y).toBeCloseTo(0, 9)
    expect(out.z).toBeCloseTo(-1, 9)
  })

  it('pitch positivo (mirar arriba) da componente Y positiva', () => {
    const out = vec3()
    computeForward(Math.PI / 4, 0, out)
    expect(out.y).toBeGreaterThan(0)
  })

  it('el vector resultante siempre tiene longitud 1 (pitch/yaw arbitrarios)', () => {
    const out = vec3()
    computeForward(0.7, -1.3, out)
    const len = Math.hypot(out.x, out.y, out.z)
    expect(len).toBeCloseTo(1, 9)
  })
})

describe('fireShot: sin nada en el camino, no hay impacto', () => {
  it('un disparo al vacío no impacta dentro de MAX_SHOT_DISTANCE', () => {
    // Apunta hacia arriba, bien lejos de cualquier geometría de la arena
    // (que tiene 6m de alto como techo más alto, sección map/arena.ts).
    const out = createShotResult()
    fireShot(vec3(0, 1.6, -27), Math.PI / 2 - 0.05, 0, 0, 0, ARCHETYPES['ar-1'], [], out)
    expect(out.hit).toBe(false)
  })
})

describe('fireShot: hitbox más cerca que el mapa gana, y viceversa', () => {
  const ar1 = ARCHETYPES['ar-1']

  it('una hitbox interpuesta antes de cualquier pared da el impacto y el daño de esa hitbox', () => {
    const hitboxes: Hitbox[] = [{ center: vec3(0, 1.6, -10), radius: 0.3, part: 'torso', owner: 1 }]
    const out = createShotResult()
    fireShot(vec3(0, 1.6, 0), 0, 0, 0, 0, ar1, hitboxes, out)

    expect(out.hit).toBe(true)
    expect(out.part).toBe('torso')
    expect(out.damage).toBeGreaterThan(0)
    expect(out.distance).toBeLessThan(11)
  })

  it('sin hitboxes de por medio, un disparo dentro de la arena le pega al mapa (daño 0, sin objetivo)', () => {
    // Mirando hacia abajo desde 5m de altura: le pega al piso sí o sí.
    const out = createShotResult()
    fireShot(vec3(0, 5, 0), -(Math.PI / 2 - 0.01), 0, 0, 0, ar1, [], out)
    expect(out.hit).toBe(true)
    expect(out.part).toBe('none')
    expect(out.damage).toBe(0)
  })
})

// Los dos arquetipos de un solo tiro (sección 5 del spec): TTK=0 por
// definición, ver archetypes.test.ts. No entran en la banda 250-400ms a
// propósito, así que quedan fuera de este recorrido end-to-end.
const ONE_SHOT_ARCHETYPES: ArchetypeId[] = ['sniper-bolt', 'shotgun']

describe('TTK de punta a punta: fire-control real + hitscan + daño, no la fórmula sola', () => {
  const HEALTH = 100
  const DT = 1 / 2000 // paso bien chico: nunca más de un disparo por paso en este arsenal

  /**
   * Simula un jugador sosteniendo el gatillo contra un torso a rango
   * óptimo, usando el mismo fire-control y la misma resolución de disparo
   * que game.ts va a usar en producción (no ttkMs() directo): mide cuánto
   * tarda en bajar `HEALTH` puntos de vida.
   */
  function simulateTtkMs(archetype: WeaponArchetype): number {
    const fireControl = createFireControlState(archetype)
    const distance = archetype.damage.optimalRange
    // y=10: por encima de toda la geometría de la arena (el muro más alto
    // llega a WALL_H=6, ver map/arena.ts), así el rayo horizontal no le
    // pega a ningún muro antes de llegar a la hitbox — algunos arquetipos
    // (ar-3, sniper-marksman, sniper-bolt) tienen optimalRange más grande
    // que medio lado de la arena (HALF=30), así que a la altura normal de
    // juego el muro perimetral se interpondría antes de llegar al objetivo.
    const hitboxes: Hitbox[] = [{ center: vec3(0, 10, -distance), radius: 5, part: 'torso', owner: 1 }]
    const out = createShotResult()
    const origin = vec3(0, 10, 0)

    let health = HEALTH
    let elapsedMs = 0
    let firstShotMs: number | null = null
    let lastShotMs = 0

    // Cota de seguridad: nunca debería hacer falta más que un cargador
    // entero para vaciar 100 de vida a un torso, a rango óptimo.
    const maxIterations = Math.ceil((archetype.magazine * 2) / archetype.fireRate) * 60000 / DT

    for (let i = 0; i < maxIterations && health > 0; i++) {
      // Alterna sostener/soltar cada paso: para 'auto' y 'burst' sostener
      // fijo ya alcanza, pero 'semi' (pistol, sniper-marksman acá) sólo
      // dispara en el FLANCO de apretar (ver fire-control.ts) — sin soltar
      // entre medio, nunca se rearma un segundo disparo. Alternar cada DT
      // (mucho más rápido que cualquier intervalo del arsenal) simula un
      // jugador clickeando al máximo posible sin cambiar el resultado de
      // 'auto'/'burst': el acumulador de cadencia sigue siendo el único que
      // decide cuándo sale cada tiro.
      const triggerHeld = i % 2 === 0
      const shots = stepFireControl(fireControl, archetype, triggerHeld, false, DT)
      elapsedMs += DT * 1000
      for (let s = 0; s < shots; s++) {
        fireShot(origin, 0, 0, 0, 0, archetype, hitboxes, out)
        if (out.hit && out.part !== 'none') {
          health -= out.damage
          if (firstShotMs === null) firstShotMs = elapsedMs
          lastShotMs = elapsedMs
        }
      }
    }

    expect(health, `${archetype.id}: se quedó sin munición o sin iteraciones antes de matar`).toBeLessThanOrEqual(0)
    return lastShotMs - (firstShotMs ?? 0)
  }

  it('los arquetipos de más de un disparo matan un torso a rango óptimo en 250-400ms, medido end-to-end', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      if (ONE_SHOT_ARCHETYPES.includes(id)) continue
      const archetype = ARCHETYPES[id]
      const ttk = simulateTtkMs(archetype)
      expect(ttk, `${id}: ttk medido=${ttk.toFixed(1)}ms`).toBeGreaterThanOrEqual(250 - 1)
      expect(ttk, `${id}: ttk medido=${ttk.toFixed(1)}ms`).toBeLessThanOrEqual(400 + 1)
    }
  })

  it('el TTK medido end-to-end coincide con ttkMs() de archetypes.ts (misma cadencia, mismo daño)', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      if (ONE_SHOT_ARCHETYPES.includes(id)) continue
      const archetype = ARCHETYPES[id]
      const medido = simulateTtkMs(archetype)
      const formula = ttkMs(archetype, HEALTH)
      // Tolerancia de unos pocos DT: el fire-control discretiza el tiempo
      // en pasos de DT=0.5ms (la fórmula es continua), y el error puede
      // acumularse a razón de hasta un DT por disparo hasta matar (hasta 6
      // disparos en este arsenal) — 3.5ms deja margen sobre ese peor caso
      // sin dejar de detectar un desvío real de un intervalo entero
      // (decenas de ms en cualquier arquetipo).
      expect(Math.abs(medido - formula), `${id}: medido=${medido}, fórmula=${formula}`).toBeLessThanOrEqual(3.5)
    }
  })

  it('los arquetipos de un solo tiro matan al primer disparo (torso, rango óptimo) — TTK=0 por definición', () => {
    for (const id of ONE_SHOT_ARCHETYPES) {
      const archetype = ARCHETYPES[id]
      // y=10 por la misma razón que simulateTtkMs: sniper-bolt tiene
      // optimalRange=60m, más que medio lado de la arena.
      const hitboxes: Hitbox[] = [
        { center: vec3(0, 10, -archetype.damage.optimalRange), radius: 5, part: 'torso', owner: 1 },
      ]
      const out = createShotResult()
      fireShot(vec3(0, 10, 0), 0, 0, 0, 0, archetype, hitboxes, out)
      expect(out.damage, id).toBeGreaterThanOrEqual(HEALTH)
    }
  })
})

describe('MAX_SHOT_DISTANCE cubre el arsenal entero', () => {
  it('supera el maxRange de todos los arquetipos', () => {
    for (const a of Object.values(ARCHETYPES)) {
      expect(MAX_SHOT_DISTANCE).toBeGreaterThan(a.damage.maxRange)
    }
  })
})
