/**
 * Desbloqueo de armas por nivel de cuenta (sección 6 del spec: "Las armas se
 * desbloquean por nivel de cuenta", y sección 9: "Nivel de cuenta por XP,
 * que desbloquea armas").
 *
 * El spec no fija números, así que la regla se deriva de algo que sí existe
 * en los datos y no de una tabla escrita a mano de 40 filas que nadie puede
 * mantener: la **clase** del arquetipo decide el nivel base, y la posición
 * del modelo dentro de su clase agrega escalones. Consecuencias buscadas:
 *
 * - Un jugador nuevo arranca con pistolas y el primer fusil: las dos clases
 *   con las que se puede jugar cualquier situación. Nunca queda sin arma.
 * - Las clases de nicho (escopeta, LMG, francotirador) llegan más tarde,
 *   que es también el orden en que se vuelven interesantes.
 * - Agregar modelos al pack (index.json crece hasta 40 y podría crecer más)
 *   no obliga a tocar nada acá: el modelo nuevo cae en su clase y toma el
 *   escalón que sigue.
 *
 * Es matemática pura sobre el registry, sin estado: el nivel de cuenta entra
 * como parámetro.
 */

import type { WeaponClass } from '@/game/weapons/archetypes'
import { catalogVersion, resolveArchetype, weaponIndex } from '@/game/weapons/registry'

/** Nivel mínimo de cuenta. Una cuenta nueva arranca acá. */
export const NIVEL_INICIAL = 1

/** Nivel base por clase. */
const CLASS_BASE_LEVEL: Record<WeaponClass, number> = {
  pistol: 1,
  ar: 1,
  smg: 3,
  shotgun: 6,
  marksman: 9,
  lmg: 12,
  sniper: 15,
}

/** Escalones entre modelos consecutivos de la misma clase. */
const STEP_PER_MODEL = 2

/**
 * Modelos de cortesía por clase: los primeros N de la clase salen todos al
 * nivel base, sin escalón.
 *
 * Existe por una razón de sensación, no de balance: con escalón desde el
 * primer modelo, una cuenta nueva abre la armería y encuentra 2 armas de 40.
 * Eso no se lee como progresión, se lee como que la pantalla está rota. Con
 * cortesía en las dos clases de arranque el jugador empieza con cinco armas
 * y algo que elegir, y las otras 35 siguen siendo el gancho.
 */
const CORTESIA: Partial<Record<WeaponClass, number>> = {
  ar: 3,
  pistol: 2,
}

/**
 * Ningún arma puede exigir más de este nivel.
 *
 * No es una preferencia: es la invariante que impide que crecer el catálogo
 * deje armas inalcanzables. Los niveles crudos de la fórmula de arriba crecen
 * con la cantidad de modelos por clase (con 79 armas el último cae en 37, con
 * las 148 del catálogo completo se iría bastante más allá), y el nivel de
 * cuenta tiene techo (`NIVEL_MAXIMO`). Sin este tope, agregar armas las
 * agregaría del otro lado del techo.
 *
 * Queda 5 niveles por debajo de `NIVEL_MAXIMO` a propósito: los últimos
 * niveles del ciclo son el tramo hacia el prestigio, y llegar al techo el
 * mismo día que desbloqueás la última arma le saca peso a las dos cosas.
 */
export const NIVEL_MAXIMO_DESBLOQUEO = 50

function buildUnlockLevels(): Record<string, number> {
  const seenPerClass = new Map<WeaponClass, number>()
  const levels: Record<string, number> = {}
  let maximoCrudo = NIVEL_INICIAL

  // El orden de index.json es el orden del pack, estable entre builds: dos
  // ejecuciones asignan los mismos niveles a los mismos modelos, que es lo
  // que evita que un jugador "pierda" un arma que ya tenía desbloqueada.
  for (const entry of weaponIndex()) {
    const clase = resolveArchetype(entry.slug).class
    const indice = seenPerClass.get(clase) ?? 0
    seenPerClass.set(clase, indice + 1)
    const escalones = Math.max(0, indice - ((CORTESIA[clase] ?? 1) - 1))
    const nivel = CLASS_BASE_LEVEL[clase] + escalones * STEP_PER_MODEL
    levels[entry.slug] = nivel
    if (nivel > maximoCrudo) maximoCrudo = nivel
  }

  // La compresión SÓLO se aplica cuando el catálogo se pasa del tope, nunca
  // al revés. Es la mitad importante de la regla: si también estirara cuando
  // el catálogo es chico, cargar las armas locales (que agrandan el catálogo
  // a mitad de sesión, ver registry.ts) movería armas ya desbloqueadas hacia
  // ADELANTE y el jugador las vería desaparecer de la armería. Comprimir sólo
  // hacia abajo garantiza que crecer el catálogo nunca quita nada.
  if (maximoCrudo <= NIVEL_MAXIMO_DESBLOQUEO) return levels

  const factor = (NIVEL_MAXIMO_DESBLOQUEO - NIVEL_INICIAL) / (maximoCrudo - NIVEL_INICIAL)
  for (const slug of Object.keys(levels)) {
    levels[slug] = NIVEL_INICIAL + Math.round((levels[slug] - NIVEL_INICIAL) * factor)
  }

  return levels
}

