/**
 * Tests de la propiedad que de verdad importa del sistema de rangos: que la
 * escalera **converja donde corresponde**.
 *
 * Los tests de rr.test.ts verifican la aritmética término por término y aun
 * así no dirían nada si el sistema completo mandara a todo el mundo a
 * Radiante. Eso sólo se ve corriendo carreras enteras, que es lo que hace
 * este archivo con el mismo `applyMatchResult` que usa el juego.
 *
 * Se verifican propiedades gruesas y con margen ancho, nunca números
 * exactos: el simulador es un modelo, y un test que fijara "habilidad 0.5
 * termina en el rango 12" se rompería con cualquier retoque de tuneo sin que
 * nada esté mal de verdad. Lo que no puede cambiar es el ORDEN y que nadie
 * termine pegado a los extremos.
 */

import { describe, expect, it } from 'vitest'
import { ajustarRecta, medirParejos, simulateCareer, simulateMatch, createRandom } from '@/game/progression/simulate'
import { expectedCombatScore } from '@/game/progression/combat-score'
import { RANK_MAX } from '@/game/progression/ranks'

const PARTIDAS = 60

describe('convergencia de la escalera', () => {
  it('un jugador de habilidad media termina cerca del medio, no en un extremo', () => {
    const r = simulateCareer(0.5, PARTIDAS, 0x1234)
    expect(r.rankEstacionario).toBeGreaterThan(RANK_MAX * 0.3)
    expect(r.rankEstacionario).toBeLessThan(RANK_MAX * 0.7)
  })

  // La falla clásica de un sistema de RR mal calibrado: todos terminan
  // arriba, o todos terminan abajo.
  it('ni el mejor jugador ni el peor arrastran a todos al mismo lugar', () => {
    const malo = simulateCareer(0.1, PARTIDAS, 0xaaa)
    const bueno = simulateCareer(0.9, PARTIDAS, 0xbbb)
    expect(malo.rankEstacionario).toBeLessThan(RANK_MAX * 0.35)
    expect(bueno.rankEstacionario).toBeGreaterThan(RANK_MAX * 0.6)
  })

  it('mas habilidad siempre termina en mas rango', () => {
    const niveles = [0.05, 0.25, 0.45, 0.65, 0.85]
    const finales = niveles.map((s) => simulateCareer(s, PARTIDAS, 0x77 + Math.round(s * 1000)).rankEstacionario)
    for (let i = 1; i < finales.length; i++) {
      expect(finales[i], `habilidad ${niveles[i]} vs ${niveles[i - 1]}`).toBeGreaterThan(finales[i - 1])
    }
  })

  it('el rango estacionario queda cerca del teorico, no a varios tiers', () => {
    for (const skill of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      const r = simulateCareer(skill, PARTIDAS, 0x900 + Math.round(skill * 100))
      // 3 rangos = una división de margen. Más que eso significaría que el
      // sistema coloca sistemáticamente mal.
      expect(Math.abs(r.rankEstacionario - r.rankTeorico), `habilidad ${skill}`).toBeLessThan(3)
    }
  })

  it('el jugador ya estacionado gana alrededor de la mitad de sus partidas', () => {
    // Es la señal de que la dificultad de bots quedó calibrada a su nivel:
    // si ganara el 90% estaría colocado demasiado abajo.
    const r = simulateCareer(0.5, 300, 0x5150, 300)
    const tasa = r.victorias / (r.victorias + r.derrotas)
    expect(tasa).toBeGreaterThan(0.38)
    expect(tasa).toBeLessThan(0.62)
  })

  it('es determinista: la misma semilla da la misma carrera', () => {
    const a = simulateCareer(0.6, 40, 0xfeed)
    const b = simulateCareer(0.6, 40, 0xfeed)
    expect(a.rankFinal).toBe(b.rankFinal)
    expect(a.samples).toEqual(b.samples)
  })
})

describe('calibracion de expectedCombatScore', () => {
  // Si esto se desalinea, el sistema empieza a premiar o castigar por el
  // solo hecho de estar en cierto rango, que es exactamente lo que
  // `expected` existe para evitar.
  it('sigue de cerca lo que rinde un enfrentamiento parejo en toda la escalera', () => {
    for (const p of medirParejos(300, 0xc0ffee)) {
      const diff = Math.abs(p.media - expectedCombatScore(p.difficulty))
      expect(diff, `dificultad ${p.difficulty.toFixed(2)}`).toBeLessThan(6)
    }
  })

  it('la recta ajustada coincide con la que esta codificada', () => {
    const recta = ajustarRecta(medirParejos(300, 0xc0ffee))
    expect(recta.base).toBeCloseTo(expectedCombatScore(0), 0)
    expect(recta.base + recta.pendiente).toBeCloseTo(expectedCombatScore(1), 0)
  })

  it('un enfrentamiento parejo da delta cercano a cero en todo rango', () => {
    // La propiedad que hace que promocionar no se sienta un castigo: contra
    // bots que escalan con vos, el delta no se hunde al subir.
    for (const p of medirParejos(300, 0x2244)) {
      expect(Math.abs(p.media - expectedCombatScore(p.difficulty)) / p.media).toBeLessThan(0.06)
    }
  })
})

describe('modelo del jugador sintetico', () => {
  it('mas ventaja produce mejores numeros', () => {
    const rand = createRandom(0x31)
    let killsFacil = 0
    let killsDificil = 0
    for (let i = 0; i < 200; i++) {
      killsFacil += simulateMatch(0.8, 0.2, rand).kills
      killsDificil += simulateMatch(0.2, 0.8, rand).kills
    }
    expect(killsFacil).toBeGreaterThan(killsDificil)
  })

  it('un enfrentamiento parejo se gana alrededor de la mitad de las veces', () => {
    const rand = createRandom(0x99)
    let victorias = 0
    const n = 2000
    for (let i = 0; i < n; i++) if (simulateMatch(0.5, 0.5, rand).win) victorias++
    expect(victorias / n).toBeGreaterThan(0.45)
    expect(victorias / n).toBeLessThan(0.55)
  })
})
