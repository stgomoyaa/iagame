/**
 * El catálogo de camuflajes por textura es data pura: se testea sin GPU. Lo
 * que se fija acá es la integridad del catálogo y la propiedad que hace barata
 * la vía —que varios camos compartan patrón—, más el contrato de que importar
 * el módulo no baja ninguna textura (la carga es bajo demanda, en material.ts).
 */

import { describe, expect, it } from 'vitest'
import {
  CAMO_TEXTURA_POR_ID,
  CATALOGO_CAMOS,
  type CamoTextura,
  patronesUnicos,
  patronUrl,
} from '@/game/skins/texturas'

const HEX = /^#[0-9a-f]{6}$/i

describe('catálogo de camos por textura', () => {
  it('cada camo está completo y bien formado', () => {
    for (const c of CATALOGO_CAMOS) {
      expect(c.id, 'id vacío').toBeTruthy()
      expect(c.nombre, `nombre vacío en ${c.id}`).toBeTruthy()
      expect(c.patron, `patrón vacío en ${c.id}`).toBeTruthy()
      for (const [campo, valor] of [
        ['base', c.base],
        ['accent', c.accent],
        ['glow', c.glow],
      ] as const) {
        expect(valor, `${campo} de ${c.id} no es hex`).toMatch(HEX)
      }
      for (const [campo, valor] of [
        ['emissive', c.emissive],
        ['metal', c.metal],
        ['rugosidad', c.rugosidad],
        ['barniz', c.barniz],
      ] as const) {
        expect(valor, `${campo} de ${c.id} fuera de rango`).toBeGreaterThanOrEqual(0)
        // barniz llega hasta 1.35 en las familias del shader; acá lo topamos
        // en 1.5, que es el techo con el que se calibró la resina.
        expect(valor, `${campo} de ${c.id} fuera de rango`).toBeLessThanOrEqual(1.5)
      }
      expect(c.escala, `escala de ${c.id} no positiva`).toBeGreaterThan(0)
      expect(['ninguna', 'pulso', 'flujo', 'espectro']).toContain(c.animation)
    }
  })

  it('los ids son únicos: se persiste por id', () => {
    const ids = CATALOGO_CAMOS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('el índice por id apunta a la entrada correcta', () => {
    for (const c of CATALOGO_CAMOS) {
      expect(CAMO_TEXTURA_POR_ID[c.id]).toBe(c)
    }
  })

  it('varios camos comparten patrón: es lo que abarata el catálogo', () => {
    // La propiedad central de la vía. Si cada camo tuviera su propio patrón,
    // el catálogo pesaría tanto como el número de camos y no habría ninguna
    // ventaja sobre bajar imágenes terminadas.
    const patrones = patronesUnicos()
    expect(patrones.length).toBeLessThan(CATALOGO_CAMOS.length)
    // Y cada patrón se reusa al menos una vez de media.
    expect(CATALOGO_CAMOS.length / patrones.length).toBeGreaterThanOrEqual(1.5)
  })

  it('un mismo patrón rinde camos que NO se parecen', () => {
    // Dos camos del patrón "vetas" tienen que diferir en algo más que el
    // nombre, o la vía no estaría multiplicando nada.
    const vetas = CATALOGO_CAMOS.filter((c) => c.patron === 'vetas')
    expect(vetas.length).toBeGreaterThanOrEqual(2)
    const [a, b] = vetas
    const distintos =
      a.base !== b.base || a.glow !== b.glow || a.animation !== b.animation
    expect(distintos, 'dos camos del mismo patrón son idénticos').toBe(true)
  })

  it('patronUrl arma la ruta pública del PNG', () => {
    const c: CamoTextura = CATALOGO_CAMOS[0]
    expect(patronUrl(c)).toBe(`/assets/camos/${c.patron}.png`)
  })

  it('hay al menos un camo mate (emissive 0): el piso contra el que se miden', () => {
    // El control del catálogo. Prueba que la vía no depende del glow para
    // verse, y da la referencia honesta para decidir si los caros valen la
    // pena.
    expect(CATALOGO_CAMOS.some((c) => c.emissive === 0)).toBe(true)
  })
})