/**
 * Tabla de niveles, calculada bajo demanda y cacheada CONTRA LA VERSIÓN DEL
 * CATÁLOGO, no una sola vez al importar el módulo.
 *
 * Esto era un `const` que corría `buildUnlockLevels()` en el import, y era un
 * bug real, no una precaución: el catálogo de armas ya no está completo
 * cuando este módulo se importa. Las armas locales (registry.ts) entran
 * después, cuando resuelve un fetch, así que la tabla quedaba con la foto de
 * las 40 CC0 y `unlockLevelFor('ak47')` LANZABA. Y no fallaba en un rincón:
 * la primera cosa que hace `createGame` es armar el loadout por defecto, que
 * recorre las armas desbloqueadas — o sea, el juego entero no arrancaba.
 *
 * Cachear contra `catalogVersion()` en vez de recalcular siempre mantiene la
 * propiedad que hacía atractivo al `const`: esto se llama una vez por arma
 * por render de la armería, y recorrer 79 armas en cada llamada sería
 * trabajo cuadrático en una pantalla de menú.
 */
let cache: Record<string, number> | null = null
let cacheVersion = -1

function unlockLevels(): Record<string, number> {
  if (cache === null || cacheVersion !== catalogVersion()) {
    cache = buildUnlockLevels()
    cacheVersion = catalogVersion()
  }
  return cache
}

/** Todos los niveles de desbloqueo del catálogo actual, por slug. */
export function unlockLevelsSnapshot(): Readonly<Record<string, number>> {
  return unlockLevels()
}

/** Nivel de cuenta al que se desbloquea un arma. */
export function unlockLevelFor(slug: string): number {
  const level = unlockLevels()[slug]
  if (level === undefined) throw new Error(`arma desconocida: "${slug}" no está en el catálogo`)
  return level
}

/**
 * `permanentes` son las armas que el jugador se llevó para siempre con una
 * ficha de prestigio (prestige.ts): ignoran el nivel, incluso el nivel 1
 * recién reiniciado. Es un parámetro opcional y no un import de prestige.ts
 * para que este módulo siga siendo matemática sobre el registry y no dependa
 * del guardado.
 */
export function isWeaponUnlocked(
  slug: string,
  accountLevel: number,
  permanentes: readonly string[] = [],
): boolean {
  if (permanentes.includes(slug)) return true
  return accountLevel >= unlockLevelFor(slug)
}

/** Slugs disponibles a un nivel dado, en el orden del pack. */
export function unlockedWeapons(accountLevel: number, permanentes: readonly string[] = []): string[] {
  return weaponIndex()
    .map((e) => e.slug)
    .filter((slug) => isWeaponUnlocked(slug, accountLevel, permanentes))
}

/** Nivel al que se desbloquea la última arma del pack. */
export function nivelMaximoDeDesbloqueo(): number {
  return Math.max(...Object.values(unlockLevels()))
}

/**
 * TECHO DEL NIVEL DE CUENTA. Acá termina el ciclo y se puede prestigiar
 * (prestige.ts).
 *
 * 55 es el número de Call of Duty, pero no se copió por respeto: se copió
 * porque el número solo no significa nada, lo que importa es cuánto tarda en
 * llegar, y eso sí se midió acá.
 *
 *
 * LA MEDICIÓN QUE OBLIGÓ A CAMBIAR LA CURVA
 *
 * La curva anterior era lineal, 1200 XP por nivel, con el último desbloqueo
 * en el nivel 25. Corriendo el simulador (simulate.ts) con jugadores
 * sintéticos de habilidad 0.2 a 0.8 contra bots reales, una partida de 6
 * minutos paga **~2400 XP**: dos niveles enteros POR PARTIDA. En números:
 *
 * - Nivel 25 (última arma del pack publicable, 40 armas): **12 partidas**.
 * - Nivel 37 (última arma con las 79 del catálogo local): **18 partidas**.
 * - A las 60 partidas el jugador iba por el nivel ~120, un número que ya no
 *   quiere decir nada porque no queda nada atrás de él.
 *
 * O sea: 75 minutos y la progresión de cuenta estaba terminada. Prestigiar
 * ahí sería reiniciar antes de haber usado lo que se desbloqueó, que es
 * exactamente el loop vacío que hay que evitar.
 *
 *
 * LA CURVA ELEGIDA, Y DE DÓNDE SALEN LOS DOS NÚMEROS
 *
 * XP acumulada para el nivel n:  base·(n-1) + incremento·(n-1)²
 *
 * Cuadrática y no exponencial: una exponencial hace que los últimos niveles
 * cuesten múltiplos de los primeros y ahí la barra deja de moverse, que es
 * peor que no tenerla. Con esta, el nivel 2 cuesta 900 XP y el 55 cuesta
 * 3550: el más caro del ciclo son ~1.5 partidas, nunca un muro.
 *
 * Los dos coeficientes salen de dos restricciones, no de tantear:
 *
 * 1. **La primera partida tiene que subir de nivel sí o sí.** El nivel 2 sale
 *    900 XP, bastante menos que los ~2400 de una partida cualquiera. (De
 *    hecho la primera partida deja al jugador en nivel 3.)
 * 2. **El ciclo entero dura ~50 partidas.** 50 × 2400 ≈ 120.000 XP para
 *    llegar a 55. Son unas 5 horas de juego, contra los 75 minutos de antes.
 *
 *    De dónde sale ese 50 y no 150: la advertencia de escala. Este juego
 *    tiene 4 mapas y 79 armas hoy (148 con el catálogo completo). Una curva
 *    de cientos de partidas sería contenido que nadie llega a ver. Y para el
 *    otro lado, con la compresión de arriba la última arma cae en el nivel
 *    50, o sea que las armas siguen llegando durante ~43 de esas 50 partidas:
 *    el ciclo no tiene un tramo largo sin nada nuevo.
 *
 * Resolviendo las dos: base + incremento = 900 y base·54 + incremento·54² =
 * 120.000 dan incremento ≈ 25 y base = 875. El total real a nivel 55 es
 * 120.150 XP.
 */
