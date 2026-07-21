/**
 * El catálogo de dos niveles: CC0 publicable + local nunca publicable
 * (docs/WORKSHOP.md).
 *
 * **El orden de los tests de este archivo importa y no es un descuido.** El
 * registry es un singleton de módulo y `loadLocalWeapons()` lo MUTA: una vez
 * que un test carga el índice local, los que vengan después ven las armas
 * extra. Por eso el bloque "sin índice local" va primero y cada bloque que
 * carga llama a `resetLocalWeaponsForTests()` en su `afterEach`. Si alguien
 * agrega un test acá, tiene que respetar esa disciplina o va a estar
 * midiendo el estado que le dejó el anterior.
 *
 * El índice local se inyecta como un fixture y no se lee de disco: el
 * archivo real vive en `public/assets/weapons-local/`, que está
 * gitignoreado, así que en un checkout limpio (o en CI) NO EXISTE. Un test
 * que dependiera de él pasaría en la máquina de quien lo escribió y fallaría
 * en todas las demás, o —peor— se saltearía en silencio y no probaría nada.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  catalogVersion,
  loadLocalWeapons,
  resolveArchetypeId,
  resetLocalWeaponsForTests,
  weaponAssetUrl,
  weaponIndex,
  weaponOrigin,
  WEAPON_REGISTRY,
} from '@/game/weapons/registry'
import { unlockLevelFor } from '@/game/progression/unlocks'
import { SOURCE_WEAPONS } from '@/game/weapons/source-catalog'

/** Cuántas armas CC0 hay hoy en public/assets/weapons/index.json. Es el
 *  catálogo de un build publicado: lo único que un usuario final recibe. */
const CC0 = 40

/**
 * Fixture con la MISMA forma que produce scripts/convert-source-weapons.ts,
 * derivado del catálogo real para que no se desincronice: si mañana se suma
 * o se saca un arma de `SOURCE_WEAPONS`, este fixture la sigue sola.
 */
function indiceLocalFalso(): unknown[] {
  return SOURCE_WEAPONS.map((entry, i) => ({
    slug: entry.slug,
    name: entry.name,
    triangles: 1000 + i,
    bounds: { min: [-0.03, -0.1, -0.4], max: [0.03, 0.1, 0.4] },
    muzzleConfidence: 1,
    upAxisConfidence: 1,
    needsManualReview: false,
    sightHeight: 0.08,
    sightLateral: 0,
  }))
}

describe('sin índice local (lo que recibe un build publicado)', () => {
  it('el catálogo son exactamente las armas CC0 y todas saben que lo son', () => {
    expect(weaponIndex().length).toBe(CC0)
    for (const entry of weaponIndex()) expect(entry.origin).toBe('cc0')
  })

  it('un 404 no es un error: devuelve 0, no lanza, y no ensucia el catálogo', async () => {
    // Es EL caso de un build publicado, no un borde raro: la carpeta no
    // existe porque está gitignoreada, y el juego tiene que arrancar igual.
    const agregadas = await loadLocalWeapons(async () => {
      // Lo que hace fetchLocalIndex ante un !res.ok.
      return null
    })

    expect(agregadas).toBe(0)
    expect(weaponIndex().length).toBe(CC0)
    resetLocalWeaponsForTests()
  })

  it('la red caída tampoco rompe el arranque', async () => {
    const agregadas = await loadLocalWeapons(() => Promise.reject(new Error('sin red')))
    expect(agregadas).toBe(0)
    expect(weaponIndex().length).toBe(CC0)
    resetLocalWeaponsForTests()
  })

  it('un índice con JSON válido pero de otra forma se ignora entero', async () => {
    const agregadas = await loadLocalWeapons(async () => ({ armas: [] }))
    expect(agregadas).toBe(0)
    expect(weaponIndex().length).toBe(CC0)
    resetLocalWeaponsForTests()
  })
})

