/**
 * Tests del detector de medallas.
 *
 * El foco está puesto donde de verdad se rompe esto: **las ventanas**. Para
 * cada medalla con ventana hay un par de casos "justo adentro / justo
 * afuera", porque un test que sólo verifica el caso adentro pasa igual con
 * la ventana puesta en infinito -- que es exactamente el bug que convierte
 * una medalla en ruido. Ver el bloque final de mutación: ahí se documenta,
 * ventana por ventana, qué test falla si alguien la afloja.
 */

import { describe, expect, it } from 'vitest'
import {
  createKillContext,
  createMedalTracker,
  finalizarMedallas,
  listActiveAwardsNewestFirst,
  MEDALLAS_TUNING,
  registrarDanoMedallas,
  registrarKillMedallas,
  registrarReaparicionMedallas,
  stepMedallas,
  tallyDeMedallas,
  vecesGanada,
  type MedalTrackerState,
  type MedalTuning,
} from '@/game/match/medal-tracker'
import { CATALOGO_MEDALLAS, MEDALLA, MEDALLAS_TOTALES } from '@/game/progression/medals'
import type { MatchMode } from '@/game/match/types'

const T: MedalTuning = MEDALLAS_TUNING

/** Diez participantes: 0 es el seguido. En TDM eso lo pone en el equipo 0
 *  junto con 2,4,6,8; los impares son el equipo rival. */
function tracker(mode: MatchMode = 'tdm', seguido = 0, participantes = 10): MedalTrackerState {
  return createMedalTracker(mode, participantes, seguido)
}

/**
 * Registra una baja. Los defaults están elegidos para NO disparar ninguna
 * medalla condicional: distancia en el medio de la distribución (ni larga ni
 * a quemarropa), cargador a la mitad, vida llena. Así, cuando un test ve una
 * medalla, es porque el caso que ese test montó la produjo, y no porque el
 * helper la regale.
 */
function matar(
  state: MedalTrackerState,
  killerId: number,
  victimId: number,
  tiempoS: number,
  extra: Partial<{ headshot: boolean; distanciaM: number; balasRestantes: number; vidaDelKiller: number }> = {},
): void {
  const ctx = createKillContext()
  ctx.killerId = killerId
  ctx.victimId = victimId
  ctx.tiempoS = tiempoS
  ctx.headshot = extra.headshot ?? false
  ctx.distanciaM = extra.distanciaM ?? 12
  ctx.balasRestantes = extra.balasRestantes ?? 15
  ctx.vidaDelKiller = extra.vidaDelKiller ?? 100
  registrarKillMedallas(state, ctx, T)
}

