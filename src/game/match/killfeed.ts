/**
 * Killfeed: registro de las últimas muertes, con el arma usada. Mismo
 * RingPool que feedback/hitmarkers.ts/vignette.ts (feedback/pool.ts): un
 * anillo preasignado, la (n+1)-ésima entrada recicla la más vieja -- nunca
 * asigna ni crece. Envejece igual que esos módulos (`age`/duración), así
 * que la UI (src/ui/) puede simplemente listar las entradas activas sin
 * llevar su propio temporizador.
 */

import { createRingPool, nextPoolSlot, type RingPool } from '@/game/feedback/pool'
import { MATCH } from '@/game/match/tuning'

export interface KillfeedEntry {
  active: boolean
  age: number
  /** Orden de inserción, monótono creciente -- desempata entradas con la
   *  misma edad (dos kills en el mismo frame) para un orden estable. */
  seq: number
  killerId: number
  victimId: number
  weaponLabel: string
  headshot: boolean
}

export interface KillfeedState {
  pool: RingPool<KillfeedEntry>
  nextSeq: number
}

export function createKillfeedState(capacity: number = MATCH.killfeedMaxEntries): KillfeedState {
  return {
    pool: createRingPool<KillfeedEntry>(capacity, () => ({
      active: false,
      age: 0,
      seq: -1,
      killerId: -1,
      victimId: -1,
      weaponLabel: '',
      headshot: false,
    })),
    nextSeq: 0,
  }
}

/** Registra una muerte nueva en el anillo (recicla la entrada más vieja si
 *  no queda ningún slot libre -- mismo contrato que spawnHitmarker). */
export function pushKill(
  state: KillfeedState,
  killerId: number,
  victimId: number,
  weaponLabel: string,
  headshot: boolean,
): void {
  const slot = nextPoolSlot(state.pool)
  slot.active = true
  slot.age = 0
  slot.seq = state.nextSeq++
  slot.killerId = killerId
  slot.victimId = victimId
  slot.weaponLabel = weaponLabel
  slot.headshot = headshot
}

/** Envejece todas las entradas activas; desactiva las que ya cumplieron
 *  `MATCH.killfeedEntryLifetimeS`. Llamar una vez por frame, como
 *  stepHitmarkers. */
export function stepKillfeed(state: KillfeedState, dt: number): void {
  const items = state.pool.items
  for (let i = 0; i < items.length; i++) {
    const entry = items[i]
    if (!entry.active) continue
    entry.age += dt
    if (entry.age >= MATCH.killfeedEntryLifetimeS) entry.active = false
  }
}

/**
 * Entradas activas, más nueva primero (`seq` descendente). Asigna un array
 * nuevo a propósito -- a diferencia del resto de este módulo, esto no corre
 * en el camino de frame del motor: lo llama la UI de baja frecuencia
 * (src/ui/), sondeando el estado un par de veces por segundo (ver el
 * comentario de cabecera de engine/stats.ts sobre por qué React nunca corre
 * en el frame), así que el presupuesto de cero asignaciones del loop
 * principal no aplica acá.
 */
export function listActiveKillsNewestFirst(state: KillfeedState): KillfeedEntry[] {
  const active = state.pool.items.filter((e) => e.active)
  active.sort((a, b) => b.seq - a.seq)
  return active
}
