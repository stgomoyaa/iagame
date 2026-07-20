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
  progressWithWeaponXp,
  PROGRESS_VERSION,
  SKINS_INICIALES,
} from '@/game/progression/store'
import { HISTORIAL_MAX } from '@/game/progression/history'
import { XP_ARMA_MAESTRIA } from '@/game/progression/weapon-xp'
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

  it('el inventario inicial muestra las seis familias de camuflaje', () => {
    // El guard que faltaba. Las seis familias se portaron a GLSL y quedaron
    // compiladas en el shader, pero el set de arranque anterior era anterior
    // a ellas y caía siete de ocho veces en `clasico`: un jugador nuevo tenía
    // las seis construidas y podía ver UNA. No fallaba ningún test porque
    // ninguno miraba la intersección entre el inventario y las familias.
    const familias = new Set(SKINS_INICIALES.map((s) => generateSkin(s).family))
    for (const fam of ['multicam', 'follaje', 'filigrana', 'gema', 'damasco', 'cebra']) {
      expect(familias, `el arranque no muestra ninguna skin de la familia ${fam}`).toContain(fam)
    }
  })

  it('el inventario inicial muestra las cuatro animaciones', () => {
    // Mismo motivo: `pulso`, `flujo` y `espectro` estaban implementadas y el
    // arranque traía seis de ocho skins sin animación, así que el movimiento
    // —que es la mitad de lo que hace cara a una skin— casi no se veía.
    const animaciones = new Set(SKINS_INICIALES.map((s) => generateSkin(s).animation))
    expect(animaciones).toEqual(new Set(['ninguna', 'pulso', 'flujo', 'espectro']))
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

/**
 * El historial se sumó a `ProgressData` SIN subir `PROGRESS_VERSION`,
 * justamente para no descartarle el guardado a un jugador que ya venía
 * jugando (ver el comentario del campo en store.ts). Estos tests son los que
 * hacen que eso sea cierto y no una intención.
 */
describe('compatibilidad con guardados anteriores al historial', () => {
  const guardadoViejo = {
    version: PROGRESS_VERSION,
    xp: xpParaNivel(9),
    skins: [...SKINS_INICIALES],
    loadout: defaultLoadout(9),
    rank: { rank: 11, rr: 62, cushion: 0 },
    placement: { played: 5, skill: 0.5 },
    partidasJugadas: 40,
    victorias: 22,
    derrotas: 18,
  }

  it('un guardado sin los campos nuevos conserva rango, XP y partidas', () => {
    const data = parseProgress(guardadoViejo)
    expect(data.rank).toEqual({ rank: 11, rr: 62, cushion: 0 })
    expect(data.xp).toBe(xpParaNivel(9))
    expect(data.partidasJugadas).toBe(40)
    expect(data.victorias).toBe(22)
  })

  it('el campo que falta se lee como vacío, no como default de cuenta nueva', () => {
    expect(parseProgress(guardadoViejo).historial).toEqual([])
  })

  it('el historial descarta filas ilegibles y respeta el tope', () => {
    const fila = (partida: number) => ({
      partida, fecha: 1, mapa: 'Arena', modo: 'tdm', win: true,
      kills: 5, deaths: 2, headshots: 1, damage: 900, rrChange: 4, rank: 7,
    })
    const data = parseProgress({
      ...guardadoViejo,
      historial: [fila(1), null, 'basura', { sinPartida: true }, fila(2)],
    })
    expect(data.historial.map((e) => e.partida)).toEqual([1, 2])

    const largo = parseProgress({
      ...guardadoViejo,
      historial: Array.from({ length: 40 }, (_, i) => fila(i + 1)),
    })
    expect(largo.historial).toHaveLength(HISTORIAL_MAX)
  })

  it('un historial que no es lista no rompe la carga', () => {
    expect(parseProgress({ ...guardadoViejo, historial: { no: 'es lista' } }).historial).toEqual([])
  })
})

/**
 * El campo `armas` (XP por arma) se agregó SIN subir PROGRESS_VERSION. Estos
 * tests son los que garantizan que esa decisión fue segura: un guardado
 * escrito antes de que la capa existiera tiene que seguir cargando entero.
 */
describe('xp por arma en el guardado', () => {
  it('un guardado v2 sin el campo carga igual y arranca con el mapa vacio', () => {
    const viejo = {
      // El 2 va LITERAL, no `PROGRESS_VERSION`. Con la constante, subir la
      // version haria subir tambien este fixture y el test seguiria pasando
      // mientras `parseProgress` descarta en silencio todos los guardados
      // reales. Escrito a mano, si alguien sube la version este test cae y
      // lo obliga a decidir a conciencia que rompe los guardados v2.
      version: 2,
      xp: 4800,
      skins: [...SKINS_INICIALES],
      loadout: { primary: {}, secondary: {} },
      rank: null,
      placement: { played: 2, skill: 0.5 },
      partidasJugadas: 7,
      victorias: 4,
      derrotas: 3,
      // sin `armas`: es el guardado de antes de esta capa
    }
    const data = parseProgress(viejo)
    expect(data.armas).toEqual({})
    // Y NADA MAS se perdio: el resto del guardado sobrevivio.
    expect(data.xp).toBe(4800)
    expect(data.partidasJugadas).toBe(7)
    expect(data.victorias).toBe(4)
    expect(data.loadout.primary.slug).not.toBeNull()
  })

  it('sobrevive el viaje de ida y vuelta', () => {
    const data = progressWithWeaponXp(createDefaultProgress(), { ak47: 1500, glock: 600 })
    expect(parseProgress(JSON.parse(JSON.stringify(data))).armas).toEqual({
      ak47: 1500,
      glock: 600,
    })
  })

  it('descarta entradas corruptas sin perder las sanas', () => {
    const data = parseProgress({
      ...createDefaultProgress(),
      armas: { ak47: 1500, rota: 'mucha', nan: NaN, negativa: -20, cero: 0, glock: 600 },
    })
    expect(data.armas).toEqual({ ak47: 1500, glock: 600 })
  })

  it('topea la xp por arma en la maestria', () => {
    const data = parseProgress({
      ...createDefaultProgress(),
      armas: { ak47: 99_999_999 },
    })
    expect(data.armas.ak47).toBe(XP_ARMA_MAESTRIA)
  })

  it('un `armas` que no es objeto cae al mapa vacio', () => {
    // Los arrays van NO VACIOS a proposito: un `[]` produce `{}` por
    // Object.keys aunque el guard de Array.isArray no exista, asi que no
    // probaria nada. `[7, 8]` sin el guard entraria como { '0': 7, '1': 8 }.
    for (const basura of [null, 42, 'texto', [], [7, 8], [{ ak47: 1 }]]) {
      expect(parseProgress({ ...createDefaultProgress(), armas: basura }).armas).toEqual({})
    }
  })
})
