/**
 * Desglose de costo por sistema del frame: cuántos milisegundos de CPU se
 * van en física, IA, combate, feedback, viewmodel y render, además del HUD
 * agregado que ya existía (engine/stats.ts, "cuánto" pero no "qué").
 *
 * Estilo y contrato calcados de engine/gpu-timer.ts: un factory
 * createProfiler() que devuelve `stats` mutado in place más un puñado de
 * métodos que nunca asignan nada en el camino de frame. La diferencia con
 * gpu-timer.ts es el reloj: acá es inyectable (createProfiler(now) en vez
 * de performance.now() a pelo) porque los tests necesitan tiempos exactos y
 * determinísticos por sección -- algo que no se puede lograr confiando en
 * el reloj real.
 *
 * Las seis secciones son las divisiones reales de frame() en game.ts (ver
 * ahí los begin()/end() insertados, uno por cada llamada real que hace ese
 * trabajo -- no wrappers artificiales). "otro" no es una sección que nadie
 * marca: es total - suma(secciones), la sección fantasma que hace visible
 * cualquier costo del frame que quedó sin instrumentar. Sin este campo, un
 * desglose que "siempre cierra" sería indistinguible de uno que de verdad
 * cubre el frame entero -- ver profiler.test.ts, que verifica explícitamente
 * que "otro" puede dar distinto de cero.
 *
 * Dos entregas separadas, con costos separados a propósito:
 *  - Estado estable: mediana/p95 por sección sobre una ventana móvil de
 *    PROFILER_WINDOW_SIZE frames (`stats`). Recalcular esto significa
 *    ordenar la ventana -- barato pero no gratis (ver STATS_RECOMPUTE_INTERVAL_MS
 *    más abajo para por qué NO se recalcula los 240 frames por segundo).
 *  - Atribución de picos: cuando el frame supera el umbral derivado de la
 *    mediana vigente, se captura el desglose COMPLETO de ese frame puntual
 *    (no la mediana, que lo diluiría) y se emite una vez por consola.
 */

/** Las seis divisiones reales del frame (ver game.ts para dónde se marca
 *  cada una). El orden acá define el índice interno usado por los
 *  acumuladores y ventanas -- no importa afuera del módulo. */
export const PROFILER_SECTIONS = [
  'fisica',
  'ia',
  'combate',
  'feedback',
  'viewmodel',
  'render',
] as const

export type ProfilerSection = (typeof PROFILER_SECTIONS)[number]

const SECTION_COUNT = PROFILER_SECTIONS.length

/** Índice fijo de cada sección dentro de los arrays paralelos de abajo.
 *  Objeto creado una sola vez al cargar el módulo -- consultarlo en
 *  begin()/end() es una lectura de propiedad, no una asignación. */
const SECTION_INDEX: Record<ProfilerSection, number> = {
  fisica: 0,
  ia: 1,
  combate: 2,
  feedback: 3,
  viewmodel: 4,
  render: 5,
}

/** Ventana móvil para mediana/p95 (spec de la tarea: "120 frames alcanza").
 *  A 128Hz de tick -- o hasta 240fps de render en la máquina objetivo -- son
 *  entre medio segundo y un segundo de historia: alcanza para que la
 *  mediana no salte con cada frame individual, sin arrastrar minutos de
 *  historia vieja que ya no describe el estado actual del juego. */
export const PROFILER_WINDOW_SIZE = 120

/**
 * Múltiplo de la mediana vigente de costo TOTAL de frame que separa jitter
 * normal de un pico real (sección "Atribución de picos" de la tarea).
 *
 * Derivación -- razonada, no calibrada empíricamente. No existía todavía
 * telemetría real de estas seis secciones en la máquina objetivo (Ryzen
 * 5800X3D + RX 7900 XT): es justo lo que esta tarea existe para producir,
 * así que no hay un historial de p95/mediana propio del que tirar un
 * percentil, a diferencia de los guards de asignaciones (movement/
 * allocations.test.ts, combat/allocations.test.ts) que sí tienen corridas
 * reales de calibración.
 *
 * El razonamiento: el jitter normal de un motor con tick fijo (scheduling
 * del SO, un GC menor, ruido de medición) rara vez pasa de 2x-3x la
 * mediana estable de un frame sano. Una anomalía real -- compilación de
 * shader, un GC mayor, una ráfaga de trabajo que coincide en un mismo
 * frame -- es categóricamente distinta: el caso concreto que motiva esta
 * tarea (pico de GPU de 16.36ms contra 0.06ms de mediana de GPU medida en
 * la máquina objetivo, ver el brief) es ~270x la mediana, no 2x-3x. Ese
 * caso es de GPU (gpu-timer.ts ya lo trackea con su propio peakMs) pero
 * establece el orden de magnitud de una anomalía real en este juego contra
 * el de jitter normal.
 *
 * 4x cae, en escala logarítmica, a mitad de camino entre "el peor jitter
 * sano plausible" (~2-3x) y "la anomalía real más chica esperable" (~10x+):
 * dos veces de margen sobre el techo de jitter sano, y todavía muy por
 * debajo del piso de una anomalía real. Si al correr esto en la máquina
 * real el ratio de jitter sano resulta distinto, este es el primer número
 * para ajustar -- con datos reales en mano, cosa que hoy no existe.
 */