export const NIVEL_MAXIMO = 55

/** Costo del segundo nivel. Ver la derivación en `NIVEL_MAXIMO`. */
export const XP_BASE = 875
/** Cuánto se encarece cada nivel respecto del anterior. */
export const XP_INCREMENTO = 25

/** XP acumulada necesaria para alcanzar un nivel. */
export function xpParaNivel(level: number): number {
  const n = Math.max(0, Math.floor(level) - NIVEL_INICIAL)
  return XP_BASE * n + XP_INCREMENTO * n * n
}

/**
 * Nivel que corresponde a una XP acumulada. Inversa de `xpParaNivel`,
 * clampeada al techo.
 *
 * Es la fórmula cerrada, sin bucle ni tabla: se resuelve la cuadrática.
 *
 * Acá hubo una corrección de redondeo "por las dudas" (dos while que
 * ajustaban el resultado contra `xpParaNivel`) y se sacó porque era código
 * que ningún test podía hacer fallar. La duda que la motivaba se puede
 * responder en vez de blindarla: `Math.sqrt` es correctamente redondeada por
 * IEEE 754, así que la raíz de un cuadrado perfecto por debajo de 2^53 es
 * EXACTA, y el discriminante acá es un entero chico (a nivel 55 vale
 * 12.780.625). Comprobado además a fuerza bruta sobre todo el dominio, XP por
 * XP, en unlocks.test.ts: la fórmula cerrada y una búsqueda lineal dan el
 * mismo nivel siempre. Ese test sí falla si alguien cambia los coeficientes a
 * un rango donde la cuenta deje de ser exacta.
 */
export function levelForXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return NIVEL_INICIAL

  const raiz = Math.sqrt(XP_BASE * XP_BASE + 4 * XP_INCREMENTO * xp)
  const n = Math.floor((raiz - XP_BASE) / (2 * XP_INCREMENTO))
  return Math.min(NIVEL_MAXIMO, Math.max(NIVEL_INICIAL, NIVEL_INICIAL + n))
}

/** Estado de la barra de XP de la pantalla de carrera. */
export interface ProgresoDeNivel {
  level: number
  /** XP acumulada con la que arrancó este nivel. */
  piso: number
  /** XP acumulada a la que sube el siguiente. En el techo, el piso. */
  techo: number
  /** XP dentro del nivel actual, y cuánta falta. En el techo, 0. */
  actual: number
  falta: number
  /** 0..1. Siempre 1 en el techo: la barra llena es el aviso de que se puede
   *  prestigiar, no una barra rota que se pasa de largo. */
  fraccion: number
  /** true si el nivel ya no puede subir más. */
  enTecho: boolean
}

export function progresoDeNivel(xp: number): ProgresoDeNivel {
  const acumulada = Number.isFinite(xp) && xp > 0 ? xp : 0
  const level = levelForXp(acumulada)
  const piso = xpParaNivel(level)

  if (level >= NIVEL_MAXIMO) {
    return { level, piso, techo: piso, actual: 0, falta: 0, fraccion: 1, enTecho: true }
  }

  const techo = xpParaNivel(level + 1)
  const actual = acumulada - piso
  return {
    level,
    piso,
    techo,
    actual,
    falta: techo - acumulada,
    fraccion: Math.min(1, Math.max(0, actual / (techo - piso))),
    enTecho: false,
  }
}
