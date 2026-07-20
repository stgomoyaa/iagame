import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProfiler,
  medianOfSorted,
  percentileOfSorted,
  PEAK_REPORT_COOLDOWN_MS,
  PROFILER_WINDOW_SIZE,
} from '@/game/engine/profiler'

/** Reloj inyectado y controlado a mano -- ver la cabecera de profiler.ts
 *  sobre por qué el reloj es un parámetro y no performance.now() a pelo:
 *  begin()/end() necesitan avanzar en pasos EXACTOS y conocidos, cosa que
 *  performance.now() real no puede garantizar en un test. */
function crearReloj(): { now: () => number; avanzar: (ms: number) => void } {
  let t = 0
  return {
    now: () => t,
    avanzar: (ms: number) => {
      t += ms
    },
  }
}

// Red de seguridad para vi.spyOn(console, 'warn'): si una aserción tira
// ANTES de la llamada explícita a mockRestore() de un test, ese spy queda
// activo y contamina el conteo de llamadas del test siguiente (se
// confirmó en la práctica rompiendo la implementación a propósito, ver el
// informe de cierre de la tarea). afterEach corre pase lo que pase.
afterEach(() => {
  vi.restoreAllMocks()
})

describe('funciones puras de percentil', () => {
  it('percentileOfSorted con n<=0 devuelve 0', () => {
    expect(percentileOfSorted([], 0, 50)).toBe(0)
  })

  it('medianOfSorted/percentileOfSorted por nearest-rank sobre un array ordenado', () => {
    const sorted = [10, 20, 30, 40, 50]
    // rank = ceil(p/100 * n), índice = rank - 1 (ver la cabecera de profiler.ts).
    expect(medianOfSorted(sorted, 5)).toBe(30) // ceil(2.5)-1 = 2 -> 30
    expect(percentileOfSorted(sorted, 5, 95)).toBe(50) // ceil(4.75)-1 = 4 -> 50
  })

  it('con un solo elemento, mediana y p95 son ese elemento', () => {
    expect(medianOfSorted([7], 1)).toBe(7)
    expect(percentileOfSorted([7], 1, 95)).toBe(7)
  })
})

describe('profiler: acumulación por sección', () => {
  it('una sección que recibe 2ms entre begin y end reporta 2ms', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    p.begin('fisica')
    reloj.avanzar(2)
    p.end('fisica')
    p.endFrame(2)

    expect(p.stats.fisica.medianMs).toBe(2)
  })

  it('suma varios begin/end de la misma sección dentro de un mismo frame (loop de ticks fijos)', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    p.begin('fisica')
    reloj.avanzar(1)
    p.end('fisica')
    p.begin('fisica')
    reloj.avanzar(1.5)
    p.end('fisica')
    p.endFrame(2.5)

    expect(p.stats.fisica.medianMs).toBe(2.5)
  })

  it('beginFrame resetea el acumulador: un frame no arrastra el costo del anterior', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    p.begin('render')
    reloj.avanzar(9)
    p.end('render')
    p.endFrame(9)

    // Salto grande antes del segundo frame: recomputeStats() está
    // throttleado a STATS_RECOMPUTE_INTERVAL_MS (profiler.ts) para no
    // ordenar la ventana en cada frame -- sin este salto, `stats` seguiría
    // reflejando el cálculo del primer endFrame (el único que recalcula
    // sin condición, por ser el primero) y este test estaría verificando
    // el throttle, no el reset del acumulador.
    reloj.avanzar(1000)

    p.beginFrame()
    p.begin('render')
    reloj.avanzar(1)
    p.end('render')
    p.endFrame(1)

    expect(p.stats.render.medianMs).toBe(1)
  })

  it('end() sin begin() previo en el frame es un no-op, no resta contra basura de otro frame', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    reloj.avanzar(5)
    p.end('ia') // nunca hubo begin('ia') en este frame
    p.endFrame(5)

    expect(p.stats.ia.medianMs).toBe(0)
    expect(p.stats.otro.medianMs).toBe(5)
  })
})

