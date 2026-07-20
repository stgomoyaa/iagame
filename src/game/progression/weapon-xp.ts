/**
 * XP por arma: la tercera barra de la progresión, y la única que escala con
 * el catálogo en vez de con el tiempo del jugador.
 *
 * Las otras dos capas ya existen y miden otra cosa:
 *
 * - **Nivel de cuenta** (unlocks.ts) mide cuánto jugaste, y DESBLOQUEA el
 *   arma.
 * - **Rango competitivo** (ranks.ts, rr.ts) mide qué tan bien jugás.
 * - **Nivel de arma** (este archivo) mide cuánto usaste ESA arma, y es lo
 *   que pasa DESPUÉS de tenerla desbloqueada.
 *
 * La separación con el rango es dura y no se cruza: acá no se lee ni se
 * escribe `RankState` ni RR, y subir un arma a nivel 5 no mueve la escalera
 * ni un punto. Si el uso de un arma diera rango, el rango dejaría de
 * significar habilidad y pasaría a significar constancia, que es justo lo que
 * ya mide el nivel de cuenta.
 *
 *
 * POR QUÉ ESTA CAPA PAGA MÁS QUE LAS OTRAS
 *
 * Hay 148 armas. Que cada una suba con su propio uso son 148 barras de
 * progresión a costo de una tabla de cuatro números, y es la razón concreta
 * por la que alguien equipa un arma que no le gusta: para subirla. Ninguna
 * otra capa produce ese comportamiento -- ni el rango ni el nivel de cuenta
 * te dan un motivo para cambiar de arma.
 *
 *
 * DE DÓNDE SALEN LOS PUNTOS (no se inventaron)
 *
 * Los valores por kill y por headshot son EXACTAMENTE los de `xp.ts`
 * (`XP.porKill`, `XP.porHeadshot`, `XP.porDiezDeDano`), importados y no
 * copiados, porque son los mismos números que el jugador ya vio caer en
 * pantalla como popups (+100 KILL, +50 HEADSHOT). Dos tablas distintas para
 * el mismo evento harían que la barra de cuenta y la del arma avanzaran con
 * ritmos que no se explican entre sí.
 *
 * Lo que NO se hereda de `xp.ts` son los tres términos de partida:
 * `participacion`, `bonoVictoria` y `bonoDerrota`. Un arma no participa ni
 * gana: la partida la ganó el jugador. Si el bono de victoria se repartiera
 * entre las armas, una partida ganada con la primaria en la mano subiría
 * también la secundaria que nunca se disparó, y la barra dejaría de medir
 * uso. El arma cobra por lo que hizo y por nada más.
 *
 * **No hay asistencias en este juego.** El puntaje (match/scoring.ts) sólo
 * conoce kills, muertes, daño, headshots y rachas: no existe un evento de
 * asistencia que registrar. Se deja explícitamente afuera en vez de
 * inventarle una definición, porque una asistencia mal definida (¿daño sin
 * kill? ¿en qué ventana?) sería un número que no se corresponde con nada que
 * el jugador vea.
 *
 *
 * LA CURVA, Y SU DERIVACIÓN CONTRA EL VOLUMEN DE CONTENIDO
 *
 * Esta es la decisión que más fácil se hace mal, así que va con sus cuentas.
 *
 * La restricción real: 148 armas y 4 mapas. Una curva calibrada para un
 * juego de cientos de horas deja 148 barras que nadie termina nunca; una
 * curva corta las agota en dos partidas y una barra llena que ya no sube
 * desmotiva más que una barra que nunca existió.
 *
 * Punto de partida medido, no supuesto -- una partida típica de 6 minutos
 * (match/tuning.ts) con el arma principal en la mano produce del orden de:
 *
 *     12 kills x 100          = 1200
 *     4 headshots x 50        =  200
 *     2000 de daño / 10 x 1   =  200
 *                               ----
 *                               1600 XP de arma por partida
 *
 * repartidos entre primaria y secundaria. La primaria se lleva la mayor
 * parte, así que **el arma principal de una partida cobra del orden de 1200
 * XP**. Ese es el número contra el que se calibra todo lo de abajo.
 *
 * De ahí salen los dos parámetros:
 *
 * **Cinco niveles** (`NIVEL_ARMA_MAXIMO`), no treinta. Con 148 armas, lo
 * escaso no es el tiempo por arma sino la ATENCIÓN entre armas: el sistema
 * tiene que producir "subí ésta, probemos la otra", no "voy 12 de 55 en la
 * primera". Cinco niveles son cuatro ascensos, y cada uno de los cuatro
 * entrega una recompensa concreta (ver abajo). Cero niveles vacíos: no hay
 * ningún ascenso que suba un número y no dé nada.
 *
 * **Costo lineal creciente** (`COSTO_PASO * nivel`), que da:
 *
 *     nivel 1 -> 2:   600 XP   (5-6 kills: cae DENTRO de la primera partida)
 *     nivel 2 -> 3:  1200 XP
 *     nivel 3 -> 4:  1800 XP
 *     nivel 4 -> 5:  2400 XP
 *     ---------------------
 *     total a maestría: 6000 XP
 *
 * (Un bot tiene 100 de vida -- bots/tuning.ts, `maxHealth` -- así que un kill
 * arrastra su propio daño: vale 100 + 10, y 150 si fue headshot. De ahí salen
 * los 5-6 kills del primer ascenso.)
 *
 * A 1200 XP por partida como arma principal, **maestrear un arma cuesta
 * ~5 partidas** (~30 minutos). Y el primer ascenso llega antes de que
 * termine la primera partida, que es la propiedad que hace que la capa se
 * entienda sin que nadie la explique.
 *
 * Contra el catálogo completo: 148 armas x 5 partidas = **740 partidas,
 * del orden de 74 horas** para maestrear todo. Es más contenido del que este
 * juego necesita sostener, sin que ninguna barra individual sea un muro.
 * El costo creciente (y no plano) existe para que el nivel 5 se sienta
 * distinto del 2: el último ascenso cuesta cuatro veces el primero.
 *
 *
 * QUÉ ENTREGA CADA NIVEL, Y POR QUÉ ES ENTREGABLE HOY
 *
 * Acá hay que ser honesto con lo que el juego tiene. **No hay sistema de
 * accesorios ni de attachments**, así que no se puede prometer una mira ni
 * un cargador extendido: sería una recompensa que no existe. Las únicas
 * palancas reales son cosméticas, y de ésas sí hay un sistema completo y
 * funcionando: el generador de skins (skins/generator.ts) con sus cinco
 * rarezas y sus seis familias de camuflaje.
 *
 * Así que cada ascenso entrega **un camuflaje de maestría** exclusivo de esa
 * arma, con la rareza subiendo con el nivel:
 *
 *     nivel 2 -> Raro        nivel 4 -> Legendario
 *     nivel 3 -> Épico       nivel 5 -> Exótico
 *
 * Esa escalera de rareza no es decorativa: la rareza decide qué parámetros
 * habilita el shader (rarity.ts), así que un camo de nivel 5 BRILLA y tiene
 * animación y uno de nivel 2 no. La recompensa se ve de lejos, que es la
 * única forma de que una recompensa cosmética funcione.
 *
 * Son recompensas entregables hoy, sin código nuevo de render: un camo de
 * maestría es una seed más, y el generador ya convierte cualquier seed en una
 * skin determinista que la armería ya sabe mostrar y el shader ya sabe
 * dibujar.
 *
 *
 * LOS CAMOS DE MAESTRÍA NO SE GUARDAN: SE DERIVAN
 *
 * 148 armas x 4 camos = 592 seeds. Guardarlas sería duplicar en disco algo
 * que ya está implícito en el nivel del arma, y además inundaría el
 * inventario compartido de skins.
 *
 * Lo que se guarda es sólo la XP por arma. El conjunto de camos de maestría
 * desbloqueados es una FUNCIÓN PURA de eso: si tenés el arma en nivel 4,
 * tenés sus camos de nivel 2, 3 y 4, y `seedMaestria()` los reconstruye
 * idénticos en cualquier momento. Cero bytes de guardado por recompensa, y
 * es imposible que el guardado quede inconsistente con el nivel.
 */

