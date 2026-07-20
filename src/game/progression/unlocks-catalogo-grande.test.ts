/**
 * La compresión de niveles de desbloqueo, verificada contra un catálogo más
 * grande que el que hay en disco.
 *
 * Vive en su propio archivo porque el registry es un singleton de módulo:
 * cargar armas extra dentro de `unlocks.test.ts` le dejaría el catálogo
 * cambiado a los demás tests de ese archivo.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  NIVEL_INICIAL,
  NIVEL_MAXIMO_DESBLOQUEO,
  nivelMaximoDeDesbloqueo,
  unlockLevelFor,
  unlockLevelsSnapshot,
} from '@/game/progression/unlocks'
import {
  loadLocalWeapons,
  resetLocalWeaponsForTests,
  resolveArchetype,
  weaponIndex,
} from '@/game/weapons/registry'

/** Un índice sintético de N fusiles: la clase con más modelos es la que
 *  empuja los niveles crudos más lejos. */
function indiceFalso(n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `assaultrifle-falso-${i}`,
    name: `Falso ${i}`,
    triangles: 100,
    bounds: { min: [-0.1, -0.1, -0.4], max: [0.1, 0.1, 0.4] },
    muzzleConfidence: 1,
    upAxisConfidence: 1,
    needsManualReview: false,
  }))
}

afterEach(() => {
  resetLocalWeaponsForTests()
})

/** Distancia entre modelos consecutivos de una misma clase, en el orden del
 *  pack. Es lo que la compresión multiplica: si alguien la dejara actuar
 *  también cuando el catálogo entra holgado, estos saltos se agrandarían. */
function saltosPorClase(): number[] {
  const porClase = new Map<string, number[]>()
  for (const entry of weaponIndex()) {
    const clase = resolveArchetype(entry.slug).class
    const lista = porClase.get(clase) ?? []
    lista.push(unlockLevelFor(entry.slug))
    porClase.set(clase, lista)
  }
  const saltos: number[] = []
  for (const niveles of porClase.values()) {
    for (let i = 1; i < niveles.length; i++) saltos.push(niveles[i] - niveles[i - 1])
  }
  return saltos
}

describe('catálogo que entra holgado', () => {
  it('no se estira: la compresión es un no-op mientras el catálogo entre', () => {
    // El control que faltaba. Sin él, cambiar la compresión para que actúe
    // SIEMPRE (estirando cuando el catálogo es chico) pasaba todos los tests,
    // y es el peor caso posible: al cargar las armas locales a mitad de
    // sesión el factor cambia, las armas se reacomodan hacia adelante y el
    // jugador ve desaparecer de la armería armas que ya tenía.
    expect(nivelMaximoDeDesbloqueo()).toBeLessThan(NIVEL_MAXIMO_DESBLOQUEO)
    for (const salto of saltosPorClase()) {
      // 0 entre los modelos de cortesía, 2 (STEP_PER_MODEL) entre el resto.
      expect(salto === 0 || salto === 2).toBe(true)
    }
  })
})

describe('catálogo más grande que el tope de desbloqueo', () => {
  it('comprime para que ningún arma quede del otro lado del techo', async () => {
    const antes = unlockLevelsSnapshot()
    const nivelesAntes = new Map(Object.entries(antes))
    expect(nivelMaximoDeDesbloqueo()).toBeLessThanOrEqual(NIVEL_MAXIMO_DESBLOQUEO)

    // 200 fusiles llevan el nivel crudo del último muy por encima del tope:
    // sin compresión sería 1 + (200-3)*2 = 395.
    const agregadas = await loadLocalWeapons(async () => indiceFalso(200))
    expect(agregadas).toBe(200)
    expect(weaponIndex().length).toBeGreaterThan(200)

    const despues = unlockLevelsSnapshot()
    for (const nivel of Object.values(despues)) {
      expect(nivel).toBeGreaterThanOrEqual(NIVEL_INICIAL)
      expect(nivel).toBeLessThanOrEqual(NIVEL_MAXIMO_DESBLOQUEO)
    }
    expect(nivelMaximoDeDesbloqueo()).toBe(NIVEL_MAXIMO_DESBLOQUEO)

    // Y la propiedad que protege al jugador: crecer el catálogo NUNCA mueve
    // un arma hacia adelante. Si lo hiciera, un arma ya desbloqueada
    // desaparecería de la armería a mitad de sesión, cuando resuelve el
    // fetch del índice local.
    for (const [slug, nivelAntes] of nivelesAntes) {
      expect(despues[slug]).toBeLessThanOrEqual(nivelAntes)
    }
  })
})
