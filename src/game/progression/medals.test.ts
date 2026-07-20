import { describe, expect, it } from 'vitest'
import {
  acumularMedallas,
  evaluarMedallas,
  MEDALLAS,
  medallasDistintas,
  medallasImplementadas,
} from '@/game/progression/medals'
import type { MatchPerformance } from '@/game/progression/combat-score'

/** Actuación mediocre a propósito: no saca ninguna medalla. Cada test sube
 *  sólo el campo que le interesa, así queda claro qué la disparó. */
function perf(over: Partial<MatchPerformance> = {}): MatchPerformance {
  return {
    kills: 8,
    deaths: 8,
    damage: 1500,
    headshots: 1,
    bestStreak: 2,
    durationS: 360,
    win: true,
    ...over,
  }
}

describe('catálogo de medallas', () => {
  it('tiene las 15 del diseño y ninguna clave repetida', () => {
    expect(MEDALLAS).toHaveLength(15)
    expect(new Set(MEDALLAS.map((m) => m.key)).size).toBe(15)
  })

  // Es la frontera honesta del sistema: si alguien implementa una medalla de
  // eventos y se olvida de cambiar `fuente`, la galería la seguiría
  // mostrando como imposible. Y al revés: marcar una como `actuacion` sin
  // implementarla la haría parecer alcanzable para siempre.
  it('cada medalla marcada como actuación está realmente implementada', () => {
    const implementadas = new Set([
      ...evaluarMedallas(perf({ headshots: 20, kills: 20, deaths: 0, bestStreak: 15, damage: 9000 })),
    ])
    for (const m of MEDALLAS) {
      if (m.fuente === 'actuacion') expect(implementadas.has(m.key)).toBe(true)
      else expect(implementadas.has(m.key)).toBe(false)
    }
  })

  it('medallasImplementadas cuenta las de fuente actuación', () => {
    expect(medallasImplementadas()).toBe(MEDALLAS.filter((m) => m.fuente === 'actuacion').length)
  })
})

describe('evaluación por actuación', () => {
  it('una partida mediocre no saca ninguna', () => {
    expect(evaluarMedallas(perf())).toEqual([])
  })

  it('HEADHUNTER pide 10 headshots, y 9 no alcanzan', () => {
    expect(evaluarMedallas(perf({ kills: 30, headshots: 9 }))).not.toContain('headhunter')
    expect(evaluarMedallas(perf({ kills: 30, headshots: 10 }))).toContain('headhunter')
  })

  it('RACHA e IMPARABLE son acumulativas: una racha de 10 saca las dos', () => {
    const cinco = evaluarMedallas(perf({ bestStreak: 5 }))
    expect(cinco).toContain('racha')
    expect(cinco).not.toContain('racha10')

    const diez = evaluarMedallas(perf({ bestStreak: 10 }))
    expect(diez).toContain('racha')
    expect(diez).toContain('racha10')
  })

  it('INTACTO pide no morir Y haber matado: quedarse quieto no cuenta', () => {
    expect(evaluarMedallas(perf({ deaths: 0, kills: 5 }))).toContain('flawless')
    expect(evaluarMedallas(perf({ deaths: 0, kills: 0 }))).not.toContain('flawless')
  })

  it('PUNTERÍA pide HS% estrictamente sobre 40, y 40 clavado no alcanza', () => {
    expect(evaluarMedallas(perf({ kills: 10, headshots: 4 }))).not.toContain('sharpshooter')
    expect(evaluarMedallas(perf({ kills: 10, headshots: 5 }))).toContain('sharpshooter')
  })

  it('sin bajas no hay HS% que medir: no explota ni la otorga', () => {
    expect(evaluarMedallas(perf({ kills: 0, headshots: 0 }))).not.toContain('sharpshooter')
  })

  it('DEMOLICIÓN pide daño sobre 4000', () => {
    expect(evaluarMedallas(perf({ damage: 4000 }))).not.toContain('demolition')
    expect(evaluarMedallas(perf({ damage: 4001 }))).toContain('demolition')
  })

  it('es determinista: la misma actuación da siempre lo mismo', () => {
    const p = perf({ kills: 20, headshots: 12, deaths: 0, bestStreak: 7, damage: 5000 })
    expect(evaluarMedallas(p)).toEqual(evaluarMedallas(p))
  })
})

describe('acumulado', () => {
  it('suma repeticiones sin mutar el original', () => {
    const previas = { racha: 2 }
    const next = acumularMedallas(previas, ['racha', 'flawless'])
    expect(next).toEqual({ racha: 3, flawless: 1 })
    expect(previas).toEqual({ racha: 2 })
  })

  it('una partida sin medallas devuelve el acumulado tal cual', () => {
    const previas = { racha: 2 }
    expect(acumularMedallas(previas, [])).toBe(previas)
  })

  it('medallasDistintas cuenta claves con al menos una, no el total', () => {
    expect(medallasDistintas({ racha: 9, flawless: 1 })).toBe(2)
    expect(medallasDistintas({})).toBe(0)
  })

  // Una clave que este build no conoce (guardado de otra versión) no debería
  // inflar el contador de la galería.
  it('medallasDistintas ignora claves desconocidas', () => {
    expect(medallasDistintas({ inventada: 5 })).toBe(0)
  })
})