import { generateSkin, type Skin } from '@/game/skins/generator'
import { createSkinRandom, hashSeed } from '@/game/skins/hash'
import { rollRarity, type RarityId } from '@/game/skins/rarity'
import { XP } from '@/game/progression/xp'

/** Nivel de un arma que nunca se usó. */
export const NIVEL_ARMA_INICIAL = 1

/** Nivel máximo por arma. Ver la derivación en la cabecera. */
export const NIVEL_ARMA_MAXIMO = 5

/**
 * Costo del ascenso `n -> n+1`, en XP de arma: `COSTO_PASO * n`. Creciente
 * para que el último ascenso cueste cuatro veces el primero.
 */
export const COSTO_PASO = 600

/**
 * XP por evento. Los tres valores son los de `xp.ts`, importados y no
 * copiados: si allá se retoca un popup, acá se retoca solo. Los términos de
 * partida (participación, victoria, derrota) quedan afuera a propósito -- ver
 * la cabecera.
 */
export const WEAPON_XP = {
  porKill: XP.porKill,
  porHeadshot: XP.porHeadshot,
  porDiezDeDano: XP.porDiezDeDano,
} as const

/**
 * XP acumulada necesaria para ESTAR en un nivel. Suma de los costos de los
 * ascensos anteriores: `COSTO_PASO * (L-1)L/2`.
 */
