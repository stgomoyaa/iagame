import { describe, expect, it } from 'vitest'
import {
  defaultLoadout,
  equipSkin,
  equipWeapon,
  normalizeLoadout,
  skinForSlot,
  type Loadout,
} from '@/game/progression/loadout'
import {
  accountLevel,
  createDefaultProgress,
  createMemoryProgressStore,
  parseProgress,
  PROGRESS_VERSION,
  SKINS_INICIALES,
} from '@/game/progression/store'
import { generateSkin } from '@/game/skins/generator'
import { NIVEL_INICIAL, xpParaNivel } from '@/game/progression/unlocks'
import { weaponIndex } from '@/game/weapons/registry'

const TODAS = weaponIndex().map((e) => e.slug)

describe('loadout por defecto', () => {
  it('una cuenta nueva arranca con primaria y secundaria equipadas', () => {
    const loadout = defaultLoadout(NIVEL_INICIAL)
    expect(loadout.primary.slug).not.toBeNull()
    expect(loadout.secondary.slug).not.toBeNull()
    expect(loadout.primary.slug).not.toBe(loadout.secondary.slug)
  })

  it('arranca sin skin: equipar una es decisión del jugador', () => {
    const loadout = defaultLoadout(NIVEL_INICIAL)
    expect(loadout.primary.skinSeed).toBeNull()
    expect(skinForSlot(loadout, 'primary')).toBeNull()
  })
})

describe('normalización del loadout', () => {
  it('descarta un arma que ya no existe en el pack', () => {
    const roto: Loadout = {
      primary: { slug: 'arma-borrada', skinSeed: null },
      secondary: { slug: TODAS[0], skinSeed: null },
    }
    const arreglado = normalizeLoadout(roto, NIVEL_INICIAL, [])
    expect(TODAS).toContain(arreglado.primary.slug)
  })

  it('descarta un arma que el nivel todavía no habilita', () => {
    // El caso real: se baja el nivel de cuenta, o el pack cambia y un arma
    // que estaba al alcance pasa a pedir más nivel.
    const bloqueada = TODAS.find((s) => !defaultLoadout(NIVEL_INICIAL).primary.slug?.includes(s))
    const conBloqueada: Loadout = {
      primary: { slug: 'sniperrifle-1', skinSeed: null },
      secondary: { slug: bloqueada ?? TODAS[0], skinSeed: null },
    }
    const arreglado = normalizeLoadout(conBloqueada, NIVEL_INICIAL, [])
    expect(arreglado.primary.slug).toBe(defaultLoadout(NIVEL_INICIAL).primary.slug)
  })

  it('descarta una skin que no está en el inventario', () => {
    const conSkinAjena: Loadout = {
      primary: { slug: TODAS[0], skinSeed: 'skin-de-otro' },
      secondary: { slug: TODAS[1], skinSeed: SKINS_INICIALES[0] },
    }
    const arreglado = normalizeLoadout(conSkinAjena, NIVEL_INICIAL, SKINS_INICIALES)
    expect(arreglado.primary.skinSeed).toBeNull()
    expect(arreglado.secondary.skinSeed).toBe(SKINS_INICIALES[0])
  })

  it('nunca deja una ranura sin arma', () => {
    const vacio: Loadout = {
      primary: { slug: null, skinSeed: null },
      secondary: { slug: null, skinSeed: null },
    }
    const arreglado = normalizeLoadout(vacio, NIVEL_INICIAL, [])
    expect(arreglado.primary.slug).not.toBeNull()
    expect(arreglado.secondary.slug).not.toBeNull()
  })
})

