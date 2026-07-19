import { describe, expect, it } from 'vitest'
import { createFsmState, stepFsm, type BotStateName, type FsmInput, type FsmTuning } from '@/game/bots/fsm'

const TUNING: FsmTuning = {
  targetMemoryS: 3.0,
  suspicionMemoryS: 2.0,
  retreatEnterHealthFraction: 0.3,
  retreatExitHealthFraction: 0.5,
}

const NEUTRAL: FsmInput = {
  canSeeTarget: false,
  timeSinceSeenS: Infinity,
  heardShot: false,
  timeSinceHeardS: Infinity,
  healthFraction: 1,
}

function input(overrides: Partial<FsmInput>): FsmInput {
  return { ...NEUTRAL, ...overrides }
}

describe('máquina de estados de bots', () => {
  it('arranca en Idle y se queda en Idle sin ningún estímulo', () => {
    const fsm = createFsmState()
    expect(fsm.current).toBe('idle')
    for (let i = 0; i < 20; i++) {
      const state = stepFsm(fsm, input({}), TUNING, 1 / 15)
      expect(state).toBe('idle')
    }
  })

  it('Idle -> Rotar al escuchar un disparo', () => {
    const fsm = createFsmState()
    const state = stepFsm(fsm, input({ heardShot: true, timeSinceHeardS: 0 }), TUNING, 1 / 15)
    expect(state).toBe('rotate')
  })

  it('Idle -> Enfrentar directo al percibir visualmente, sin pasar por Rotar', () => {
    const fsm = createFsmState()
    const state = stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 1 / 15)
    expect(state).toBe('engage')
  })

  it('Rotar -> Enfrentar al adquirir percepción visual', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({ heardShot: true, timeSinceHeardS: 0 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('rotate')
    const state = stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0, timeSinceHeardS: 0.1 }), TUNING, 1 / 15)
    expect(state).toBe('engage')
  })

  it('Rotar -> Idle cuando la sospecha caduca sin adquirir nada', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({ heardShot: true, timeSinceHeardS: 0 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('rotate')
    const state = stepFsm(fsm, input({ timeSinceHeardS: TUNING.suspicionMemoryS + 0.5 }), TUNING, 1)
    expect(state).toBe('idle')
  })

  it('Enfrentar -> Reposicionar al perder línea de vista con memoria fresca', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('engage')
    const state = stepFsm(fsm, input({ canSeeTarget: false, timeSinceSeenS: 0.5 }), TUNING, 1 / 15)
    expect(state).toBe('reposition')
  })

  it('Reposicionar -> Idle cuando la memoria del objetivo caduca', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 1 / 15)
    stepFsm(fsm, input({ canSeeTarget: false, timeSinceSeenS: 0.5 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('reposition')
    const state = stepFsm(fsm, input({ timeSinceSeenS: TUNING.targetMemoryS + 1 }), TUNING, 1)
    expect(state).toBe('idle')
  })

  it('Reposicionar -> Enfrentar al recuperar línea de vista', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 1 / 15)
    stepFsm(fsm, input({ canSeeTarget: false, timeSinceSeenS: 0.5 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('reposition')
    const state = stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 1 / 15)
    expect(state).toBe('engage')
  })

  it('cualquier estado -> Retirarse cuando la vida cae bajo el umbral de entrada', () => {
    const states: BotStateName[] = ['idle', 'rotate', 'engage', 'reposition']
    for (const initial of states) {
      const fsm = createFsmState(initial)
      const state = stepFsm(fsm, input({ healthFraction: 0.29 }), TUNING, 1 / 15)
      expect(state, `desde ${initial}`).toBe('retreat')
    }
  })

  it('Retirarse gana incluso viendo al objetivo directamente', () => {
    const fsm = createFsmState('retreat')
    fsm.current = 'retreat'
    const state = stepFsm(
      fsm,
      input({ canSeeTarget: true, timeSinceSeenS: 0, healthFraction: 0.1 }),
      TUNING,
      1 / 15,
    )
    expect(state).toBe('retreat')
  })

  it('histéresis: Retirarse no sale con vida apenas sobre el umbral de ENTRADA', () => {
    const fsm = createFsmState('retreat')
    // healthFraction entre 0.3 (entrada) y 0.5 (salida): sigue retirándose.
    const state = stepFsm(fsm, input({ healthFraction: 0.4 }), TUNING, 1 / 15)
    expect(state).toBe('retreat')
  })

  it('Retirarse -> Idle al recuperar vida sobre el umbral de SALIDA', () => {
    const fsm = createFsmState('retreat')
    const state = stepFsm(fsm, input({ healthFraction: 0.6 }), TUNING, 1 / 15)
    expect(state).toBe('idle')
  })

  it('Retirarse -> Enfrentar al recuperar vida Y ver al objetivo en el mismo tick', () => {
    const fsm = createFsmState('retreat')
    const state = stepFsm(
      fsm,
      input({ healthFraction: 0.6, canSeeTarget: true, timeSinceSeenS: 0 }),
      TUNING,
      1 / 15,
    )
    expect(state).toBe('engage')
  })

  it('resetea timeInState en cada transición real, pero no en un no-op', () => {
    const fsm = createFsmState()
    stepFsm(fsm, input({}), TUNING, 0.5)
    expect(fsm.current).toBe('idle')
    expect(fsm.timeInState).toBeCloseTo(0.5, 10)

    stepFsm(fsm, input({}), TUNING, 0.5)
    // Sigue en Idle (no-op): timeInState SIGUE acumulando, no se resetea.
    expect(fsm.current).toBe('idle')
    expect(fsm.timeInState).toBeCloseTo(1.0, 10)

    stepFsm(fsm, input({ canSeeTarget: true, timeSinceSeenS: 0 }), TUNING, 0.5)
    // Transición real a Enfrentar: se resetea a 0 exacto, sin arrastrar el
    // dt de este tick (mismo criterio que PlayerState.slideTime al entrar
    // en slide, movement/step.ts).
    expect(fsm.current).toBe('engage')
    expect(fsm.timeInState).toBe(0)
  })

  it('devuelve siempre uno de los cinco estados válidos, para cualquier entrada', () => {
    const valid = new Set<BotStateName>(['idle', 'rotate', 'engage', 'reposition', 'retreat'])
    const fsm = createFsmState()
    let a = 1
    function rand(): number {
      a = (a * 48271) % 2147483647
      return a / 2147483647
    }
    for (let i = 0; i < 5000; i++) {
      const state = stepFsm(
        fsm,
        {
          canSeeTarget: rand() < 0.3,
          timeSinceSeenS: rand() < 0.5 ? 0 : rand() * 6,
          heardShot: rand() < 0.1,
          timeSinceHeardS: rand() < 0.5 ? 0 : rand() * 6,
          healthFraction: rand(),
        },
        TUNING,
        1 / 15,
      )
      expect(valid.has(state), `tick ${i}: estado inválido ${state}`).toBe(true)
    }
  })

  it('bajo entrada CONSTANTE converge a un punto fijo y no oscila', () => {
    const fixedInputs: FsmInput[] = [
      NEUTRAL,
      input({ canSeeTarget: true, timeSinceSeenS: 0 }),
      input({ heardShot: true, timeSinceHeardS: 0 }),
      input({ healthFraction: 0.1 }),
    ]

    for (const fixedInput of fixedInputs) {
      const fsm = createFsmState()
      stepFsm(fsm, fixedInput, TUNING, 1 / 15)
      const settled = fsm.current
      // Mismo `fixedInput` sostenido 200 ticks más: el estado no puede
      // volver a cambiar -- si cambiara, sería oscilación bajo condiciones
      // que NO cambiaron, exactamente lo que esta garantía prohíbe.
      for (let i = 0; i < 200; i++) {
        const state = stepFsm(fsm, fixedInput, TUNING, 1 / 15)
        expect(state, `input=${JSON.stringify(fixedInput)} tick ${i}`).toBe(settled)
      }
    }
  })

  it('nunca queda atascado: desde Retirarse con vida sostenida en 0, sigue respondiendo a un cambio real', () => {
    const fsm = createFsmState()
    // Empuja a Retirarse y lo sostiene ahí un buen rato con vida en 0.
    for (let i = 0; i < 50; i++) stepFsm(fsm, input({ healthFraction: 0 }), TUNING, 1 / 15)
    expect(fsm.current).toBe('retreat')
    // Un cambio real (la vida se recupera) tiene que sacarlo de Retirarse:
    // si esto fallara, sería la definición misma de "estado atascado".
    const state = stepFsm(fsm, input({ healthFraction: 1 }), TUNING, 1 / 15)
    expect(state).not.toBe('retreat')
  })
})
