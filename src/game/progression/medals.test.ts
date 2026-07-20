/**
 * Tests del catálogo y de la persistencia de medallas.
 *
 * El peso está en `parseTally`: es la frontera con localStorage, o sea con
 * datos que pudo escribir una versión anterior del juego, otra pestaña o el
 * propio usuario desde la consola. El contrato es el mismo que el resto de
 * progression/store.ts -- nada de lo que venga de ahí puede tirar una
 * excepción ni inventar progreso.
 */

import { describe, expect, it } from 'vitest'
import {
  CATALOGO_MEDALLAS,
  emptyTally,
  medalById,
  medalBySlug,
  medalIconPath,
  MEDALLAS_TOTALES,
  parseTally,
  sumarTallies,
  totalMedallas,
  xpDeMedallas,
} from '@/game/progression/medals'
import {
  createDefaultProgress,
  parseProgress,
  progressWithMedals,
  PROGRESS_VERSION,
} from '@/game/progression/store'

describe('búsqueda en el catálogo', () => {
  it('encuentra por id y por slug, y devuelve null en vez de tirar', () => {
    expect(medalById(0)?.slug).toBe('primera-sangre')
    expect(medalById(MEDALLAS_TOTALES)).toBeNull()
    expect(medalById(-1)).toBeNull()
    expect(medalBySlug('dominacion')?.nombre).toBe('Dominación')
    expect(medalBySlug('invicto-de-ronda')).toBeNull()
  })

  it('la ruta del icono usa el slug tal cual, en los dos tamaños', () => {
    expect(medalIconPath('doble-baja', 64)).toBe('/assets/ui/64/medalla-doble-baja.png')
    expect(medalIconPath('doble-baja', 256)).toBe('/assets/ui/256/medalla-doble-baja.png')
    expect(medalIconPath('doble-baja')).toBe('/assets/ui/64/medalla-doble-baja.png')
  })
})

describe('parseTally: frontera con localStorage', () => {
  it('lo que no es un objeto cae a vacío', () => {
    for (const basura of [null, undefined, 42, 'texto', [], true, NaN]) {
      expect(parseTally(basura)).toEqual({})
    }
  })

  it('descarta slugs que no están en el catálogo', () => {
    // Un guardado editado a mano no puede inventar una medalla que la UI
    // después intentaría dibujar con un icono que no existe.
    expect(parseTally({ 'medalla-inventada': 5, headshot: 2 })).toEqual({ headshot: 2 })
  })

  it('descarta valores que no son números positivos', () => {
    expect(
      parseTally({
        headshot: -3,
        clutch: 0,
        venganza: NaN,
        salvada: Infinity,
        masacre: 'muchas',
        'doble-baja': 4,
      }),
    ).toEqual({ 'doble-baja': 4 })
  })

  it('trunca fracciones en vez de guardar medallas a medias', () => {
    expect(parseTally({ headshot: 3.9 })).toEqual({ headshot: 3 })
  })

  it('un objeto válido sobrevive intacto', () => {
    const bueno = { headshot: 12, clutch: 1, dominacion: 3 }
    expect(parseTally(bueno)).toEqual(bueno)
  })
})

describe('sumarTallies', () => {
  it('suma clave por clave y omite los ceros', () => {
    expect(sumarTallies({ headshot: 2, clutch: 1 }, { headshot: 3, venganza: 1 })).toEqual({
      headshot: 5,
      clutch: 1,
      venganza: 1,
    })
  })

  it('sumar vacío es la identidad', () => {
    const t = { headshot: 7 }
    expect(sumarTallies(t, emptyTally())).toEqual(t)
    expect(sumarTallies(emptyTally(), t)).toEqual(t)
  })

  it('ignora slugs desconocidos que se hayan colado de cualquiera de los dos lados', () => {
    expect(sumarTallies({ fantasma: 9 } as Record<string, number>, { headshot: 1 })).toEqual({
      headshot: 1,
    })
  })
})