export function xpParaNivelArma(nivel: number): number {
  const L = Math.max(NIVEL_ARMA_INICIAL, Math.min(NIVEL_ARMA_MAXIMO, Math.floor(nivel)))
  return (COSTO_PASO * (L - 1) * L) / 2
}

/** XP total para maestrear un arma (nivel 5). */
export const XP_ARMA_MAESTRIA = xpParaNivelArma(NIVEL_ARMA_MAXIMO)

/** Nivel de un arma dada su XP acumulada. Tolera basura: NaN o negativo
 *  caen al nivel inicial en vez de propagar el disparate. */
export function nivelDeArma(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return NIVEL_ARMA_INICIAL
  // Bucle y no fórmula cerrada: son cuatro vueltas como mucho y así el
  // nivel es exactamente el inverso de xpParaNivelArma, sin depender de que
  // una raíz cuadrada redondee para el lado correcto en los bordes.
  let nivel = NIVEL_ARMA_INICIAL
  while (nivel < NIVEL_ARMA_MAXIMO && xp >= xpParaNivelArma(nivel + 1)) nivel++
  return nivel
}

export interface WeaponProgress {
  slug: string
  xp: number
  nivel: number
  /** true si el arma llegó al nivel máximo. */
  maestria: boolean
  /** XP dentro del nivel actual, y cuánto mide este nivel. En maestría los
   *  dos valen el costo del último ascenso, para que la barra se dibuje
   *  llena en vez de dividir por cero. */
  xpEnNivel: number
  xpDelNivel: number
}

/** Estado de un arma para la UI: nivel, y la barra ya resuelta. */
export function weaponProgress(slug: string, xp: number): WeaponProgress {
  const total = Number.isFinite(xp) && xp > 0 ? xp : 0
  const nivel = nivelDeArma(total)
  if (nivel >= NIVEL_ARMA_MAXIMO) {
    const ultimo = COSTO_PASO * (NIVEL_ARMA_MAXIMO - 1)
    return { slug, xp: total, nivel, maestria: true, xpEnNivel: ultimo, xpDelNivel: ultimo }
  }
  const piso = xpParaNivelArma(nivel)
  return {
    slug,
    xp: total,
    nivel,
    maestria: false,
    xpEnNivel: total - piso,
    xpDelNivel: xpParaNivelArma(nivel + 1) - piso,
  }
}

/* ------------------------------------------------------------------ *
 * Acumulador de partida (camino del frame: CERO asignaciones)
 * ------------------------------------------------------------------ */

/**
 * Cuántas armas distintas puede acumular una partida. El jugador lleva dos
 * (primaria y secundaria), pero el menú de pausa deja cambiar el loadout en
 * vivo, así que una partida puede tocar más de dos slugs.
 *
 * Ocho es holgado para eso y fija el tamaño de los buffers de una vez, que
 * es lo que permite la promesa de cero asignaciones: `registrarDano` y
 * `registrarKill` corren en el camino del disparo y NO pueden hacer crecer
 * un array ni crear un objeto. Si alguien cambiara de arma nueve veces en
 * una partida, la novena deja de acumular XP -- perder la atribución de un
 * caso patológico es preferible a asignar memoria por disparo.
 */
export const TALLY_CAPACIDAD = 8

export interface WeaponTally {
  /** Slugs vistos, en orden de aparición. Sólo los primeros `count` valen. */
  readonly slugs: (string | null)[]
  readonly kills: Int32Array
  readonly headshots: Int32Array
  readonly dano: Float64Array
  count: number
}

export function createWeaponTally(): WeaponTally {
  return {
    slugs: new Array<string | null>(TALLY_CAPACIDAD).fill(null),
    kills: new Int32Array(TALLY_CAPACIDAD),
    headshots: new Int32Array(TALLY_CAPACIDAD),
    dano: new Float64Array(TALLY_CAPACIDAD),
    count: 0,
  }
}

/** Deja el acumulador como recién creado, sin asignar nada nuevo. Es lo que
 *  se llama al empezar una partida. */
export function resetWeaponTally(tally: WeaponTally): void {
  for (let i = 0; i < tally.count; i++) tally.slugs[i] = null
  tally.kills.fill(0)
  tally.headshots.fill(0)
  tally.dano.fill(0)
  tally.count = 0
}