describe('equipar', () => {
  it('equipWeapon cambia sólo la ranura pedida', () => {
    const base = defaultLoadout(NIVEL_INICIAL)
    const nuevo = equipWeapon(base, 'primary', TODAS[3])
    expect(nuevo.primary.slug).toBe(TODAS[3])
    expect(nuevo.secondary).toEqual(base.secondary)
  })

  it('equipSkin equipa y saca', () => {
    const base = defaultLoadout(NIVEL_INICIAL)
    const conSkin = equipSkin(base, 'secondary', SKINS_INICIALES[4])
    expect(skinForSlot(conSkin, 'secondary')).toEqual(generateSkin(SKINS_INICIALES[4]))
    expect(skinForSlot(equipSkin(conSkin, 'secondary', null), 'secondary')).toBeNull()
  })

  it('equipar no muta el loadout anterior', () => {
    const base = defaultLoadout(NIVEL_INICIAL)
    const antes = base.primary.slug
    equipWeapon(base, 'primary', TODAS[7])
    expect(base.primary.slug).toBe(antes)
  })
})

describe('ProgressStore', () => {
  it('el inventario inicial cubre los cinco tiers', () => {
    // Es lo que hace comparable el salto de una común a una exótica en la
    // armería: sin cobertura, la escalera de rarezas no se ve.
    const rarezas = new Set(SKINS_INICIALES.map((s) => generateSkin(s).rarity))
    expect(rarezas).toEqual(new Set(['comun', 'raro', 'epico', 'legendario', 'exotico']))
  })

  it('guarda y devuelve lo guardado', () => {
    const store = createMemoryProgressStore()
    const data = createDefaultProgress()
    data.xp = 5000
    store.save(data)
    expect(store.load().xp).toBe(5000)
  })

  it('clear vuelve al default', () => {
    const store = createMemoryProgressStore()
    store.save({ ...createDefaultProgress(), xp: 9999 })
    store.clear()
    expect(store.load().xp).toBe(0)
  })

  it('el nivel sale de la xp guardada', () => {
    expect(accountLevel({ ...createDefaultProgress(), xp: xpParaNivel(9) })).toBe(9)
  })
})

describe('lectura de datos guardados', () => {
  it('sobrevive a un round-trip por JSON', () => {
    const data = createDefaultProgress()
    data.xp = 3600
    data.loadout = equipSkin(data.loadout, 'primary', SKINS_INICIALES[7])
    const round = parseProgress(JSON.parse(JSON.stringify(data)))
    expect(round.loadout.primary.skinSeed).toBe(SKINS_INICIALES[7])
    expect(round.xp).toBe(3600)
  })

  it('la skin equipada se ve igual después de recargar', () => {
    // El requisito de la sección 7 del spec, extremo a extremo: se persiste
    // la seed, no la skin, así que "igual después de recargar" depende de
    // que el generador sea determinista.
    const data = equipSkin(createDefaultProgress().loadout, 'primary', SKINS_INICIALES[6])
    const antes = skinForSlot(data, 'primary')
    const recargado = parseProgress(
      JSON.parse(JSON.stringify({ ...createDefaultProgress(), loadout: data })),
    )
    expect(skinForSlot(recargado.loadout, 'primary')).toEqual(antes)
  })

  it('descarta un guardado de otra versión del formato', () => {
    const viejo = { ...createDefaultProgress(), version: PROGRESS_VERSION - 1, xp: 50000 }
    expect(parseProgress(viejo).xp).toBe(0)
  })

  it('no revienta con basura', () => {
    for (const basura of [null, undefined, 42, 'texto', [], { version: PROGRESS_VERSION }]) {
      const data = parseProgress(basura)
      expect(data.loadout.primary.slug).not.toBeNull()
      expect(data.version).toBe(PROGRESS_VERSION)
    }
  })

  it('ignora campos con el tipo equivocado sin perder el resto', () => {
    const data = parseProgress({
      version: PROGRESS_VERSION,
      xp: 'mucha',
      skins: [1, 2, 3],
      loadout: { primary: 'no es un objeto', secondary: null },
    })
    expect(data.xp).toBe(0)
    expect(data.skins).toEqual([...SKINS_INICIALES])
    expect(data.loadout.primary.slug).not.toBeNull()
  })
})