describe('catálogo de medallas', () => {
  it('cada id con nombre apunta al slug que dice, y el índice del array coincide con el id', () => {
    // MEDALLA.* se usa como índice de Int32Array en el camino caliente: si
    // el catálogo se reordena sin actualizar el mapa, las medallas se
    // otorgarían cruzadas y nada tiraría un error.
    expect(CATALOGO_MEDALLAS).toHaveLength(15)
    CATALOGO_MEDALLAS.forEach((def, i) => expect(def.id).toBe(i))
    expect(CATALOGO_MEDALLAS[MEDALLA.primeraSangre].slug).toBe('primera-sangre')
    expect(CATALOGO_MEDALLAS[MEDALLA.dobleBaja].slug).toBe('doble-baja')
    expect(CATALOGO_MEDALLAS[MEDALLA.tripleBaja].slug).toBe('triple-baja')
    expect(CATALOGO_MEDALLAS[MEDALLA.masacre].slug).toBe('masacre')
    expect(CATALOGO_MEDALLAS[MEDALLA.headshot].slug).toBe('headshot')
    expect(CATALOGO_MEDALLAS[MEDALLA.rachaDe5].slug).toBe('racha-de-5')
    expect(CATALOGO_MEDALLAS[MEDALLA.rachaDe10].slug).toBe('racha-de-10')
    expect(CATALOGO_MEDALLAS[MEDALLA.clutch].slug).toBe('clutch')
    expect(CATALOGO_MEDALLAS[MEDALLA.venganza].slug).toBe('venganza')
    expect(CATALOGO_MEDALLAS[MEDALLA.salvada].slug).toBe('salvada')
    expect(CATALOGO_MEDALLAS[MEDALLA.tiroLargo].slug).toBe('tiro-largo')
    expect(CATALOGO_MEDALLAS[MEDALLA.aQuemarropa].slug).toBe('a-quemarropa')
    expect(CATALOGO_MEDALLAS[MEDALLA.ultimaBala].slug).toBe('ultima-bala')
    expect(CATALOGO_MEDALLAS[MEDALLA.sinMorir].slug).toBe('sin-morir')
    expect(CATALOGO_MEDALLAS[MEDALLA.dominacion].slug).toBe('dominacion')
  })

  it('los slugs son kebab-case único, que es lo que los hace servir de nombre de archivo', () => {
    const vistos = new Set<string>()
    for (const def of CATALOGO_MEDALLAS) {
      expect(def.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(vistos.has(def.slug), `slug duplicado: ${def.slug}`).toBe(false)
      vistos.add(def.slug)
      expect(def.nombre.length).toBeGreaterThan(0)
      expect(def.descripcion.length).toBeGreaterThan(0)
      expect(def.xp).toBeGreaterThan(0)
    }
  })
})

describe('primera sangre', () => {
  it('la cobra el seguido si la primera baja de la partida es suya', () => {
    const s = tracker()
    matar(s, 0, 1, 10)
    expect(vecesGanada(s, MEDALLA.primeraSangre)).toBe(1)
  })

  it('NO la cobra si un bot mató antes, aunque el seguido mate un instante después', () => {
    const s = tracker()
    matar(s, 3, 5, 9.9)
    matar(s, 0, 1, 10)
    expect(vecesGanada(s, MEDALLA.primeraSangre)).toBe(0)
  })

  it('se cobra una sola vez por partida', () => {
    const s = tracker()
    matar(s, 0, 1, 10)
    matar(s, 0, 3, 60)
    expect(vecesGanada(s, MEDALLA.primeraSangre)).toBe(1)
  })
})

describe('andanada: doble, triple y masacre', () => {
  it('dos bajas dentro de la ventana pagan doble baja', () => {
    const s = tracker()
    matar(s, 0, 1, 10)
    matar(s, 0, 3, 10 + T.ventanaMultikillS - 0.1)
    expect(vecesGanada(s, MEDALLA.dobleBaja)).toBe(1)
  })

  it('dos bajas separadas por MÁS que la ventana no pagan nada', () => {
    // Este es el test que hace que la ventana exista de verdad. Sin él,
    // ventanaMultikillS = Infinity pasaría toda la suite.
    const s = tracker()
    matar(s, 0, 1, 10)
    matar(s, 0, 3, 10 + T.ventanaMultikillS + 0.1)
    expect(vecesGanada(s, MEDALLA.dobleBaja)).toBe(0)
  })

  it('ANCLA ABSOLUTA: dos bajas a 2 s de distancia son una doble baja', () => {
    // Ancla contra achicar la ventana: los tests que usan
    // `T.ventanaMultikillS - 0.1` mueven su caso junto con la constante y
    // sobreviven a que alguien la baje a 0.2 s. Dos segundos es, sin
    // discusión, el mismo enfrentamiento.
    const s = tracker()
    matar(s, 0, 1, 10)
    matar(s, 0, 3, 12)
    expect(vecesGanada(s, MEDALLA.dobleBaja)).toBe(1)
  })

  it('la ventana se mide contra la baja ANTERIOR, no contra el inicio de la andanada', () => {
    const s = tracker()
    matar(s, 0, 1, 0)
    matar(s, 0, 3, 3)
    matar(s, 0, 5, 6)
    // 0 -> 6 son 6 s, más que la ventana de 4, pero cada eslabón está a 3 s.
    expect(vecesGanada(s, MEDALLA.tripleBaja)).toBe(1)
  })

  it('una andanada de cinco paga cada escalón exactamente una vez', () => {
    const s = tracker()
    for (let i = 0; i < 5; i++) matar(s, 0, i + 1, i * 1)
    expect(vecesGanada(s, MEDALLA.dobleBaja)).toBe(1)
    expect(vecesGanada(s, MEDALLA.tripleBaja)).toBe(1)
    expect(vecesGanada(s, MEDALLA.masacre)).toBe(1)
  })

  it('morir corta la andanada', () => {
    const s = tracker()
    matar(s, 0, 1, 10)
    matar(s, 1, 0, 10.5)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 3, 11)
    expect(vecesGanada(s, MEDALLA.dobleBaja)).toBe(0)
  })
})