export const PEAK_THRESHOLD_MULTIPLIER = 4

/**
 * Cuánto esperar entre dos reportes de pico por consola (spec: "uno cada X
 * segundos", para que un problema sostenido no inunde la consola y la
 * vuelva inútil -- exactamente el resultado contrario al que se busca).
 * 2s: bastante espaciado como para no inundar (a 240fps serían hasta ~480
 * frames entre reportes si CADA frame fuera un pico) pero bastante
 * frecuente como para no perder de vista un problema que sigue activo
 * mientras se juega.
 */
export const PEAK_REPORT_COOLDOWN_MS = 2000

/** Cada cuánto se recalculan mediana/p95 (ordenar la ventana). No es gratis
 *  -- ver el informe de cierre de la tarea para el costo medido -- así que
 *  se throttlea a un ritmo similar al refresco del HUD (engine/stats.ts,
 *  HUD_INTERVAL_MS=250) en vez de recalcularse en cada uno de los hasta 240
 *  frames por segundo de la máquina objetivo: nadie mira un número que
 *  cambia más rápido de lo que el HUD lo puede pintar. */
const STATS_RECOMPUTE_INTERVAL_MS = 250

export interface SectionStats {
  medianMs: number
  p95Ms: number
}

export interface ProfilerStats {
  fisica: SectionStats
  ia: SectionStats
  combate: SectionStats
  feedback: SectionStats
  viewmodel: SectionStats
  render: SectionStats
  /** total - suma(secciones) de CADA frame de la ventana, no la resta de
   *  las medianas ya calculadas -- ver recomputeStats(). Es la sección
   *  fantasma: ver la cabecera del archivo. */
  otro: SectionStats
}

/** Desglose completo de un frame puntual que superó el umbral de pico.
 *  A diferencia de `stats` (mediana/p95 sobre la ventana), esto es el
 *  frame exacto que disparó el reporte -- un promedio lo diluiría, que es
 *  justo el problema que "atribución de picos" existe para evitar. */
export interface FramePeak {
  totalMs: number
  fisicaMs: number
  iaMs: number
  combateMs: number
  feedbackMs: number
  viewmodelMs: number
  renderMs: number
  otroMs: number
}

export interface Profiler {
  readonly stats: ProfilerStats
  /** Desglose del último pico reportado por consola, o null si todavía no
   *  hubo ninguno. Mismo objeto mutado in place entre picos (se asigna una
   *  sola vez, la primera vez que hace falta) -- no es una lista, es sólo
   *  para inspección/testing. */
  readonly lastPeak: FramePeak | null
  /** Arranca la contabilidad de un frame nuevo: resetea los acumuladores
   *  por sección a cero. Llamar una vez al principio de frame() en
   *  game.ts, junto a stats.beginFrame(). */
  beginFrame(): void
  /** Arranca la medición de una sección. Se puede llamar más de una vez
   *  por frame para la misma sección (p.ej. "fisica" e "ia" corren dentro
   *  del loop de ticks fijos, que puede iterar más de una vez por frame de
   *  render si el frame anterior fue largo) -- cada begin()/end() SUMA al
   *  acumulador de esa sección, no lo reemplaza. */
  begin(section: ProfilerSection): void
  /** Cierra la medición de una sección arrancada con begin() para la MISMA
   *  sección. Sin begin() previo en este frame es un no-op (no hay marca
   *  de inicio de la que restar). */
  end(section: ProfilerSection): void
  /** Cierra la contabilidad del frame: recibe el costo TOTAL de CPU del
   *  frame (game.ts lo saca de stats.stats.cpuMs, ya medido por
   *  engine/stats.ts -- no hace falta que este módulo mida el total por su
   *  cuenta con otro performance.now()). Deriva "otro", empuja la muestra
   *  a la ventana móvil, revisa si este frame es un pico y, según toque,
   *  recalcula mediana/p95. */
  endFrame(totalMs: number): void
}

/** Percentil por "nearest rank" sobre un array YA ordenado ascendente de
 *  longitud `n` (puede ser más corto que el array real -- ver n<len en
 *  profiler.test.ts para la ventana a medio llenar). `p` en [0,100]. No
 *  interpola entre vecinos: elige el rango más cercano. Alcanza para un
 *  HUD de diagnóstico -- no hace falta precisión estadística fina, y así
 *  es trivial de verificar a mano en un test. */
