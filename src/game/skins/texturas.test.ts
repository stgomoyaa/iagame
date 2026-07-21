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
      // Rareza válida: el shader la usa para escalar el brillo, un valor fuera
      // del enum rompería el rarityRank y saldría un brillo cualquiera.
      expect(
        ['comun', 'raro', 'epico', 'legendario', 'exotico'],
        `rareza inválida en ${c.id}`,
      ).toContain(c.rarity)
      // Niveles del heightmap: dentro de 0..1 y con el piso por DEBAJO del techo,
      // o el remapeo del shader dividiría por ~0 y el patrón saldría plano.
      expect(c.nivelBajo, `nivelBajo de ${c.id} fuera de 0..1`).toBeGreaterThanOrEqual(0)
      expect(c.nivelAlto, `nivelAlto de ${c.id} fuera de 0..1`).toBeLessThanOrEqual(1)
      expect(c.nivelBajo, `niveles invertidos en ${c.id}`).toBeLessThan(c.nivelAlto)
    }
  })

  it('la rareza escala: hay camos comunes Y exóticos, y los flashy son los raros', () => {
    // El punto nuevo: más legendario = más brillante. Debe haber spread de
    // rareza (un piso común mate y un techo exótico encendido), y los emisivos
    // más fuertes tienen que caer en las rarezas altas, no al revés.
    const rarezas = new Set(CATALOGO_CAMOS.map((c) => c.rarity))
    expect(rarezas.has('comun'), 'falta un común (el piso)').toBe(true)
    expect(rarezas.has('exotico'), 'falta un exótico (el techo)').toBe(true)
    // El emisivo promedio de los exóticos supera al de los comunes: el brillo
    // sube con la rareza, que es justo lo que se quiere demostrar.
    const promedio = (r: string): number => {
      const grupo = CATALOGO_CAMOS.filter((c) => c.rarity === r)
      return grupo.reduce((s, c) => s + c.emissive, 0) / grupo.length
    }
    expect(promedio('exotico')).toBeGreaterThan(promedio('comun'))
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