describe('con índice local presente (la máquina de desarrollo)', () => {
  afterEach(() => resetLocalWeaponsForTests())

  it('el catálogo pasa a ser CC0 + locales, y cada arma sabe su procedencia', async () => {
    const agregadas = await loadLocalWeapons(async () => indiceLocalFalso())

    expect(agregadas).toBe(SOURCE_WEAPONS.length)
    expect(weaponIndex().length).toBe(CC0 + SOURCE_WEAPONS.length)

    const porOrigen = { cc0: 0, local: 0 }
    for (const entry of weaponIndex()) porOrigen[entry.origin]++
    expect(porOrigen).toEqual({ cc0: CC0, local: SOURCE_WEAPONS.length })
  })

  it('la armería muestra el nombre real con su etiqueta de juego: "AK-47 (CS)"', async () => {
    await loadLocalWeapons(async () => indiceLocalFalso())
    const ak = weaponIndex().find((e) => e.slug === 'ak47')
    expect(ak?.name).toBe('AK-47 (CS)')
    // El AK-47 de COD es OTRA fila, con el mismo nombre real y otra etiqueta.
    // Es el caso que justifica que la etiqueta exista: sin ella las dos se
    // mostrarían como "AK-47" y una taparía a la otra en la armería.
    expect(weaponIndex().find((e) => e.slug === 'cod4_ak47')?.name).toBe('AK-47 (COD)')

    // Y todas las locales llevan etiqueta, no sólo las emblemáticas.
    for (const entry of weaponIndex().filter((e) => e.origin === 'local')) {
      expect(entry.name, entry.slug).toMatch(/ \((CS|COD)\)$/)
    }
  })

  it('el nombre lo manda el CATÁLOGO, no el índice en disco (que puede ser de una corrida vieja)', async () => {
    // Un index.json escrito antes del renombrado traía "Cárpato". El registry
    // tiene que ignorarlo y usar el nombre del catálogo igual, o renombrar un
    // arma obligaría a reconvertir los 39 modelos.
    await loadLocalWeapons(async () =>
      indiceLocalFalso().map((e) =>
        (e as { slug: string }).slug === 'ak47' ? { ...(e as object), name: 'Cárpato' } : e,
      ),
    )
    expect(weaponIndex().find((e) => e.slug === 'ak47')?.name).toBe('AK-47 (CS)')
  })

  it('el .glb de cada arma se pide a la carpeta de SU procedencia', async () => {
    await loadLocalWeapons(async () => indiceLocalFalso())

    // Es lo que impide el bug silencioso de pedir un arma local a la carpeta
    // publicable: 404, el arma no aparece, y el único rastro es un
    // console.error.
    expect(weaponAssetUrl('pistol-1')).toBe('/assets/weapons/pistol-1.glb')
    expect(weaponAssetUrl('ak47')).toBe('/assets/weapons-local/ak47.glb')
    expect(weaponOrigin('ak47')).toBe('local')
    expect(weaponOrigin('pistol-1')).toBe('cc0')
    expect(weaponOrigin('no-existe')).toBeNull()
  })

  it('cada arma local entra al registry con las estadísticas de SU arquetipo', async () => {
    await loadLocalWeapons(async () => indiceLocalFalso())

    for (const entry of SOURCE_WEAPONS) {
      const visual = WEAPON_REGISTRY[entry.slug]
      expect(visual, `${entry.slug} no entró al registry`).toBeDefined()
      expect(visual.archetype, entry.slug).toBe(entry.archetype)
      // Y el inferidor por slug NO es el que resolvió: si lo fuera, "ak47" y
      // "awp" caerían las dos en el arquetipo por defecto.
      expect(resolveArchetypeId(entry.slug)).toBe(entry.archetype)
    }
  })

  it('el ADS de un arma local (injertada) es POSE_NEUTRA: stopgap del ADS de COD', async () => {
    await loadLocalWeapons(async () => indiceLocalFalso())

    // Antes se anclaba a la mira medida (sightHeight/sightRearZ). Pero el
    // injerto de brazos donantes mueve el rig, así que esa medición pre-injerto
    // ya no corresponde a la pose dibujada: al apuntar trasladaba el arma abajo
    // y lejos de la cámara (se veía ACHICAR). El stopgap la deja en su pose de
    // cadera (neutra) y el acercamiento lo hace el zoom de FOV del estilo COD.
    // Ver seedAdsOffset (misma exención que seedHipOffset).
    const local = WEAPON_REGISTRY[SOURCE_WEAPONS[0].slug]
    expect(local.adsOffset.y).toBe(0)
    expect(local.adsOffset.z).toBe(0)

    // Y la garantía de no-regresión que pide el encargo: las 40 CC0 no se
    // injertan y no cambian de comportamiento. pistol-1 no tiene sightHeight,
    // así que sigue alineando el borde superior de su caja.
    const cc0 = weaponIndex().find((e) => e.slug === 'pistol-1')
    expect(cc0?.sightHeight).toBeUndefined()
    const alturaCaja = (cc0!.bounds.max[1] - cc0!.bounds.min[1]) / 2
    expect(WEAPON_REGISTRY['pistol-1'].adsOffset.y).toBeCloseTo(-alturaCaja, 6)
  })

  it('la progresión conoce las armas que entraron DESPUÉS de importarse', async () => {
    // Regresión de un bug real que sólo apareció al abrir el navegador: la
    // tabla de desbloqueo era un `const` que se calculaba en el import de
    // progression/unlocks.ts, o sea con la foto de las 40 CC0. Las locales
    // entran después (cuando resuelve el fetch), así que `unlockLevelFor` de
    // un arma local LANZABA -- y como el loadout por defecto recorre las
    // armas desbloqueadas, lo que reventaba era el arranque del juego
    // completo, no una pantalla suelta.
    //
    // Este test es el que hubiera avisado antes: nótese que llama a
    // unlockLevelFor ANTES de cargar (lo que llena cualquier caché con la
    // foto vieja) y recién después carga y vuelve a preguntar.
    expect(unlockLevelFor('pistol-1')).toBeGreaterThan(0)

    await loadLocalWeapons(async () => indiceLocalFalso())

    for (const entry of SOURCE_WEAPONS) {
      expect(() => unlockLevelFor(entry.slug), entry.slug).not.toThrow()
      expect(unlockLevelFor(entry.slug), entry.slug).toBeGreaterThan(0)
    }
    // Y las CC0 conservan su nivel: sumar armas no puede reordenar la
    // progresión que un jugador ya tenía.
    expect(unlockLevelFor('pistol-1')).toBe(1)
  })

  it('la versión del catálogo cambia al cargar: es lo que despierta a la armería', async () => {
    const antes = catalogVersion()
    await loadLocalWeapons(async () => indiceLocalFalso())
    expect(catalogVersion()).not.toBe(antes)
  })

  it('cargar dos veces no duplica armas ni vuelve a pedir el índice', async () => {
    let pedidos = 0
    const fetcher = async (): Promise<unknown> => {
      pedidos++
      return indiceLocalFalso()
    }

    await loadLocalWeapons(fetcher)
    await loadLocalWeapons(fetcher)

    expect(pedidos).toBe(1)
    expect(weaponIndex().length).toBe(CC0 + SOURCE_WEAPONS.length)
  })

  it('una entrada rota cuesta un arma, no el catálogo entero', async () => {
    const roto = [
      { slug: 'sin-bounds', name: 'Sin Bounds' },
      { name: 'Sin Slug', bounds: { min: [0, 0, 0], max: [1, 1, 1] } },
      null,
      'esto no es un arma',
      {
        slug: 'buena',
        name: 'Buena',
        triangles: 10,
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        muzzleConfidence: 1,
        upAxisConfidence: 1,
        needsManualReview: false,
      },
    ]

    const agregadas = await loadLocalWeapons(async () => roto)
    expect(agregadas).toBe(1)
    expect(weaponIndex().length).toBe(CC0 + 1)
    expect(weaponOrigin('buena')).toBe('local')
  })

  it('un slug local no puede pisar a uno CC0: el catálogo publicable manda', async () => {
    const impostor = [
      {
        slug: 'pistol-1',
        name: 'Impostora',
        triangles: 10,
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        muzzleConfidence: 1,
        upAxisConfidence: 1,
        needsManualReview: false,
      },
    ]

    const agregadas = await loadLocalWeapons(async () => impostor)
    expect(agregadas).toBe(0)
    expect(weaponOrigin('pistol-1')).toBe('cc0')
    expect(weaponAssetUrl('pistol-1')).toBe('/assets/weapons/pistol-1.glb')
  })
})