describe('profiler: mediana y p95 sobre la ventana móvil', () => {
  /** Empuja un frame con un costo de 'render' conocido (y total = ese mismo
   *  valor, así que otro = 0 y no interfiere con este grupo de tests). El
   *  salto de reloj final es a propósito: recomputeStats() está throttleado
   *  a STATS_RECOMPUTE_INTERVAL_MS (profiler.ts) para no pagar el costo de
   *  ordenar la ventana en cada uno de los hasta 240 frames por segundo de
   *  la máquina objetivo -- sin este salto, sólo el PRIMER frame de la
   *  prueba recalcularía, y el resto quedaría leyendo stats viejos. */
  function empujarFrameRender(p: ReturnType<typeof createProfiler>, reloj: ReturnType<typeof crearReloj>, ms: number): void {
    p.beginFrame()
    p.begin('render')
    reloj.avanzar(ms)
    p.end('render')
    reloj.avanzar(1000) // fuerza que el próximo endFrame recalcule
    p.endFrame(ms)
  }

  it('mediana/p95 correctas con la ventana a medio llenar (primeros frames del juego)', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    // n=2, sorted=[10,30]: mediana (nearest-rank, idx=ceil(1)-1=0) -> 10;
    // p95 (idx=ceil(1.9)-1=1) -> 30.
    empujarFrameRender(p, reloj, 10)
    empujarFrameRender(p, reloj, 30)

    expect(p.stats.render.medianMs).toBe(10)
    expect(p.stats.render.p95Ms).toBe(30)
  })

  it('mediana/p95 correctas sobre una ventana conocida de 5 muestras', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    for (const ms of [10, 30, 20, 50, 40]) empujarFrameRender(p, reloj, ms)

    // sorted=[10,20,30,40,50]: mediana idx=ceil(2.5)-1=2 -> 30;
    // p95 idx=ceil(4.75)-1=4 -> 50.
    expect(p.stats.render.medianMs).toBe(30)
    expect(p.stats.render.p95Ms).toBe(50)
  })

  it('la ventana es un ring buffer: pasado PROFILER_WINDOW_SIZE, las muestras más viejas se descartan', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    // Llena la ventana entera con 1000ms -- un valor que, si sobreviviera
    // en la ventana, dispararía la mediana muchísimo por encima de lo que
    // se empuja después.
    for (let i = 0; i < PROFILER_WINDOW_SIZE; i++) empujarFrameRender(p, reloj, 1000)
    // Ahora la desplaza por completo con 2ms: si el ring buffer no
    // descartara lo viejo, la mediana seguiría cerca de 1000.
    for (let i = 0; i < PROFILER_WINDOW_SIZE; i++) empujarFrameRender(p, reloj, 2)

    expect(p.stats.render.medianMs).toBe(2)
    expect(p.stats.render.p95Ms).toBe(2)
  })
})

describe('profiler: "otro" no se pierde', () => {
  it('si el total es 5ms y las secciones instrumentadas suman 3ms, otro es 2ms', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    p.begin('fisica')
    reloj.avanzar(2)
    p.end('fisica')
    p.begin('combate')
    reloj.avanzar(1)
    p.end('combate')
    // ia/feedback/viewmodel/render quedan en 0 este frame.
    p.endFrame(5)

    expect(p.stats.otro.medianMs).toBe(2)
  })

  it('cuando las secciones instrumentadas cubren el total exacto, otro da cero -- no está forzado a ser != 0', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    p.begin('render')
    reloj.avanzar(4)
    p.end('render')
    p.endFrame(4)

    expect(p.stats.otro.medianMs).toBe(0)
  })

  it('si nada se instrumenta, TODO el frame cae en otro', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    p.beginFrame()
    reloj.avanzar(7)
    p.endFrame(7)

    expect(p.stats.otro.medianMs).toBe(7)
    expect(p.stats.fisica.medianMs).toBe(0)
  })
})