describe('XP de medallas', () => {
  it('paga el valor del catálogo por cada vez', () => {
    const headshot = CATALOGO_MEDALLAS.find((d) => d.slug === 'headshot')!
    const clutch = CATALOGO_MEDALLAS.find((d) => d.slug === 'clutch')!
    expect(xpDeMedallas({ headshot: 4, clutch: 1 })).toBe(headshot.xp * 4 + clutch.xp)
  })

  it('un conteo vacío no paga nada', () => {
    expect(xpDeMedallas(emptyTally())).toBe(0)
  })

  it('una tanda típica de partida suma un extra que se nota pero no domina la XP base', () => {
    // Anclaje del diseño: la XP de una partida ronda 2500-4000 (xp.ts). Si
    // las medallas pagaran más que eso, farmearlas sería mejor que jugar, y
    // el nivel de cuenta dejaría de medir "cuánto jugaste".
    //
    // Tanda medida en TDM arena con scripts/medir-medallas.ts (por partida):
    // ~9 headshot, 1.5 doble, 0.2 triple, 1.7 venganza, 1.7 salvada,
    // 1.2 dominación, 0.3 racha-de-5, 0.3 clutch, 0.5 sin-morir, 0.2 tiro
    // largo, 0.25 última bala. Se redondea a enteros para el test.
    const tandaTipica = {
      headshot: 9,
      'doble-baja': 2,
      venganza: 2,
      salvada: 2,
      dominacion: 1,
      'racha-de-5': 1,
      'sin-morir': 1,
    }
    const xp = xpDeMedallas(tandaTipica)
    expect(xp).toBeGreaterThan(200)
    expect(xp).toBeLessThan(2000)
  })

  it('totalMedallas cuenta todas las veces, de todos los tipos', () => {
    expect(totalMedallas({ headshot: 4, clutch: 1 })).toBe(5)
    expect(totalMedallas(emptyTally())).toBe(0)
  })
})

describe('persistencia dentro de ProgressData', () => {
  it('un guardado nuevo arranca sin medallas', () => {
    expect(createDefaultProgress().medallas).toEqual({})
  })

  it('un guardado v2 SIN el campo se lee igual y cae a vacío, sin perder el resto', () => {
    // Es la garantía que hace que este campo sea aditivo: no hubo que subir
    // PROGRESS_VERSION, así que ningún jugador pierde su rango ni sus skins
    // por haber jugado antes de que existieran las medallas.
    const viejo = {
      version: PROGRESS_VERSION,
      xp: 5000,
      skins: ['inicial:2'],
      loadout: {},
      rank: { rank: 10, rr: 40, cushion: 0 },
      placement: { played: 5, skill: 0.5 },
      partidasJugadas: 30,
      victorias: 18,
      derrotas: 12,
    }
    const leido = parseProgress(viejo)
    expect(leido.medallas).toEqual({})
    expect(leido.xp).toBe(5000)
    expect(leido.rank?.rank).toBe(10)
    expect(leido.partidasJugadas).toBe(30)
  })

  it('un campo de medallas corrupto no rompe el resto del guardado', () => {
    const leido = parseProgress({
      ...createDefaultProgress(),
      xp: 1234,
      medallas: 'esto no es un objeto',
    })
    expect(leido.medallas).toEqual({})
    expect(leido.xp).toBe(1234)
  })

  it('progressWithMedals acumula sobre lo que ya había sin tocar nada más', () => {
    const base = { ...createDefaultProgress(), xp: 999, medallas: { headshot: 3 } }
    const despues = progressWithMedals(base, { headshot: 2, clutch: 1 })
    expect(despues.medallas).toEqual({ headshot: 5, clutch: 1 })
    expect(despues.xp).toBe(999)
    expect(base.medallas).toEqual({ headshot: 3 })
  })

  it('el acumulado sobrevive una vuelta completa por JSON', () => {
    const guardado = progressWithMedals(createDefaultProgress(), { headshot: 7, dominacion: 2 })
    const vuelta = parseProgress(JSON.parse(JSON.stringify(guardado)))
    expect(vuelta.medallas).toEqual({ headshot: 7, dominacion: 2 })
  })
})
