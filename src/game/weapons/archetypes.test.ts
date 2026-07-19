import { describe, expect, it } from 'vitest'
import {
  ARCHETYPE_LIST,
  ARCHETYPES,
  damageAtRange,
  generateRecoilPattern,
  recoilOffsetForShot,
  shotsToKill,
  ttkMs,
  type ArchetypeId,
} from '@/game/weapons/archetypes'

const HEALTH = 100

// Los dos arquetipos de un solo tiro a rango óptimo: la sección 5 del spec
// los llama explícitamente "instantáneo" (francotirador) y "a quemarropa"
// (escopeta). Su TTK da 0ms por fórmula, fuera de la banda 250-400ms, y eso
// es correcto: no son un caso que "no dio" el balance, son la excepción que
// el propio spec documenta.
const ONE_SHOT_ARCHETYPES: ArchetypeId[] = ['sniper-bolt', 'shotgun']

describe('arquetipos: catálogo', () => {
  it('hay exactamente 10 arquetipos', () => {
    expect(ARCHETYPE_LIST.length).toBe(10)
  })

  it('cada arquetipo tiene magazine, fireRate y daño positivos', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(a.magazine).toBeGreaterThan(0)
      expect(a.fireRate).toBeGreaterThan(0)
      expect(a.damage.base).toBeGreaterThan(0)
    }
  })

  it('id del arquetipo coincide con la clave con la que está registrado', () => {
    for (const [key, archetype] of Object.entries(ARCHETYPES)) {
      expect(archetype.id).toBe(key)
    }
  })
})

describe('TTK: banda 250-400ms a rango óptimo (sección 5 del spec)', () => {
  const multiShot = ARCHETYPE_LIST.filter((a) => !ONE_SHOT_ARCHETYPES.includes(a.id))

  it('los arquetipos de más de un disparo caen dentro de la banda, calculado, no hardcodeado', () => {
    for (const a of multiShot) {
      const ttk = ttkMs(a, HEALTH)
      expect(ttk, `${a.id}: ttk=${ttk}`).toBeGreaterThanOrEqual(250)
      expect(ttk, `${a.id}: ttk=${ttk}`).toBeLessThanOrEqual(400)
    }
  })

  it('los arquetipos de un solo tiro matan en 1 disparo a rango óptimo (TTK=0, fuera de la banda a propósito)', () => {
    for (const id of ONE_SHOT_ARCHETYPES) {
      const a = ARCHETYPES[id]
      expect(shotsToKill(a, HEALTH, a.damage.optimalRange)).toBe(1)
      expect(ttkMs(a, HEALTH)).toBe(0)
    }
  })

  it('AR 1 reproduce el ejemplo exacto del spec: 24 daño / 600 RPM -> 5 disparos, 400ms', () => {
    const ar1 = ARCHETYPES['ar-1']
    expect(ar1.damage.base).toBe(24)
    expect(ar1.fireRate).toBe(600)
    expect(shotsToKill(ar1, HEALTH, ar1.damage.optimalRange)).toBe(5)
    expect(ttkMs(ar1, HEALTH)).toBe(400)
  })

  it('SMG 1 reproduce el ejemplo exacto del spec: 18 daño / 850 RPM -> 6 disparos, ~353ms', () => {
    const smg1 = ARCHETYPES['smg-1']
    expect(smg1.damage.base).toBe(18)
    expect(smg1.fireRate).toBe(850)
    expect(shotsToKill(smg1, HEALTH, smg1.damage.optimalRange)).toBe(6)
    expect(ttkMs(smg1, HEALTH)).toBeCloseTo(352.94, 1)
  })

  it('sniper-bolt reproduce el ejemplo exacto del spec: 110 de cuerpo es un solo tiro', () => {
    const bolt = ARCHETYPES['sniper-bolt']
    expect(bolt.damage.base).toBe(110)
    expect(shotsToKill(bolt, HEALTH, bolt.damage.optimalRange)).toBe(1)
  })

  it('la escopeta reproduce el ejemplo exacto del spec: 8 pellets x 14 = 112, un tiro a quemarropa', () => {
    const shotgun = ARCHETYPES.shotgun
    expect(shotgun.damage.base).toBe(8 * 14)
    expect(shotsToKill(shotgun, HEALTH, shotgun.damage.optimalRange)).toBe(1)
  })
})