describe('profiler: atribución de picos', () => {
  /** Frame "plano": todo el costo cae en 'render', total = ese mismo valor
   *  (otro = 0). Sirve para establecer una mediana vigente estable antes
   *  de disparar un pico. */
  function framePlano(p: ReturnType<typeof createProfiler>, reloj: ReturnType<typeof crearReloj>, ms: number): void {
    p.beginFrame()
    p.begin('render')
    reloj.avanzar(ms)
    p.end('render')
    reloj.avanzar(300) // fuerza recompute de la mediana vigente en el próximo endFrame
    p.endFrame(ms)
  }

  it('sin mediana vigente todavía (primer frame), no hay pico que reportar', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Un único frame: no hay ningún frame ANTERIOR contra el que comparar
    // (ver el guard totalMedianMs<0 en checkAndReportPeak, profiler.ts).
    framePlano(p, reloj, 100)

    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('un frame varias veces por sobre la mediana vigente dispara un reporte con el desglose completo', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Mediana vigente ~1 tras varios frames planos de 1ms.
    framePlano(p, reloj, 1)
    framePlano(p, reloj, 1)
    framePlano(p, reloj, 1)
    expect(warnSpy).not.toHaveBeenCalled()

    // Pico: total=100, muy por sobre 1 * PEAK_THRESHOLD_MULTIPLIER.
    p.beginFrame()
    p.begin('fisica')
    reloj.avanzar(30)
    p.end('fisica')
    p.begin('render')
    reloj.avanzar(20)
    p.end('render')
    // fisica=30, render=20, resto=0 -> suma=50, total=100 -> otro=50.
    p.endFrame(100)

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(p.lastPeak).not.toBeNull()
    expect(p.lastPeak?.totalMs).toBe(100)
    expect(p.lastPeak?.fisicaMs).toBe(30)
    expect(p.lastPeak?.renderMs).toBe(20)
    expect(p.lastPeak?.iaMs).toBe(0)
    expect(p.lastPeak?.otroMs).toBe(50)
  })

  it('respeta el cooldown entre reportes: un segundo pico inmediato no reporta, uno después del cooldown sí', () => {
    const reloj = crearReloj()
    const p = createProfiler(reloj.now)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    framePlano(p, reloj, 1)
    framePlano(p, reloj, 1)

    function picoDe(ms: number): void {
      p.beginFrame()
      p.begin('render')
      reloj.avanzar(ms)
      p.end('render')
      p.endFrame(ms)
    }

    picoDe(100)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Segundo pico casi inmediato (el reloj apenas avanzó dentro del propio
    // begin/end de arriba): todavía dentro del cooldown.
    picoDe(100)
    expect(warnSpy).toHaveBeenCalledTimes(1)

    // Pasado el cooldown, un pico nuevo sí debe reportar.
    reloj.avanzar(PEAK_REPORT_COOLDOWN_MS + 1)
    picoDe(100)
    expect(warnSpy).toHaveBeenCalledTimes(2)
  })
})

describe('presupuesto de asignaciones del profiler', () => {
  it('miles de frames de profiling no hacen crecer el heap de forma sostenida', () => {
    // Ver movement/allocations.test.ts para el patrón base. Sin --expose-gc
    // esto sería un no-op silencioso, así que falla fuerte en vez de
    // degradar en silencio.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const reloj = crearReloj()
    const p = createProfiler(reloj.now)

    function unFrame(): void {
      p.beginFrame()
      p.begin('fisica')
      reloj.avanzar(0.1)
      p.end('fisica')
      p.begin('ia')
      reloj.avanzar(0.05)
      p.end('ia')
      p.begin('combate')
      reloj.avanzar(0.02)
      p.end('combate')
      p.begin('feedback')
      reloj.avanzar(0.01)
      p.end('feedback')
      p.begin('viewmodel')
      reloj.avanzar(0.03)
      p.end('viewmodel')
      p.begin('render')
      reloj.avanzar(0.15)
      p.end('render')
      // Total > suma de secciones (0.36) a propósito: dt real de "otro"
      // en cada frame, así este guard también ejercita esa rama.
      reloj.avanzar(0.5)
      p.endFrame(0.86)
    }

    // Calentar: JIT y asentar ring buffers/scratch antes de medir.
    for (let i = 0; i < 5000; i++) unFrame()

    // gc() sólo antes de la lectura inicial, igual que
    // movement/allocations.test.ts: un objeto transitorio por frame (que
    // nunca se acumula) sigue en el heap si no se barre DESPUÉS también.
    // A diferencia de movement/allocations.test.ts, acá SÍ hay basura
    // transitoria real y a propósito (las vistas .subarray() de
    // recomputeStats, throttleadas): por eso este test usa el patrón de
    // combat/allocations.test.ts (gc() antes Y después) en vez del de
    // movement -- ver el comentario de ese archivo sobre por qué gc() de
    // los dos lados no puede ocultar una fuga real, sólo el ruido de
    // cuándo cae el próximo GC menor de V8.
    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    // 300k, no 50k: una fuga chica y realista para este código -- un
    // primitivo (number/boolean) retenido por frame, del orden de 8-16
    // bytes -- queda por debajo del ruido de GC a 50k frames (se probó: un
    // array que retiene un `number` por frame, 55k pushes, dio ~0.43MB,
    // invisible contra un umbral calibrado a los ~0.15MB de ruido de esa
    // escala). A 300k frames esa misma fuga escala a ~2.4MB, separada del
    // ruido con margen -- mismo criterio de escala que
    // movement/allocations.test.ts (300k ticks por la misma razón).
    const ITERACIONES = 300_000
    for (let i = 0; i < ITERACIONES; i++) unFrame()

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Calibrado (Node v26, --expose-gc, 4 corridas de 300k frames cada una
    // sobre el mismo profiler tras el calentamiento de arriba): 0.045-0.048MB,
    // sin tendencia creciente pese a 6x más frames que a 50k (confirma que
    // es ruido de GC menor de las vistas .subarray() transitorias de
    // recomputeStats, no una fuga -- una fuga real habría escalado con la
    // cantidad de frames). 0.5MB deja >10x de margen sobre el ruido
    // observado. Se verificó a mano que este guard SÍ detecta una fuga real
    // del tamaño que este código podría producir por error: un `number`
    // retenido por frame (p.ej. push a un array que nunca se vacía) da
    // ~2.4MB a esta escala, muy por encima del umbral -- ver el informe de
    // cierre de la tarea. Con una fuga de OBJETOS (el tipo de bug más
    // probable si alguien reintrodujera una asignación en begin()/end()) la
    // separación sería aún mayor.
    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
