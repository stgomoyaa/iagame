/**
 * Máquina de estados de bots (sección 8 del spec): "Idle → Rotar → Enfrentar
 * → Reposicionar → Retirarse", transiciones guiadas por percepción y salud.
 *
 * Es una función pura de (estado actual, snapshot de percepción/salud de
 * ESTE tick) -> próximo estado -- nada de temporizadores propios de memoria
 * viven acá (esos son responsabilidad de quien arma `FsmInput`, ver
 * bots/bot.ts): este archivo sólo decide la transición dada la información
 * ya resuelta, con una prioridad fija que nunca cambia de orden. Esa pureza
 * es lo que hace testeable la garantía de "ninguna secuencia de entradas
 * produce un estado atascado u oscilante" -- el resultado depende sólo del
 * estado actual y la entrada de este tick, nunca de historia oculta.
 */

export type BotStateName = 'idle' | 'rotate' | 'engage' | 'reposition' | 'retreat'

export interface FsmState {
  current: BotStateName
  /** Segundos desde que se entró al estado actual. Se resetea a 0 en cada
   *  transición real (no en un no-op que "transiciona" al mismo estado). */
  timeInState: number
}

export function createFsmState(initial: BotStateName = 'idle'): FsmState {
  return { current: initial, timeInState: 0 }
}

export interface FsmInput {
  /** ¿Percibe al objetivo AHORA (cono + línea de vista)? */
  canSeeTarget: boolean
  /** Segundos desde la última vez que lo vio. Infinity si nunca. */
  timeSinceSeenS: number
  /** ¿Un disparo cayó dentro del radio de audición este tick? */
  heardShot: boolean
  /** Segundos desde la última sospecha auditiva. Infinity si nunca. */
  timeSinceHeardS: number
  /** Fracción de vida, 0..1. */
  healthFraction: number
}

export interface FsmTuning {
  /** Segundos que Reposicionar sigue activo tras perder línea de vista antes
   *  de degradar a Rotar/Idle. */
  targetMemoryS: number
  /** Segundos que Rotar sigue activo tras la última sospecha auditiva antes
   *  de volver a Idle. */
  suspicionMemoryS: number
  /** Fracción de vida en o por debajo de la cual se ENTRA a Retirarse. */
  retreatEnterHealthFraction: number
  /** Fracción de vida en o por encima de la cual se SALE de Retirarse.
   *  Mayor que retreatEnterHealthFraction (histéresis): sin el margen, vida
   *  oscilando justo en el umbral de entrada dispararía Retirarse<->Enfrentar
   *  cada tick que cambiara un punto de vida. */
  retreatExitHealthFraction: number
}

function transitionTo(fsm: FsmState, next: BotStateName): void {
  if (fsm.current === next) return
  fsm.current = next
  fsm.timeInState = 0
}

/**
 * Avanza la FSM un tick de IA y devuelve el estado resultante (mismo valor
 * que `fsm.current` tras la llamada). Prioridad fija, de mayor a menor:
 *
 * 1. Retirarse -- gana a cualquier otra condición mientras la vida esté
 *    baja. Histéresis en la salida (ver retreatExitHealthFraction).
 * 2. Enfrentar -- si percibe al objetivo AHORA, sin importar de dónde venía.
 * 3. Reposicionar -- venía de Enfrentar o de Reposicionar y perdió la
 *    percepción hace poco (memoria fresca): busca un ángulo mejor en vez de
 *    abandonar el rastro de golpe.
 * 4. Rotar -- hay sospecha auditiva fresca (disparo este tick o dentro de la
 *    ventana de memoria) sin percepción visual.
 * 5. Idle -- nada de lo anterior aplica.
 */
export function stepFsm(fsm: FsmState, input: FsmInput, tuning: FsmTuning, dt: number): BotStateName {
  fsm.timeInState += dt

  const lowHealth = input.healthFraction <= tuning.retreatEnterHealthFraction
  const healthRecovered = input.healthFraction >= tuning.retreatExitHealthFraction
  const stillRetreating = fsm.current === 'retreat' ? !healthRecovered : lowHealth

  if (stillRetreating) {
    transitionTo(fsm, 'retreat')
    return fsm.current
  }

  if (input.canSeeTarget) {
    transitionTo(fsm, 'engage')
    return fsm.current
  }

  const wasTrackingTarget = fsm.current === 'engage' || fsm.current === 'reposition'
  const hasFreshMemory = input.timeSinceSeenS <= tuning.targetMemoryS
  if (wasTrackingTarget && hasFreshMemory) {
    transitionTo(fsm, 'reposition')
    return fsm.current
  }

  const hasFreshSuspicion = input.heardShot || input.timeSinceHeardS <= tuning.suspicionMemoryS
  if (hasFreshSuspicion) {
    transitionTo(fsm, 'rotate')
    return fsm.current
  }

  transitionTo(fsm, 'idle')
  return fsm.current
}