describe('rachas', () => {
  it('la racha de 5 se paga en la quinta baja y no antes', () => {
    const s = tracker()
    for (let i = 0; i < 4; i++) matar(s, 0, 1, i * 30)
    expect(vecesGanada(s, MEDALLA.rachaDe5)).toBe(0)
    matar(s, 0, 1, 4 * 30)
    expect(vecesGanada(s, MEDALLA.rachaDe5)).toBe(1)
  })

  it('una racha de 12 paga el escalón de 5 y el de 10, no uno por baja', () => {
    const s = tracker()
    for (let i = 0; i < 12; i++) matar(s, 0, 1, i * 30)
    expect(vecesGanada(s, MEDALLA.rachaDe5)).toBe(1)
    expect(vecesGanada(s, MEDALLA.rachaDe10)).toBe(1)
  })

  it('morir reinicia la racha a cero', () => {
    const s = tracker()
    for (let i = 0; i < 4; i++) matar(s, 0, 1, i * 30)
    matar(s, 1, 0, 200)
    registrarReaparicionMedallas(s, 0)
    for (let i = 0; i < 4; i++) matar(s, 0, 1, 210 + i * 30)
    // Ocho bajas en total, pero nunca cinco seguidas.
    expect(vecesGanada(s, MEDALLA.rachaDe5)).toBe(0)
  })
})

describe('venganza', () => {
  it('matar a quien te mató dentro de la ventana la paga', () => {
    const s = tracker()
    matar(s, 1, 0, 100)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 1, 100 + T.ventanaVenganzaS - 0.1)
    expect(vecesGanada(s, MEDALLA.venganza)).toBe(1)
  })

  it('fuera de la ventana no la paga', () => {
    const s = tracker()
    matar(s, 1, 0, 100)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 1, 100 + T.ventanaVenganzaS + 0.1)
    expect(vecesGanada(s, MEDALLA.venganza)).toBe(0)
  })

  it('ANCLA ABSOLUTA: cobrársela 5 s después es una venganza', () => {
    const s = tracker()
    matar(s, 1, 0, 100)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 1, 105)
    expect(vecesGanada(s, MEDALLA.venganza)).toBe(1)
  })

  it('sólo cuenta contra quien te mató, no contra cualquiera', () => {
    const s = tracker()
    matar(s, 1, 0, 100)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 3, 101)
    expect(vecesGanada(s, MEDALLA.venganza)).toBe(0)
  })

  it('una sola muerte no paga dos venganzas', () => {
    const s = tracker()
    matar(s, 1, 0, 100)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 1, 101)
    matar(s, 0, 1, 102)
    expect(vecesGanada(s, MEDALLA.venganza)).toBe(1)
  })
})

