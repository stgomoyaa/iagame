import { describe, expect, it } from 'vitest'
import {
  ANCLAS,
  OPTICAS,
  OPTICAS_ORDEN,
  anclaDe,
  armaPuedeMontarOptica,
  opticaDef,
  opticaDesbloqueada,
  opticasDesbloqueadas,
  type OpticaId,
} from '@/game/weapons/attachments/optics-catalog'
import { xpParaNivelArma } from '@/game/progression/weapon-xp'

describe('catálogo de ópticas', () => {
  it('cada def es coherente: id == glbSlug, nivel en 2..5, lente de 3 ejes', () => {
    for (const id of OPTICAS_ORDEN) {
      const def = OPTICAS[id]
      expect(def.id).toBe(id)
      expect(def.glbSlug).toBe(id)
      expect(def.nivelDesbloqueo).toBeGreaterThanOrEqual(2)
      expect(def.nivelDesbloqueo).toBeLessThanOrEqual(5)
      expect(def.lente).toHaveLength(3)
      expect(def.reticula.ladoMundo).toBeGreaterThan(0)
    }
  })

  it('el orden lista exactamente las 6 ópticas, sin repetir', () => {
    expect(new Set(OPTICAS_ORDEN).size).toBe(6)
    expect(Object.keys(OPTICAS).sort()).toEqual([...OPTICAS_ORDEN].sort())
  })

  it('opticaDef devuelve la definición pedida', () => {
    expect(opticaDef('optic_acog').categoria).toBe('magnificada')
    expect(opticaDef('optic_reddot_m68').categoria).toBe('red_dot')
  })
})

describe('anclaje por arma', () => {
  it('las 5 armas de ejemplo tienen ancla con rotación base +90°Y y escala > 0', () => {
    const armas = Object.keys(ANCLAS)
    expect(armas.length).toBeGreaterThanOrEqual(5)
    for (const slug of armas) {
      const a = anclaDe(slug)
      expect(a, slug).not.toBeNull()
      expect(a!.pos).toHaveLength(3)
      // La Y del ancla es positiva: la óptica va ARRIBA del arma, no debajo.
      expect(a!.pos[1], `${slug} Y`).toBeGreaterThan(0)
      expect(a!.rot[1]).toBeCloseTo(Math.PI / 2, 5)
      expect(a!.escala).toBeGreaterThan(0)
    }
  })

  it('un arma sin ancla no puede montar óptica todavía', () => {
    expect(anclaDe('cod4_m9')).toBeNull()
    expect(armaPuedeMontarOptica('cod4_m9')).toBe(false)
    expect(armaPuedeMontarOptica('cod4_ak47')).toBe(true)
  })
})

describe('desbloqueo por nivel de arma', () => {
  // Umbrales de XP para cada nivel, de weapon-xp.ts (no se copian: se importan).
  const xpNivel = (n: number): number => xpParaNivelArma(n)

  it('un arma sin XP (nivel 1) no tiene ninguna óptica', () => {
    expect(opticasDesbloqueadas(0)).toEqual([])
    expect(opticasDesbloqueadas(xpNivel(2) - 1)).toEqual([])
  })

  it('la escalera de niveles va sumando ópticas', () => {
    const enNivel2 = opticasDesbloqueadas(xpNivel(2))
    expect(enNivel2).toContain('optic_reddot_m68')
    expect(enNivel2).toContain('optic_reflex_mw3')
    expect(enNivel2).not.toContain('optic_acog')

    const enNivel3 = opticasDesbloqueadas(xpNivel(3))
    expect(enNivel3).toContain('optic_holo_eotech')
    expect(enNivel3).not.toContain('optic_acog')

    const enNivel4 = opticasDesbloqueadas(xpNivel(4))
    expect(enNivel4).toContain('optic_acog')
    expect(enNivel4).not.toContain('optic_hamr')

    const enNivel5 = opticasDesbloqueadas(xpNivel(5))
    expect(enNivel5).toHaveLength(6)
  })

  it('la lista sólo crece con el nivel (monotonía)', () => {
    let previa = 0
    for (const n of [1, 2, 3, 4, 5]) {
      const count = opticasDesbloqueadas(xpNivel(n)).length
      expect(count).toBeGreaterThanOrEqual(previa)
      previa = count
    }
  })

  it('opticaDesbloqueada concuerda con opticasDesbloqueadas', () => {
    const xp = xpNivel(3)
    const lista = new Set<OpticaId>(opticasDesbloqueadas(xp))
    for (const id of OPTICAS_ORDEN) {
      expect(opticaDesbloqueada(id, xp)).toBe(lista.has(id))
    }
  })

  it('XP basura (NaN, negativo) no desbloquea nada', () => {
    expect(opticasDesbloqueadas(Number.NaN)).toEqual([])
    expect(opticasDesbloqueadas(-500)).toEqual([])
  })
})