/**
 * Índice de un slug dentro del acumulador, creándolo si hace falta. Devuelve
 * -1 si ya no hay lugar.
 *
 * Búsqueda lineal a propósito: `count` es 2 en la enorme mayoría de las
 * partidas y 8 en el peor caso. Un Map haría lo mismo más lento a este
 * tamaño, y además asignaría al insertar.
 */
function indiceDe(tally: WeaponTally, slug: string): number {
  for (let i = 0; i < tally.count; i++) {
    if (tally.slugs[i] === slug) return i
  }
  if (tally.count >= TALLY_CAPACIDAD) return -1
  const i = tally.count
  tally.slugs[i] = slug
  tally.count = i + 1
  return i
}

/** Daño infligido con un arma. Camino del disparo: cero asignaciones. */
export function registrarDano(tally: WeaponTally, slug: string, dano: number): void {
  if (!Number.isFinite(dano) || dano <= 0) return
  const i = indiceDe(tally, slug)
  if (i < 0) return
  tally.dano[i] += dano
}

/** Kill con un arma. Camino del disparo: cero asignaciones. */
export function registrarKill(tally: WeaponTally, slug: string, headshot: boolean): void {
  const i = indiceDe(tally, slug)
  if (i < 0) return
  tally.kills[i] += 1
  if (headshot) tally.headshots[i] += 1
}

/** XP que le corresponde a un arma por lo que hizo en una partida. */
export function xpDeArmaEnPartida(kills: number, headshots: number, dano: number): number {
  const k = Math.max(0, kills)
  const hs = Math.max(0, Math.min(k, headshots))
  const d = Math.max(0, Number.isFinite(dano) ? dano : 0)
  return Math.round(
    WEAPON_XP.porKill * k + WEAPON_XP.porHeadshot * hs + WEAPON_XP.porDiezDeDano * (d / 10),
  )
}

/* ------------------------------------------------------------------ *
 * Cierre de partida
 * ------------------------------------------------------------------ */

/** Lo que le pasó a un arma en una partida. Lo consume la UI del resumen. */
export interface WeaponXpOutcome {
  slug: string
  ganada: number
  xp: number
  nivelAnterior: number
  nivel: number
  subioDeNivel: boolean
  /** Camos de maestría que este ascenso desbloqueó, ya resueltos. Vacío si
   *  el arma no subió de nivel. */
  camos: Skin[]
}

export interface WeaponXpResult {
  /** Mapa nuevo. No muta el que entra. */
  armas: Record<string, number>
  /** Una entrada por arma usada, en el orden en que se usaron. */
  outcomes: WeaponXpOutcome[]
}

/**
 * Aplica el acumulado de una partida sobre el mapa guardado. Función pura:
 * ni toca el store ni muta sus argumentos, igual que `applyMatchResult`.
 * Corre una vez por partida, así que acá sí se asigna con libertad.
 */
export function applyWeaponXp(
  armas: Readonly<Record<string, number>>,
  tally: WeaponTally,
): WeaponXpResult {
  const siguiente: Record<string, number> = { ...armas }
  const outcomes: WeaponXpOutcome[] = []

  for (let i = 0; i < tally.count; i++) {
    const slug = tally.slugs[i]
    if (slug === null) continue

    const ganada = xpDeArmaEnPartida(tally.kills[i], tally.headshots[i], tally.dano[i])
    // Un arma que se equipó y no hizo nada no entra al guardado: guardar un
    // cero es gastar bytes en decir "nada pasó" (ver la nota de tamaño en
    // store.ts).
    if (ganada <= 0) continue

    const anterior = normalizarXp(siguiente[slug])
    const total = anterior + ganada
    siguiente[slug] = total

    const nivelAnterior = nivelDeArma(anterior)
    const nivel = nivelDeArma(total)
    outcomes.push({
      slug,
      ganada,
      xp: total,
      nivelAnterior,
      nivel,
      subioDeNivel: nivel > nivelAnterior,
      camos: camosEntre(slug, nivelAnterior, nivel),
    })
  }

  return { armas: siguiente, outcomes }
}

function normalizarXp(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0
}

/* ------------------------------------------------------------------ *
 * Camos de maestría
 * ------------------------------------------------------------------ */

/**
 * Rareza que le toca al camo de cada nivel. El nivel 1 no aparece porque no
 * es un ascenso: es el estado inicial de toda arma, y no se regala nada por
 * equipar algo por primera vez.
 */