describe('salvada', () => {
  it('matar al que le venía pegando a un compañero la paga', () => {
    const s = tracker('tdm')
    // 2 es compañero del seguido (mismo equipo por paridad); 1 es rival.
    registrarDanoMedallas(s, 1, 2, 50)
    matar(s, 0, 1, 50 + T.ventanaSalvadaS - 0.1)
    expect(vecesGanada(s, MEDALLA.salvada)).toBe(1)
  })

  it('fuera de la ventana no la paga', () => {
    const s = tracker('tdm')
    registrarDanoMedallas(s, 1, 2, 50)
    matar(s, 0, 1, 50 + T.ventanaSalvadaS + 0.1)
    expect(vecesGanada(s, MEDALLA.salvada)).toBe(0)
  })

  it('el daño hecho AL PROPIO seguido no es una salvada: eso es defensa propia', () => {
    const s = tracker('tdm')
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50.5)
    expect(vecesGanada(s, MEDALLA.salvada)).toBe(0)
  })

  it('en FFA no existe: nadie tiene compañeros a quienes salvar', () => {
    const s = tracker('ffa')
    registrarDanoMedallas(s, 1, 2, 50)
    matar(s, 0, 1, 50.5)
    expect(vecesGanada(s, MEDALLA.salvada)).toBe(0)
  })
})

describe('clutch', () => {
  it('con la vida en rojo y contra quien te venía pegando, la paga', () => {
    const s = tracker()
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50 + T.ventanaClutchS - 0.1, { vidaDelKiller: T.clutchVidaMaxima })
    expect(vecesGanada(s, MEDALLA.clutch)).toBe(1)
  })

  it('con la vida alta no la paga aunque te vinieran pegando', () => {
    const s = tracker()
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50.5, { vidaDelKiller: T.clutchVidaMaxima + 1 })
    expect(vecesGanada(s, MEDALLA.clutch)).toBe(0)
  })

  it('ANCLA ABSOLUTA: con la vida INTACTA nunca es un clutch, valga lo que valga el umbral', () => {
    // Este test usa 100 literal y no `T.clutchVidaMaxima + 1` a propósito.
    // El de arriba, que sí deriva su valor del tuning, sobrevive a subir el
    // umbral a 100: el caso de prueba se mueve junto con la constante y el
    // test se autoanula. Es el mismo error que este proyecto ya se comió
    // una vez (un test que comparaba contra la misma constante que se
    // mutaba), así que la ventana necesita un ancla que NO dependa de ella.
    const s = tracker()
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50.5, { vidaDelKiller: 100 })
    expect(vecesGanada(s, MEDALLA.clutch)).toBe(0)
  })

  it('con la vida en rojo pero sin duelo reciente no la paga: arrastrar vida baja no es una gesta', () => {
    const s = tracker()
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50 + T.ventanaClutchS + 0.1, { vidaDelKiller: 10 })
    expect(vecesGanada(s, MEDALLA.clutch)).toBe(0)
  })

  it('funciona igual en FFA, que es el motivo por el que se redefinió', () => {
    const s = tracker('ffa')
    registrarDanoMedallas(s, 1, 0, 50)
    matar(s, 0, 1, 50.5, { vidaDelKiller: 20 })
    expect(vecesGanada(s, MEDALLA.clutch)).toBe(1)
  })
})

describe('distancia y cargador', () => {
  it('tiro largo desde el umbral, no desde un metro menos', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { distanciaM: T.distanciaTiroLargoM })
    matar(s, 0, 3, 100, { distanciaM: T.distanciaTiroLargoM - 0.1 })
    expect(vecesGanada(s, MEDALLA.tiroLargo)).toBe(1)
  })

  it('a quemarropa hasta el umbral, no un metro más', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { distanciaM: T.distanciaQuemarropaM })
    matar(s, 0, 3, 100, { distanciaM: T.distanciaQuemarropaM + 0.1 })
    expect(vecesGanada(s, MEDALLA.aQuemarropa)).toBe(1)
  })

  it('una baja no puede ser larga y a quemarropa a la vez', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { distanciaM: T.distanciaTiroLargoM })
    expect(vecesGanada(s, MEDALLA.aQuemarropa)).toBe(0)
  })

  it('última bala sólo con el cargador en cero', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { balasRestantes: 0 })
    matar(s, 0, 3, 100, { balasRestantes: 1 })
    expect(vecesGanada(s, MEDALLA.ultimaBala)).toBe(1)
  })
})

