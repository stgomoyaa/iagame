import { afterEach, describe, expect, it, vi } from 'vitest'
import { esModoPractica } from '@/game/targets/practica'

/**
 * `esModoPractica()` lee `window.location.search`, y el entorno de estos
 * tests es 'node' (vitest.config.ts): no hay `window`. Se instala uno
 * mínimo con sólo lo que la función toca, en vez de mover todo el archivo a
 * jsdom -- el módulo lee UN string, no necesita un DOM.
 */
function conQuery(search: string): void {
  vi.stubGlobal('window', { location: { search } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('modo práctica (`?practica=`)', () => {
  it('sin el parámetro es partida normal: no hay dianas', () => {
    conQuery('')
    expect(esModoPractica()).toBe(false)
  })

  it('convive con los otros parámetros de la URL', () => {
    conQuery('?map=arena&practica=1&bots=3')
    expect(esModoPractica()).toBe(true)
  })

  for (const valor of ['1', 'true', 'si', 'sí', 'TRUE', 'Si']) {
    it(`\`?practica=${valor}\` entra al modo práctica`, () => {
      conQuery(`?practica=${valor}`)
      expect(esModoPractica()).toBe(true)
    })
  }

  // El caso que importa de verdad: una URL ambigua NO puede terminar en una
  // partida con dianas azules mezcladas con los bots. Ante la duda, partida
  // limpia.
  for (const valor of ['0', 'false', 'no', '', 'quizas']) {
    it(`\`?practica=${valor}\` NO entra al modo práctica`, () => {
      conQuery(`?practica=${valor}`)
      expect(esModoPractica()).toBe(false)
    })
  }
})