export const RAREZA_POR_NIVEL: Readonly<Record<number, RarityId>> = {
  2: 'raro',
  3: 'epico',
  4: 'legendario',
  5: 'exotico',
}

/** Prefijo de las seeds de maestría. Las distingue de `inicial:N` (store.ts)
 *  y `drop:N:...` (drop.ts) de un vistazo al mirar un guardado. */
export const MAESTRIA_PREFIX = 'maestria'

/**
 * Tope de la búsqueda de seed. El tier más raro pesa 2 de 100, así que la
 * probabilidad de no encontrar una exótica en 4096 intentos es 0.98^4096,
 * del orden de 1e-36: el fallback existe para que la función sea total, no
 * porque se espere usarlo.
 */
const BUSQUEDA_MAXIMA = 4096

/**
 * Rareza de una seed SIN generar la skin entera.
 *
 * Replica los dos primeros pasos de `generateSkin` (hash -> primer `rand()`
 * -> `rollRarity`) porque la búsqueda de abajo prueba decenas de seeds y
 * generar paletas, patrones y jitter para descartarlos sería trabajo tirado.
 *
 * Esto acopla con el orden del PRNG de generator.ts, que es justo el
 * contrato que camo-families.ts advierte que no hay que romper. El acople se
 * paga con un test que compara esta función contra `generateSkin(seed).rarity`
 * sobre un barrido de seeds: si alguien reordena el generador, ese test cae.
 */
function rarezaDeSeed(seed: string): RarityId {
  const rand = createSkinRandom(hashSeed(seed))
  return rollRarity(rand()).id
}

/**
 * Seed del camo de maestría de un arma en un nivel. Determinista y pura:
 * el mismo arma y el mismo nivel dan siempre la misma seed, y por lo tanto
 * la misma skin. Es lo que permite NO guardar estas recompensas.
 *
 * Por qué hay una búsqueda: la rareza sale del hash de la seed, así que una
 * seed elegida a dedo daría la rareza que le tocara, y un camo de nivel 5
 * podría salir común. Acá la rareza es parte del diseño de la recompensa, no
 * un sorteo, así que se busca la primera seed de la familia
 * `maestria:<slug>:<nivel>:<k>` que caiga en la rareza objetivo. El
 * generador no se toca: ninguna skin ya guardada cambia.
 */
export function seedMaestria(slug: string, nivel: number): string {
  const objetivo = RAREZA_POR_NIVEL[nivel]
  if (objetivo === undefined) {
    throw new Error(`nivel de arma sin camo de maestría: ${nivel}`)
  }
  const base = `${MAESTRIA_PREFIX}:${slug}:${nivel}`
  for (let k = 0; k < BUSQUEDA_MAXIMA; k++) {
    const seed = `${base}:${k}`
    if (rarezaDeSeed(seed) === objetivo) return seed
  }
  return `${base}:0`
}

/** Camos que desbloquea pasar de `desde` a `hasta`. Vacío si no hubo
 *  ascenso. */
function camosEntre(slug: string, desde: number, hasta: number): Skin[] {
  const camos: Skin[] = []
  for (let n = desde + 1; n <= hasta; n++) {
    if (RAREZA_POR_NIVEL[n] === undefined) continue
    camos.push(generateSkin(seedMaestria(slug, n)))
  }
  return camos
}

/**
 * Todos los camos de maestría que un arma tiene desbloqueados a su nivel
 * actual. Es la vista que consume la armería, y la razón por la que estas
 * recompensas no ocupan un solo byte del guardado.
 */
export function camosDeMaestria(slug: string, xp: number): Skin[] {
  return camosEntre(slug, NIVEL_ARMA_INICIAL - 1, nivelDeArma(xp))
}

/** Seeds de todos los camos de maestría desbloqueados, por arma. Para que la
 *  armería pueda ofrecerlos junto al inventario sorteado sin persistirlos. */
export function seedsDeMaestria(armas: Readonly<Record<string, number>>): string[] {
  const seeds: string[] = []
  for (const slug of Object.keys(armas)) {
    const nivel = nivelDeArma(armas[slug])
    for (let n = NIVEL_ARMA_INICIAL + 1; n <= nivel; n++) seeds.push(seedMaestria(slug, n))
  }
  return seeds
}

/** Cuántas armas alcanzaron la maestría. Es el número que resume la capa
 *  entera en una línea ("23 de 148"). */
export function armasMaestreadas(armas: Readonly<Record<string, number>>): number {
  let total = 0
  for (const slug of Object.keys(armas)) {
    if (nivelDeArma(armas[slug]) >= NIVEL_ARMA_MAXIMO) total++
  }
  return total
}