describe('dominación', () => {
  it('tres bajas sobre el mismo rival la pagan', () => {
    const s = tracker()
    for (let i = 0; i < T.dominacionBajas; i++) matar(s, 0, 1, i * 30)
    expect(vecesGanada(s, MEDALLA.dominacion)).toBe(1)
  })

  it('tres bajas repartidas entre rivales distintos no la pagan', () => {
    const s = tracker()
    matar(s, 0, 1, 0)
    matar(s, 0, 3, 30)
    matar(s, 0, 5, 60)
    expect(vecesGanada(s, MEDALLA.dominacion)).toBe(0)
  })

  it('que el rival te devuelva una reinicia la cuenta sobre él', () => {
    const s = tracker()
    matar(s, 0, 1, 0)
    matar(s, 0, 1, 30)
    matar(s, 1, 0, 60)
    registrarReaparicionMedallas(s, 0)
    matar(s, 0, 1, 90)
    expect(vecesGanada(s, MEDALLA.dominacion)).toBe(0)
  })

  it('seis seguidas sobre el mismo rival pagan dos', () => {
    const s = tracker()
    for (let i = 0; i < 6; i++) matar(s, 0, 1, i * 30)
    expect(vecesGanada(s, MEDALLA.dominacion)).toBe(2)
  })
})

describe('sin morir (supervivencia)', () => {
  function correrSegundos(s: MedalTrackerState, segundos: number, desdeS = 0): void {
    const dt = 1 / 60
    for (let i = 0; i < Math.round(segundos / dt); i++) stepMedallas(s, dt, desdeS + i * dt, T)
  }

  it('se paga al cruzar el umbral, con bajas hechas en esa vida', () => {
    const s = tracker()
    for (let i = 0; i < T.supervivenciaBajasMinimas; i++) matar(s, 0, 1, i)
    correrSegundos(s, T.supervivenciaS - 1)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(0)
    correrSegundos(s, 2, T.supervivenciaS - 1)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(1)
  })

  it('ANCLA ABSOLUTA: diez segundos vivo no son "sin morir", valga lo que valga el umbral', () => {
    const s = tracker()
    for (let i = 0; i < T.supervivenciaBajasMinimas; i++) matar(s, 0, 1, i)
    correrSegundos(s, 10)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(0)
  })

  it('sobrevivir sin pelear no la paga: esconderse no es una gesta', () => {
    const s = tracker()
    correrSegundos(s, T.supervivenciaS + 5)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(0)
  })

  it('morir reinicia el reloj', () => {
    const s = tracker()
    for (let i = 0; i < T.supervivenciaBajasMinimas; i++) matar(s, 0, 1, i)
    correrSegundos(s, T.supervivenciaS - 5)
    matar(s, 1, 0, T.supervivenciaS)
    registrarReaparicionMedallas(s, 0)
    correrSegundos(s, 10, T.supervivenciaS)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(0)
  })

  it('el reloj no corre mientras estás muerto', () => {
    // Se afirma sobre `tiempoVivoS` y no sólo sobre la medalla a propósito.
    // Mirar la medalla sola NO alcanza: al morir también se reinicia
    // `killsEnVidaActual`, así que la medalla no salta igual aunque el
    // reloj siga corriendo, y el test pasa con el bug puesto. Verificado
    // mutando el guard de "está vivo": con la medalla sola, la mutación
    // sobrevivía; con esta línea, muere.
    const s = tracker()
    for (let i = 0; i < T.supervivenciaBajasMinimas; i++) matar(s, 0, 1, i)
    matar(s, 1, 0, 5)
    expect(s.tiempoVivoS).toBe(0)
    correrSegundos(s, T.supervivenciaS * 2, 5)
    expect(s.tiempoVivoS).toBe(0)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(0)
  })

  it('una vida muy larga la paga una sola vez', () => {
    const s = tracker()
    for (let i = 0; i < T.supervivenciaBajasMinimas; i++) matar(s, 0, 1, i)
    correrSegundos(s, T.supervivenciaS * 3)
    expect(vecesGanada(s, MEDALLA.sinMorir)).toBe(1)
  })
})

