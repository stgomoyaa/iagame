/**
 * Estadísticas de arquetipo en forma de barras, para la armería (fase 3).
 *
 * El arquetipo (weapons/archetypes.ts) es el modelo de juego: daño por
 * distancia, RPM, patrón de retroceso, tiempos de ADS. Nada de eso es
 * comparable de un vistazo entre un francotirador y una SMG mirando los
 * números crudos, que es justo lo que la armería tiene que resolver: por qué
 * elegirías un arma sobre otra.
 *
 * Esta capa traduce esos números a seis ejes normalizados a 0..1 contra el
 * arsenal completo. Normalizar contra el arsenal y no contra constantes
 * escritas a mano es lo que hace que las barras sigan diciendo la verdad
 * cuando se rebalancea un arquetipo: si mañana el francotirador pega menos,
 * la barra de daño de todos los demás sube sola.
 *
 * Es matemática pura y no sabe nada de React: la armería sólo la dibuja.
 */

import {
  ARCHETYPE_LIST,
  damageAtRange,
  radToDeg,
  type WeaponArchetype,
} from '@/game/weapons/archetypes'

export type StatId = 'dano' | 'cadencia' | 'alcance' | 'control' | 'movilidad' | 'cargador'

export interface StatDef {
  id: StatId
  label: string
  /** Valor crudo del arquetipo, en su propia unidad. */
  raw(a: WeaponArchetype): number
  /** Unidad para el tooltip / la línea de detalle. */
  format(a: WeaponArchetype): string
}

/**
 * Control = inverso del retroceso acumulado. Se mide sobre los primeros
 * ocho tiros porque es el tramo que un jugador realmente aguanta apretado y
 * el que decide si un arma "se va" o no; el patrón completo de una LMG de
 * 100 balas diría más sobre el largo del cargador que sobre el retroceso.
 */
const TIROS_MEDIDOS = 8

function retrocesoAcumulado(a: WeaponArchetype): number {
  let total = 0
  for (let i = 0; i < Math.min(TIROS_MEDIDOS, a.recoil.pattern.length); i++) {
    const [x, y] = a.recoil.pattern[i]
    total += Math.hypot(x, y)
  }
  return radToDeg(total)
}

/**
 * Movilidad = qué tan poco te frena el arma. Combina el tiempo de ADS y el
 * multiplicador de velocidad apuntando, que son las dos formas en que un
 * arma pesada se siente pesada moviéndose.
 */
function movilidad(a: WeaponArchetype): number {
  return a.ads.speedScale / a.ads.time
}

export const STAT_DEFS: readonly StatDef[] = [
  {
    id: 'dano',
    label: 'Daño',
    raw: (a) => a.damage.base,
    format: (a) => `${a.damage.base} a quemarropa`,
  },
  {
    id: 'cadencia',
    label: 'Cadencia',
    raw: (a) => a.fireRate,
    format: (a) => `${a.fireRate} rpm`,
  },
  {
    id: 'alcance',
    label: 'Alcance',
    // Daño a 40 metros: mide dónde deja de servir el arma, no dónde termina
    // su curva. Dos armas con el mismo maxRange pero distinta caída se
    // separan acá, que es la diferencia que se siente jugando.
    raw: (a) => damageAtRange(a, 40),
    format: (a) => `${Math.round(damageAtRange(a, 40))} de daño a 40 m`,
  },
  {
    id: 'control',
    label: 'Control',
    raw: (a) => -retrocesoAcumulado(a),
    format: (a) => `${retrocesoAcumulado(a).toFixed(1)}° en ${TIROS_MEDIDOS} tiros`,
  },
  {
    id: 'movilidad',
    label: 'Movilidad',
    raw: movilidad,
    format: (a) => `${a.ads.time.toFixed(2)} s de ADS`,
  },
  {
    id: 'cargador',
    label: 'Cargador',
    raw: (a) => a.magazine,
    format: (a) => `${a.magazine} balas, ${a.reload.empty.toFixed(1)} s de recarga`,
  },
]

interface Rango {
  min: number
  max: number
}

const RANGOS: Record<StatId, Rango> = (() => {
  const out = {} as Record<StatId, Rango>
  for (const def of STAT_DEFS) {
    const valores = ARCHETYPE_LIST.map(def.raw)
    out[def.id] = { min: Math.min(...valores), max: Math.max(...valores) }
  }
  return out
})()

export interface StatBar {
  id: StatId
  label: string
  /** 0..1 contra el arsenal completo. */
  value: number
  detail: string
}

/** Las seis barras de un arquetipo, normalizadas contra todo el arsenal. */
export function statBars(archetype: WeaponArchetype): StatBar[] {
  return STAT_DEFS.map((def) => {
    const { min, max } = RANGOS[def.id]
    const span = max - min
    // Piso de 0.06: una barra en cero se lee como "sin dato" y no como "el
    // peor del arsenal", que es lo que en realidad significa.
    const value = span === 0 ? 1 : 0.06 + 0.94 * ((def.raw(archetype) - min) / span)
    return { id: def.id, label: def.label, value, detail: def.format(archetype) }
  })
}

/** Nombre legible de la clase, para la armería. */
export const CLASS_LABEL: Record<WeaponArchetype['class'], string> = {
  ar: 'Fusil de asalto',
  smg: 'Subfusil',
  pistol: 'Pistola',
  shotgun: 'Escopeta',
  marksman: 'Tirador',
  sniper: 'Francotirador',
  lmg: 'Ametralladora',
}