export function percentileOfSorted(sorted: ArrayLike<number>, n: number, p: number): number {
  if (n <= 0) return 0
  const idx = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1))
  return sorted[idx]
}

/** Mediana = percentil 50, mismo método "nearest rank" de arriba. */
export function medianOfSorted(sorted: ArrayLike<number>, n: number): number {
  return percentileOfSorted(sorted, n, 50)
}

function crearSectionStats(): SectionStats {
  return { medianMs: 0, p95Ms: 0 }
}

export function createProfiler(now: () => number = () => performance.now()): Profiler {
  // Acumulador del frame en curso: begin()/end() lo alimentan, posiblemente
  // más de una vez por sección (ver el comentario de `begin` en la
  // interfaz). beginFrame() lo resetea a cero; nunca se reasigna el array.
  const frameAccumMs = new Float64Array(SECTION_COUNT)
  // Timestamp del último begin() sin end() todavía, por sección.
  const sectionStartMs = new Float64Array(SECTION_COUNT)
  // Si hay un begin() pendiente de end() por sección -- sin esto, un end()
  // sin begin() previo en este frame restaría contra un timestamp de un
  // frame anterior (basura) en vez de ser el no-op documentado.
  const sectionOpen = new Uint8Array(SECTION_COUNT)

  // Ventana móvil: una por sección + una para "otro" + una para el total
  // (el total hace falta para derivar el umbral de pico contra la mediana
  // vigente de COSTO TOTAL, no de una sección suelta). Preasignadas una
  // sola vez acá, nunca en el camino de frame.
  const sectionWindows: Float64Array[] = []
  for (let i = 0; i < SECTION_COUNT; i++) sectionWindows.push(new Float64Array(PROFILER_WINDOW_SIZE))
  const otroWindow = new Float64Array(PROFILER_WINDOW_SIZE)
  const totalWindow = new Float64Array(PROFILER_WINDOW_SIZE)

  // Scratch reusado para ordenar una copia de la ventana activa al
  // recalcular mediana/p95 (ver recomputeStats). Un solo buffer para las
  // ocho ventanas -- se pisa cada vez, nunca se reasigna. Fuera del camino
  // de frame (sólo lo toca recomputeStats, throttleada más abajo).
  const sortScratch = new Float64Array(PROFILER_WINDOW_SIZE)

  let writeIndex = 0
  let filledCount = 0
  let lastStatsComputeMs = -1

  const stats: ProfilerStats = {
    fisica: crearSectionStats(),
    ia: crearSectionStats(),
    combate: crearSectionStats(),
    feedback: crearSectionStats(),
    viewmodel: crearSectionStats(),
    render: crearSectionStats(),
    otro: crearSectionStats(),
  }
  // Paralelo a sectionWindows/PROFILER_SECTIONS por índice -- evita repetir
  // seis veces el mismo bloque de recomputeOne() a mano.
  const statsBySection: SectionStats[] = [
    stats.fisica, stats.ia, stats.combate, stats.feedback, stats.viewmodel, stats.render,
  ]

  // Mediana vigente del costo TOTAL, cacheada -- -1 mismo sentinel que
  // gpu-timer.ts usa para "sin dato todavía" (GpuTimerStats.gpuMs). Es
  // contra esto que se compara cada frame para detectar un pico; se
  // refresca en recomputeStats(), throttleado, NUNCA con la muestra del
  // frame que se está evaluando (ver checkAndReportPeak).
  let totalMedianMs = -1

  let lastReportMs = Number.NEGATIVE_INFINITY
  let lastPeak: FramePeak | null = null

  /** Ordena una copia de `buffer[0..n)` en sortScratch y escribe
   *  mediana/p95 en `target`. `n` <= PROFILER_WINDOW_SIZE siempre. */
  function recomputeOne(target: SectionStats, buffer: Float64Array, n: number): void {
    for (let i = 0; i < n; i++) sortScratch[i] = buffer[i]
    const vista = sortScratch.subarray(0, n)
    vista.sort()
    target.medianMs = medianOfSorted(vista, n)
    target.p95Ms = percentileOfSorted(vista, n, 95)
  }

  function recomputeStats(): void {
    const n = filledCount
    if (n === 0) return
    for (let i = 0; i < SECTION_COUNT; i++) recomputeOne(statsBySection[i], sectionWindows[i], n)
    recomputeOne(stats.otro, otroWindow, n)

    for (let i = 0; i < n; i++) sortScratch[i] = totalWindow[i]
    const vistaTotal = sortScratch.subarray(0, n)
    vistaTotal.sort()
    totalMedianMs = medianOfSorted(vistaTotal, n)
  }

  /** Compara el frame que acaba de terminar contra la mediana vigente
   *  (previa a este mismo frame -- ver el comentario en endFrame sobre por
   *  qué el chequeo corre ANTES de empujar la muestra a la ventana) y, si
   *  corresponde, emite el desglose completo por consola. */
  function checkAndReportPeak(totalMs: number, otroMs: number, tMs: number): void {
    if (totalMedianMs < 0) return // sin mediana vigente todavía: nada con qué comparar
    const threshold = totalMedianMs * PEAK_THRESHOLD_MULTIPLIER
    if (totalMs <= threshold) return
    if (tMs - lastReportMs < PEAK_REPORT_COOLDOWN_MS) return // reporte reciente: throttleado

    lastReportMs = tMs
    if (!lastPeak) lastPeak = { totalMs: 0, fisicaMs: 0, iaMs: 0, combateMs: 0, feedbackMs: 0, viewmodelMs: 0, renderMs: 0, otroMs: 0 }
    lastPeak.totalMs = totalMs
    lastPeak.fisicaMs = frameAccumMs[SECTION_INDEX.fisica]
    lastPeak.iaMs = frameAccumMs[SECTION_INDEX.ia]
    lastPeak.combateMs = frameAccumMs[SECTION_INDEX.combate]
    lastPeak.feedbackMs = frameAccumMs[SECTION_INDEX.feedback]
    lastPeak.viewmodelMs = frameAccumMs[SECTION_INDEX.viewmodel]
    lastPeak.renderMs = frameAccumMs[SECTION_INDEX.render]
    lastPeak.otroMs = otroMs

    // Segundo argumento aparte (no interpolado en el string): pasar un
    // objeto le da a quien lee la consola algo inspeccionable, no sólo
    // texto. Copia superficial -- lastPeak se reusa entre picos, y sin
    // copiar, inspeccionar el log más tarde en una consola de navegador
    // mostraría el estado ACTUAL de lastPeak, no el de este pico puntual.
    console.warn(
      `profiler: pico de frame ${totalMs.toFixed(2)}ms ` +
        `(umbral ${threshold.toFixed(2)}ms = ${PEAK_THRESHOLD_MULTIPLIER}x mediana vigente ${totalMedianMs.toFixed(2)}ms)`,
      { ...lastPeak },
    )
  }

  return {
    stats,
    get lastPeak() {
      return lastPeak
    },

    beginFrame(): void {
      for (let i = 0; i < SECTION_COUNT; i++) {
        frameAccumMs[i] = 0
        sectionOpen[i] = 0
      }
    },

    begin(section: ProfilerSection): void {
      const idx = SECTION_INDEX[section]
      sectionStartMs[idx] = now()
      sectionOpen[idx] = 1
    },

    end(section: ProfilerSection): void {
      const idx = SECTION_INDEX[section]
      if (!sectionOpen[idx]) return // end() sin begin() previo en este frame: no-op
      frameAccumMs[idx] += now() - sectionStartMs[idx]
      sectionOpen[idx] = 0
    },

    endFrame(totalMs: number): void {
      const tMs = now()
      let sum = 0
      for (let i = 0; i < SECTION_COUNT; i++) sum += frameAccumMs[i]
      const otroMs = totalMs - sum

      // Chequeo de pico ANTES de empujar la muestra de este frame a la
      // ventana: "mediana vigente" tiene que salir de los frames
      // ANTERIORES, no contaminada por el propio frame que se está
      // evaluando -- si no, un pico real arrastraría su propia cola en la
      // ventana y el umbral subiría un poco cada vez que aparece, en vez
      // de quedarse quieto mientras dura el problema.
      checkAndReportPeak(totalMs, otroMs, tMs)

      for (let i = 0; i < SECTION_COUNT; i++) sectionWindows[i][writeIndex] = frameAccumMs[i]
      otroWindow[writeIndex] = otroMs
      totalWindow[writeIndex] = totalMs
      writeIndex = (writeIndex + 1) % PROFILER_WINDOW_SIZE
      if (filledCount < PROFILER_WINDOW_SIZE) filledCount++

      // Primera vez: recalcula ya (no hay "vigente" todavía, y sin esto el
      // HUD y el umbral de pico quedarían en cero hasta el primer refresco
      // de 250ms). De ahí en más, throttleado -- ver STATS_RECOMPUTE_INTERVAL_MS.
      if (lastStatsComputeMs < 0 || tMs - lastStatsComputeMs >= STATS_RECOMPUTE_INTERVAL_MS) {
        recomputeStats()
        lastStatsComputeMs = tMs
      }
    },
  }
}
