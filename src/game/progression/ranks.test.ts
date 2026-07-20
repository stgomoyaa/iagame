import { describe, expect, it } from 'vitest'
import {
  difficultyForRank,
  RANK_COUNT,
  RANK_MAX,
  RANK_MIN,
  rankColor,
  rankForDifficulty,
  rankIndex,
  rankLabel,
  rankName,
  TIERS,
} from '@/game/progression/ranks'

describe('escalera de rangos', () => {
  it('tiene los 9 tiers del spec en orden', () => {
    expect(TIERS).toEqual([
      'Hierro',
      'Bronce',
      'Plata',
      'Oro',
      'Platino',
      'Diamante',
      'Master',
      'Grand Master',
      'Deidad',
    ])
  })

  it('son 25 rangos: 8 tiers de 3 divisiones mas Deidad', () => {
    expect(RANK_COUNT).toBe(25)
    expect(RANK_MIN).toBe(0)
    expect(RANK_MAX).toBe(24)
  })

  it('el primer rango es Hierro 1 y el ultimo es Deidad sin division', () => {
    expect(rankLabel(RANK_MIN)).toBe('Hierro 1')
    expect(rankName(RANK_MAX)).toEqual({ tier: 'Deidad', division: 0, label: 'Deidad' })
  })

  it('las divisiones van 1..3 y encadenan de un tier al siguiente', () => {
    expect(rankLabel(0)).toBe('Hierro 1')
    expect(rankLabel(2)).toBe('Hierro 3')
    expect(rankLabel(3)).toBe('Bronce 1')
    expect(rankLabel(23)).toBe('Grand Master 3')
  })

  it('rankIndex es la inversa de rankName', () => {
    for (let i = 0; i < RANK_COUNT; i++) {
      const n = rankName(i)
      expect(rankIndex(n.tier, n.division), `rango ${i}`).toBe(i)
    }
  })

  it('rankIndex rechaza un tier que no existe', () => {
    expect(() => rankIndex('Cobre', 1)).toThrow()
  })

  // La conexión con bots/difficulty.ts: los extremos tienen que caer exacto
  // en la tabla del spec (400ms/6.0° y 120ms/0.7°), no cerca.
  it('la dificultad va de 0 en Hierro 1 a 1 en Deidad', () => {
    expect(difficultyForRank(RANK_MIN)).toBe(0)
    expect(difficultyForRank(RANK_MAX)).toBe(1)
  })

  it('la dificultad crece de forma estricta con el rango', () => {
    for (let i = 1; i < RANK_COUNT; i++) {
      expect(difficultyForRank(i)).toBeGreaterThan(difficultyForRank(i - 1))
    }
  })

  it('rankForDifficulty es la inversa de difficultyForRank', () => {
    for (let i = 0; i < RANK_COUNT; i++) {
      expect(rankForDifficulty(difficultyForRank(i))).toBe(i)
    }
  })

  it('clampea indices fuera de rango en vez de inventar tiers', () => {
    expect(rankLabel(-5)).toBe('Hierro 1')
    expect(rankLabel(999)).toBe('Deidad')
    expect(rankLabel(Number.NaN)).toBe('Hierro 1')
    expect(difficultyForRank(-1)).toBe(0)
    expect(difficultyForRank(99)).toBe(1)
    expect(rankForDifficulty(-3)).toBe(RANK_MIN)
    expect(rankForDifficulty(7)).toBe(RANK_MAX)
    expect(rankForDifficulty(Number.NaN)).toBe(RANK_MIN)
  })

  it('todos los rangos tienen color', () => {
    for (let i = 0; i < RANK_COUNT; i++) {
      expect(rankColor(i), `rango ${i}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})
