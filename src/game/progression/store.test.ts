import { describe, expect, it } from 'vitest'
import {
  camoForSlot,
  defaultLoadout,
  equipCamo,
  equipSkin,
  equipWeapon,
  normalizeLoadout,
  skinForSlot,
  type Loadout,
} from '@/game/progression/loadout'
import { CATALOGO_CAMOS } from '@/game/skins/texturas'
import {
  accountLevel,
  createDefaultProgress,
  createMemoryProgressStore,
  CURVA_XP_ACTUAL,
  parseProgress,
  progressWithWeaponXp,
  prestigeFromProgress,
  progressWithPrestige,
  PROGRESS_VERSION,
  SKINS_INICIALES,
  type ProgressData,
} from '@/game/progression/store'
import { HISTORIAL_MAX } from '@/game/progression/history'
import { XP_ARMA_MAESTRIA } from '@/game/progression/weapon-xp'
import { prestigiar, PRESTIGIO_MAX } from '@/game/progression/prestige'
import { generateSkin } from '@/game/skins/generator'
import {
  NIVEL_INICIAL,
  NIVEL_MAXIMO,
  unlockedWeapons,
  unlockLevelFor,
  xpParaNivel,
} from '@/game/progression/unlocks'
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
      primary: { slug: 'arma-borrada', skinSeed: null, camoId: null },
      secondary: { slug: TODAS[0], skinSeed: null, camoId: null },
    }
    const arreglado = normalizeLoadout(roto, NIVEL_INICIAL, [])
    expect(TODAS).toContain(arreglado.primary.slug)
  })

  it('descarta un arma que el nivel todavía no habilita', () => {
    // El caso real: se baja el nivel de cuenta, o el pack cambia y un arma
    // que estaba al alcance pasa a pedir más nivel.
    const bloqueada = TODAS.find((s) => !defaultLoadout(NIVEL_INICIAL).primary.slug?.includes(s))
    const conBloqueada: Loadout = {
      primary: { slug: 'sniperrifle-1', skinSeed: null, camoId: null },
      secondary: { slug: bloqueada ?? TODAS[0], skinSeed: null, camoId: null },
    }
    const arreglado = normalizeLoadout(conBloqueada, NIVEL_INICIAL, [])
    expect(arreglado.primary.slug).toBe(defaultLoadout(NIVEL_INICIAL).primary.slug)
  })

  it('descarta una skin que no está en el inventario', () => {
    const conSkinAjena: Loadout = {
      primary: { slug: TODAS[0], skinSeed: 'skin-de-otro', camoId: null },
      secondary: { slug: TODAS[1], skinSeed: SKINS_INICIALES[0], camoId: null },
    }
    const arreglado = normalizeLoadout(conSkinAjena, NIVEL_INICIAL, SKINS_INICIALES)
    expect(arreglado.primary.skinSeed).toBeNull()
    expect(arreglado.secondary.skinSeed).toBe(SKINS_INICIALES[0])
  })

  it('nunca deja una ranura sin arma', () => {
    const vacio: Loadout = {
      primary: { slug: null, skinSeed: null, camoId: null },
      secondary: { slug: null, skinSeed: null, camoId: null },
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

describe('camos por textura', () => {
  const CAMO = CATALOGO_CAMOS[0].id
  const OTRO_CAMO = CATALOGO_CAMOS[1].id

  it('equipCamo equipa y camoForSlot lo devuelve', () => {
    const base = defaultLoadout(NIVEL_INICIAL)
    const conCamo = equipCamo(base, 'primary', CAMO)
    expect(conCamo.primary.camoId).toBe(CAMO)
    expect(camoForSlot(conCamo, 'primary')?.id).toBe(CAMO)
  })

  it('equipCamo con null saca el camo', () => {
    const conCamo = equipCamo(defaultLoadout(NIVEL_INICIAL), 'secondary', CAMO)
    expect(camoForSlot(equipCamo(conCamo, 'secondary', null), 'secondary')).toBeNull()
  })

  it('equipar un camo limpia la skin procedural, y viceversa', () => {
    // La exclusión mutua es la propiedad central: un arma tiene UN aspecto.
    const conSkin = equipSkin(defaultLoadout(NIVEL_INICIAL), 'primary', SKINS_INICIALES[4])
    const conCamo = equipCamo(conSkin, 'primary', CAMO)
    expect(conCamo.primary.skinSeed).toBeNull()
    expect(conCamo.primary.camoId).toBe(CAMO)

    const otraVezSkin = equipSkin(conCamo, 'primary', SKINS_INICIALES[4])
    expect(otraVezSkin.primary.camoId).toBeNull()
    expect(otraVezSkin.primary.skinSeed).toBe(SKINS_INICIALES[4])
  })

  it('"Sin skin" (equipSkin con null) limpia camo y skin a la vez', () => {
    // Es el contrato del botón "Sin skin" de la armería: deja la ranura de
    // fábrica sin importar si tenía skin o camo.
    const conCamo = equipCamo(defaultLoadout(NIVEL_INICIAL), 'primary', CAMO)
    const fabrica = equipSkin(conCamo, 'primary', null)
    expect(fabrica.primary.camoId).toBeNull()
    expect(fabrica.primary.skinSeed).toBeNull()
    expect(camoForSlot(fabrica, 'primary')).toBeNull()
    expect(skinForSlot(fabrica, 'primary')).toBeNull()
  })

  it('camoForSlot devuelve null ante un id que no está en el catálogo', () => {
    const roto: Loadout = {
      primary: { slug: TODAS[0], skinSeed: null, camoId: 'no-existe' },
      secondary: { slug: TODAS[1], skinSeed: null, camoId: null },
    }
    expect(camoForSlot(roto, 'primary')).toBeNull()
  })

  it('normalizeLoadout descarta un camo que ya no está en el catálogo', () => {
    const roto: Loadout = {
      primary: { slug: TODAS[0], skinSeed: null, camoId: 'camo-borrado' },
      secondary: { slug: TODAS[1], skinSeed: null, camoId: OTRO_CAMO },
    }
    const arreglado = normalizeLoadout(roto, NIVEL_INICIAL, [])
    expect(arreglado.primary.camoId).toBeNull()
    expect(arreglado.secondary.camoId).toBe(OTRO_CAMO)
  })

  it('si un guardado corrupto trae skin y camo a la vez, normalize deja sólo el camo', () => {
    // La exclusión no la garantiza sólo el equipar: un guardado editado a mano
    // puede traer las dos. Gana el camo (la vía nueva) y la skin se descarta,
    // aunque la skin esté en el inventario.
    const ambos: Loadout = {
      primary: { slug: TODAS[0], skinSeed: SKINS_INICIALES[0], camoId: CAMO },
      secondary: { slug: TODAS[1], skinSeed: null, camoId: null },
    }
    const arreglado = normalizeLoadout(ambos, NIVEL_INICIAL, SKINS_INICIALES)
    expect(arreglado.primary.camoId).toBe(CAMO)
    expect(arreglado.primary.skinSeed).toBeNull()
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

  it('lee el prestigio y los desbloqueos permanentes, y los clampea', () => {
    const data = parseProgress({
      ...createDefaultProgress(),
      prestigio: 99,
      desbloqueosPermanentes: [TODAS[30]],
    })
    expect(data.prestigio).toBe(PRESTIGIO_MAX)
    expect(data.desbloqueosPermanentes).toEqual([TODAS[30]])

    const basura = parseProgress({
      ...createDefaultProgress(),
      prestigio: 'tres',
      desbloqueosPermanentes: [1, 2],
    })
    expect(basura.prestigio).toBe(0)
    expect(basura.desbloqueosPermanentes).toEqual([])
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
 * `camoId` en el loadout se agregó SIN subir PROGRESS_VERSION (es aditivo, mismo
 * criterio que `historial`/`armas`/`medallas`). Un guardado anterior no lo trae
 * y tiene que seguir cargando entero. Y como el loadout viene de localStorage
 * —lo puede haber escrito otra versión, otra pestaña o la consola— nada de lo
 * que traiga en ese campo puede tirar: cae a null.
 */
describe('camo equipado en el guardado', () => {
  const CAMO = CATALOGO_CAMOS[0].id

  it('un loadout viejo sin camoId carga con camoId null, sin romper', () => {
    // El guardado anterior a esta capa: la entrada trae slug y skinSeed pero
    // NO camoId. No debe invalidar el guardado ni tirar; el campo cae a null.
    const viejo = {
      ...createDefaultProgress(),
      loadout: {
        primary: { slug: TODAS[0], skinSeed: null },
        secondary: { slug: TODAS[1], skinSeed: null },
      },
    }
    const data = parseProgress(viejo)
    expect(data.loadout.primary.camoId).toBeNull()
    expect(data.loadout.secondary.camoId).toBeNull()
    expect(camoForSlot(data.loadout, 'primary')).toBeNull()
  })

  it('un camoId con el tipo equivocado cae a null sin tirar', () => {
    for (const basura of [42, true, { id: CAMO }, ['x'], null]) {
      const data = parseProgress({
        ...createDefaultProgress(),
        loadout: {
          primary: { slug: TODAS[0], skinSeed: null, camoId: basura },
          secondary: { slug: TODAS[1], skinSeed: null, camoId: null },
        },
      })
      expect(data.loadout.primary.camoId).toBeNull()
      expect(data.loadout.primary.slug).not.toBeNull()
    }
  })

  it('un camoId string que no existe en el catálogo cae a null', () => {
    // Pasa el filtro de tipo de `leerEntrada` (es un string) pero lo descarta
    // `normalizeLoadout`, que es donde se valida contra el catálogo.
    const data = parseProgress({
      ...createDefaultProgress(),
      loadout: {
        primary: { slug: TODAS[0], skinSeed: null, camoId: 'camo-que-no-existe' },
        secondary: { slug: TODAS[1], skinSeed: null, camoId: null },
      },
    })
    expect(data.loadout.primary.camoId).toBeNull()
  })

  it('un camo válido sobrevive el round-trip y desplaza a la skin', () => {
    // El requisito del entregable: equipar un camo, recargar, sigue equipado.
    // Y como camo y skin son excluyentes, al recargar el camo gana y la skin
    // queda en null (aunque la seed esté en el inventario).
    const conCamo = equipCamo(
      equipSkin(createDefaultProgress().loadout, 'primary', SKINS_INICIALES[0]),
      'primary',
      CAMO,
    )
    const recargado = parseProgress(
      JSON.parse(JSON.stringify({ ...createDefaultProgress(), loadout: conCamo })),
    )
    expect(recargado.loadout.primary.camoId).toBe(CAMO)
    expect(recargado.loadout.primary.skinSeed).toBeNull()
    expect(camoForSlot(recargado.loadout, 'primary')?.id).toBe(CAMO)
    expect(skinForSlot(recargado.loadout, 'primary')).toBeNull()
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
    // Declara su curva a proposito. Este bloque prueba que faltan CAMPOS
    // (historial, armas, medallas, prestigio), no que cambie la curva de XP:
    // sin `curvaXp`, `parseProgress` lo tomaria por un guardado lineal viejo
    // y migraria la XP, mezclando dos preocupaciones y haciendo fallar la
    // asercion por el motivo equivocado. La migracion tiene sus propios
    // tests mas abajo.
    curvaXp: CURVA_XP_ACTUAL,
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
    //
    // La XP NO vuelve con el mismo numero, y esta bien: un guardado sin
    // `curvaXp` es de la curva lineal vieja y `parseProgress` lo migra a la
    // cuadratica. Lo que se conserva es el NIVEL, que es lo que el jugador
    // percibe como su progreso; el numero crudo es una unidad interna que
    // cambio de significado. Afirmar el numero seria fijar la curva vieja.
    // 4800 con la curva vieja (1200 por nivel) era nivel 5: 1 + 4800/1200.
    expect(accountLevel(data)).toBe(5)
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

describe('migración de la curva de xp', () => {
  /** Un guardado escrito por la versión anterior: misma forma, misma
   *  `version`, pero sin `curvaXp` y con la XP de la curva lineal de 1200. */
  function guardadoViejo(xp: number): Record<string, unknown> {
    const resto: Record<string, unknown> = { ...createDefaultProgress(), xp }
    delete resto.curvaXp
    return resto
  }

  const nivelViejo = (xp: number): number => 1 + Math.floor(xp / 1200)

  it('nadie baja de nivel al migrar', () => {
    // La propiedad que hace que la migración sea segura: si el nivel bajara,
    // se bloquearían armas que el jugador ya tenía en la armería.
    for (const xpVieja of [0, 1199, 1200, 5000, 28800, 30000, 100000, 480000]) {
      const migrado = parseProgress(guardadoViejo(xpVieja))
      expect(accountLevel(migrado)).toBe(Math.min(NIVEL_MAXIMO, nivelViejo(xpVieja)))
    }
  })

  it('una cuenta con mucha xp queda en el techo, no en cero', () => {
    // Con la curva vieja, 60 partidas dejaban al jugador en el nivel ~120.
    const migrado = parseProgress(guardadoViejo(486_000))
    expect(accountLevel(migrado)).toBe(NIVEL_MAXIMO)
    expect(migrado.xp).toBe(xpParaNivel(NIVEL_MAXIMO))
  })

  it('conserva las armas que el jugador ya tenía desbloqueadas', () => {
    const xpVieja = 30_000 // nivel 26 con la curva lineal
    const armasAntes = unlockedWeapons(nivelViejo(xpVieja))
    const migrado = parseProgress(guardadoViejo(xpVieja))
    for (const slug of armasAntes) {
      expect(unlockedWeapons(accountLevel(migrado))).toContain(slug)
    }
  })

  it('migra una sola vez: la segunda lectura ya no toca la xp', () => {
    // Si la marca de curva no se guardara, cada carga volvería a "migrar" y
    // la XP se iría multiplicando sola en cada arranque del juego.
    const migrado = parseProgress(guardadoViejo(30_000))
    expect(migrado.curvaXp).toBe(CURVA_XP_ACTUAL)
    const otraVez = parseProgress(JSON.parse(JSON.stringify(migrado)))
    expect(otraVez.xp).toBe(migrado.xp)
    const tercera = parseProgress(JSON.parse(JSON.stringify(otraVez)))
    expect(tercera.xp).toBe(migrado.xp)
  })

  it('un guardado nuevo no se migra', () => {
    const nuevo = { ...createDefaultProgress(), xp: 30_000 }
    expect(parseProgress(nuevo).xp).toBe(30_000)
  })

  it('el guardado viejo conserva rango, skins y contadores', () => {
    // La migración es de la XP y de nada más: el rango mide otra cosa.
    const viejo = {
      ...guardadoViejo(30_000),
      rank: { rank: 14, rr: 62, cushion: 1 },
      partidasJugadas: 41,
      victorias: 25,
      derrotas: 16,
    }
    const migrado = parseProgress(viejo)
    expect(migrado.rank).toEqual({ rank: 14, rr: 62, cushion: 1 })
    expect(migrado.partidasJugadas).toBe(41)
    expect(migrado.victorias).toBe(25)
    expect(migrado.derrotas).toBe(16)
    expect(migrado.skins).toEqual([...SKINS_INICIALES])
  })
})

describe('prestigio sobre el guardado completo', () => {
  const enElTecho = (): ProgressData => ({
    ...createDefaultProgress(),
    xp: xpParaNivel(NIVEL_MAXIMO),
    skins: [...SKINS_INICIALES, 'drop:9:12:2600'],
    rank: { rank: 17, rr: 45, cushion: 2 },
    partidasJugadas: 60,
    victorias: 33,
    derrotas: 27,
  })

  it('la tabla de qué se reinicia y qué se mantiene', () => {
    const antes = enElTecho()
    const resultado = prestigiar(prestigeFromProgress(antes), TODAS[35])
    expect(resultado.hecho).toBe(true)
    const despues = progressWithPrestige(antes, resultado.data)

    // Se reinicia.
    expect(despues.xp).toBe(0)
    expect(accountLevel(despues)).toBe(NIVEL_INICIAL)

    // Se mantiene.
    expect(despues.prestigio).toBe(1)
    expect(despues.rank).toEqual(antes.rank)
    expect(despues.placement).toEqual(antes.placement)
    expect(despues.skins).toEqual(antes.skins)
    expect(despues.partidasJugadas).toBe(60)
    expect(despues.victorias).toBe(33)
    expect(despues.derrotas).toBe(27)
    expect(despues.desbloqueosPermanentes).toEqual([TODAS[35]])
  })

  it('los campos que todavía no existen también sobreviven', () => {
    // El XP de arma y las medallas los están construyendo en paralelo y van
    // a entrar como campos nuevos de ProgressData. Este test es el contrato
    // con esos dos módulos: prestigiar no los puede borrar, ni siquiera por
    // olvido de quien escriba el campo.
    const conFuturo = {
      ...enElTecho(),
      xpPorArma: { 'assaultrifle-1': 4200 },
      medallas: ['primera-sangre'],
    } as unknown as ProgressData
    const despues = progressWithPrestige(
      conFuturo,
      prestigiar(prestigeFromProgress(conFuturo)).data,
    ) as unknown as Record<string, unknown>

    expect(despues.xpPorArma).toEqual({ 'assaultrifle-1': 4200 })
    expect(despues.medallas).toEqual(['primera-sangre'])
    expect(despues.xp).toBe(0)
  })

  it('el arma de la ficha sigue equipada después del reinicio', () => {
    // El caso concreto que rompería la promesa de la ficha: al volver a
    // nivel 1, la renormalización del loadout descartaría un arma tardía si
    // no se le pasaran los desbloqueos permanentes.
    const tardia = TODAS.reduce((a, b) => (unlockLevelFor(a) >= unlockLevelFor(b) ? a : b))
    expect(unlockLevelFor(tardia)).toBeGreaterThan(NIVEL_INICIAL)

    const antes: ProgressData = {
      ...enElTecho(),
      loadout: equipWeapon(createDefaultProgress().loadout, 'primary', tardia),
    }
    const despues = progressWithPrestige(antes, prestigiar(prestigeFromProgress(antes), tardia).data)

    expect(accountLevel(despues)).toBe(NIVEL_INICIAL)
    expect(despues.loadout.primary.slug).toBe(tardia)

    // Y sobrevive al round-trip por localStorage, que es donde de verdad
    // vuelve el jugador.
    const recargado = parseProgress(JSON.parse(JSON.stringify(despues)))
    expect(recargado.loadout.primary.slug).toBe(tardia)
    expect(recargado.desbloqueosPermanentes).toEqual([tardia])
  })

  it('sin la ficha, un arma tardía sí se descarta al reiniciar', () => {
    // El control del test anterior: si esto también pasara, aquel no estaría
    // probando que la ficha hace algo.
    const tardia = TODAS.reduce((a, b) => (unlockLevelFor(a) >= unlockLevelFor(b) ? a : b))
    const antes: ProgressData = {
      ...enElTecho(),
      loadout: equipWeapon(createDefaultProgress().loadout, 'primary', tardia),
    }
    const despues = progressWithPrestige(antes, prestigiar(prestigeFromProgress(antes)).data)
    expect(despues.loadout.primary.slug).not.toBe(tardia)
    expect(despues.loadout.primary.slug).not.toBeNull()
  })
})