describe('caída de daño por distancia', () => {
  it('nunca sube con la distancia, para ningún arquetipo', () => {
    for (const a of ARCHETYPE_LIST) {
      const { optimalRange, maxRange } = a.damage
      const distancias = [
        0,
        optimalRange / 2,
        optimalRange,
        optimalRange + (maxRange - optimalRange) / 4,
        (optimalRange + maxRange) / 2,
        maxRange,
        maxRange * 1.5,
        maxRange * 3,
      ]
      let anterior = Infinity
      for (const d of distancias) {
        const dmg = damageAtRange(a, d)
        expect(dmg, `${a.id} en ${d}m: ${dmg} > anterior ${anterior}`).toBeLessThanOrEqual(anterior)
        anterior = dmg
      }
    }
  })

  it('el daño es completo hasta optimalRange y nunca baja del piso más allá de maxRange', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(damageAtRange(a, a.damage.optimalRange)).toBe(a.damage.base)
      expect(damageAtRange(a, 0)).toBe(a.damage.base)
      const piso = a.damage.base * a.damage.minMultiplier
      expect(damageAtRange(a, a.damage.maxRange)).toBeCloseTo(piso, 9)
      expect(damageAtRange(a, a.damage.maxRange * 5)).toBeCloseTo(piso, 9)
    }
  })
})

describe('retroceso: determinismo y cobertura del cargador', () => {
  it('generateRecoilPattern es determinista: misma seed, mismo patrón, siempre', () => {
    const a = generateRecoilPattern(4242, 20, 1.5, 0.6, 0.1)
    const b = generateRecoilPattern(4242, 20, 1.5, 0.6, 0.1)
    expect(a).toEqual(b)
  })

  it('seeds distintas producen patrones distintos', () => {
    const a = generateRecoilPattern(1, 10, 1, 0.5, 0.1)
    const b = generateRecoilPattern(2, 10, 1, 0.5, 0.1)
    expect(a).not.toEqual(b)
  })

  it('todo arquetipo tiene un patrón no vacío', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(a.recoil.pattern.length).toBeGreaterThan(0)
    }
  })

  it('recoilOffsetForShot devuelve un offset definido para cada disparo del cargador completo', () => {
    for (const a of ARCHETYPE_LIST) {
      for (let shot = 0; shot < a.magazine; shot++) {
        const [x, y] = recoilOffsetForShot(a, shot)
        expect(Number.isFinite(x), `${a.id} disparo ${shot}: x`).toBe(true)
        expect(Number.isFinite(y), `${a.id} disparo ${shot}: y`).toBe(true)
      }
    }
  })

  it('cuando el patrón es más corto que el cargador, se repite (wrap) exacto cada pattern.length disparos', () => {
    // smg-1: patrón de 12 entradas, cargador de 30. El disparo 12 tiene que
    // dar exactamente el mismo offset que el disparo 0, y el 13 el mismo
    // que el 1: eso es la decisión de wrap documentada en recoilOffsetForShot.
    const smg1 = ARCHETYPES['smg-1']
    expect(smg1.recoil.pattern.length).toBeLessThan(smg1.magazine)
    expect(recoilOffsetForShot(smg1, 12)).toEqual(recoilOffsetForShot(smg1, 0))
    expect(recoilOffsetForShot(smg1, 13)).toEqual(recoilOffsetForShot(smg1, 1))
    expect(recoilOffsetForShot(smg1, 29)).toEqual(recoilOffsetForShot(smg1, 29 % 12))
  })

  it('la LMG (cargador de 100, patrón de 20) envuelve varias veces sin quedar indefinida', () => {
    const lmg = ARCHETYPES.lmg
    expect(lmg.recoil.pattern.length).toBeLessThan(lmg.magazine)
    expect(recoilOffsetForShot(lmg, 99)).toBeDefined()
    expect(recoilOffsetForShot(lmg, 20)).toEqual(recoilOffsetForShot(lmg, 0))
    expect(recoilOffsetForShot(lmg, 40)).toEqual(recoilOffsetForShot(lmg, 0))
  })

  it('cuando el patrón cubre el cargador entero, no necesita envolver dentro de una sola carga', () => {
    // pistola: patrón de 12, cargador de 12. Cada disparo de la carga tiene
    // un offset propio, sin repetición hasta la carga siguiente.
    const pistol = ARCHETYPES.pistol
    expect(pistol.recoil.pattern.length).toBe(pistol.magazine)
  })
})