describe('avisos en pantalla', () => {
  it('un aviso envejece y se apaga solo', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { headshot: true })
    expect(listActiveAwardsNewestFirst(s).length).toBeGreaterThan(0)
    for (let i = 0; i < Math.ceil(T.avisoDuracionS * 60) + 2; i++) stepMedallas(s, 1 / 60, 10, T)
    expect(listActiveAwardsNewestFirst(s)).toHaveLength(0)
  })

  it('se listan del más nuevo al más viejo', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { headshot: true })
    matar(s, 0, 3, 11, { distanciaM: T.distanciaTiroLargoM })
    const activos = listActiveAwardsNewestFirst(s)
    expect(activos.length).toBeGreaterThanOrEqual(2)
    for (let i = 1; i < activos.length; i++) expect(activos[i - 1].seq).toBeGreaterThan(activos[i].seq)
  })

  it('más medallas que capacidad del anillo degradan sin crecer ni tirar', () => {
    const s = tracker()
    for (let i = 0; i < T.avisosMaximos * 3; i++) matar(s, 0, 1, i * 100, { headshot: true })
    expect(s.avisos.items).toHaveLength(T.avisosMaximos)
    expect(listActiveAwardsNewestFirst(s).length).toBeLessThanOrEqual(T.avisosMaximos)
    // El conteo NO se pierde aunque el aviso se recicle: el anillo es la
    // pantalla, no la contabilidad.
    expect(vecesGanada(s, MEDALLA.headshot)).toBe(T.avisosMaximos * 3)
  })
})

describe('robustez y cierre', () => {
  it('ids fuera de rango se ignoran en vez de corromper el conteo', () => {
    const s = tracker()
    matar(s, 99, 1, 10)
    matar(s, 0, -1, 10)
    matar(s, 0, 999, 10)
    registrarDanoMedallas(s, 99, 2, 10)
    registrarReaparicionMedallas(s, 42)
    expect(s.conteo.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('después de finalizar, ningún evento tardío suma nada', () => {
    const s = tracker()
    finalizarMedallas(s)
    matar(s, 0, 1, 10, { headshot: true })
    stepMedallas(s, 1, 10, T)
    expect(s.conteo.reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('el tally sale por slug y sólo incluye lo ganado', () => {
    const s = tracker()
    matar(s, 0, 1, 10, { headshot: true })
    const tally = tallyDeMedallas(s)
    expect(tally['headshot']).toBe(1)
    expect(tally['primera-sangre']).toBe(1)
    expect(tally['masacre']).toBeUndefined()
  })

  it('el conteo tiene una casilla por medalla del catálogo', () => {
    expect(tracker().conteo).toHaveLength(MEDALLAS_TOTALES)
  })
})

describe('cero asignaciones en el camino de eventos de combate', () => {
  it('registrar bajas y daño y avanzar el frame no hace crecer el heap sostenidamente', () => {
    // Mismo patrón y misma derivación de umbral que
    // bots/allocations.test.ts: el guard tiene que poder detectar una fuga
    // tan chica como un number retenido por iteración (~8 bytes en V8).
    // Para superar 0.5MB con margen 3x: ITERS >= 3 * 0.5 * 1048576 / 8 =
    // 196_608. Se usan 200_000.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const s = tracker('tdm', 0, 10)
    const ctx = createKillContext()

    function iterar(i: number): void {
      const t = i * 0.05
      ctx.killerId = i % 2 === 0 ? 0 : 1
      ctx.victimId = i % 2 === 0 ? 1 + (i % 4) : 0
      ctx.headshot = i % 3 === 0
      ctx.distanciaM = 5 + (i % 40)
      ctx.balasRestantes = i % 30
      ctx.vidaDelKiller = i % 100
      ctx.tiempoS = t
      registrarKillMedallas(s, ctx, T)
      registrarDanoMedallas(s, 1 + (i % 8), i % 5, t)
      registrarReaparicionMedallas(s, i % 10)
      stepMedallas(s, 1 / 60, t, T)
    }

    for (let i = 0; i < 5000; i++) iterar(i)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    const ITERS = 200_000
    for (let i = 0; i < ITERS; i++) iterar(i)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
