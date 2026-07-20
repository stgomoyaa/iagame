import { describe, expect, it } from 'vitest'
import { vec3 } from '@/game/math/vec3'
import type { Hitbox } from '@/game/combat/hitboxes'
import {
  createMeleeResult,
  createMeleeState,
  meleeDamage,
  resolveMeleeHit,
  stepMelee,
  type MeleeInput,
} from '@/game/combat/melee'
import { KNIFE_ARCHETYPE } from '@/game/weapons/melee-catalog'
import { applyDamageToBot, createBotHealthState } from '@/game/bots/health'

const K = KNIFE_ARCHETYPE

// computeForward (combat/shot.ts) con pitch=0, yaw=0 da forward = (0, 0, -1).
// Todo este archivo coloca al origen en (0,10,0) mirando -Z y a las víctimas
// en -Z, dentro del alcance del cuchillo (1.5 m).
const ORIGIN = vec3(0, 10, 0)

/** Una víctima parada a `dist` metros al frente (-Z), con su hitbox de torso. */
function victimaAlFrente(dist: number, owner = 0, radius = 0.4): Hitbox[] {
  return [{ center: vec3(0, 10, -dist), radius, part: 'torso', owner }]
}

describe('meleeDamage: números verificados contra la Valve Developer Community', () => {
  // Fuente: https://developer.valvesoftware.com/wiki/Weapon_knife (unarmored)
  it('tajo fresco = 40, tajo consecutivo = 25', () => {
    expect(meleeDamage(K, 'slash', false, false)).toBe(40)
    expect(meleeDamage(K, 'slash', true, false)).toBe(25)
  })

  it('estocada = 65', () => {
    expect(meleeDamage(K, 'stab', false, false)).toBe(65)
    // La estocada no tiene reducción por consecutivo: 65 pase lo que pase.
    expect(meleeDamage(K, 'stab', true, false)).toBe(65)
  })

  it('tajo por la espalda = 90 (no mata de un golpe a 100 de vida)', () => {
    expect(meleeDamage(K, 'slash', false, true)).toBe(90)
    // El backstab manda sobre la reducción de consecutivo: sigue siendo 90.
    expect(meleeDamage(K, 'slash', true, true)).toBe(90)
    expect(meleeDamage(K, 'slash', false, true)).toBeLessThan(100)
  })

  it('estocada por la espalda = 180 (mata de un golpe a 100 de vida)', () => {
    expect(meleeDamage(K, 'stab', false, true)).toBe(180)
    expect(meleeDamage(K, 'stab', false, true)).toBeGreaterThanOrEqual(100)
  })
})

describe('resolveMeleeHit: aplica daño a un enemigo a rango corto', () => {
  it('un tajo de frente conecta y aplica 40 (sin backstab)', () => {
    const out = createMeleeResult()
    // Víctima mirándome (forward +Z): de frente, no es backstab.
    resolveMeleeHit(ORIGIN, 0, 0, 'slash', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    expect(out.hit).toBe(true)
    expect(out.owner).toBe(0)
    expect(out.backstab).toBe(false)
    expect(out.damage).toBe(40)
    expect(out.surface).toBe('carne')
  })

  it('una estocada de frente conecta y aplica 65', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    expect(out.hit).toBe(true)
    expect(out.backstab).toBe(false)
    expect(out.damage).toBe(65)
  })

  it('el daño NO depende de la parte golpeada (cabeza y torso dan lo mismo)', () => {
    const out = createMeleeResult()
    const cabeza: Hitbox[] = [{ center: vec3(0, 10, -1), radius: 0.4, part: 'head', owner: 0 }]
    const pierna: Hitbox[] = [{ center: vec3(0, 10, -1), radius: 0.4, part: 'limb', owner: 0 }]
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, cabeza, [vec3(0, 0, 1)], K, out)
    const dCabeza = out.damage
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, pierna, [vec3(0, 0, 1)], K, out)
    expect(out.damage).toBe(dCabeza)
  })
})

describe('backstab: regla 2D de la VDC (dot ≥ 0.475)', () => {
  it('víctima dándome la espalda (mira -Z, igual que mi apuntado) → backstab', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, -1)], K, out)
    expect(out.backstab).toBe(true)
    expect(out.damage).toBe(180)
  })

  it('víctima mirándome de frente (mira +Z) → NO backstab', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    expect(out.backstab).toBe(false)
    expect(out.damage).toBe(65)
  })

  it('umbral: 60° de desvío es backstab (cos 60° = 0.5 ≥ 0.475), 62° no', () => {
    const out = createMeleeResult()
    // Mi apuntado es (0,0,-1). Una orientación de víctima a 60° de ese vector
    // (rotada en el plano XZ) todavía cuenta como espalda.
    const rad = (deg: number) => (deg * Math.PI) / 180
    // forward a `deg` de (0,0,-1): (sin, 0, -cos) en XZ.
    const forwardA = (deg: number) => vec3(Math.sin(rad(deg)), 0, -Math.cos(rad(deg)))

    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [forwardA(60)], K, out)
    expect(out.backstab).toBe(true)

    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [forwardA(62)], K, out)
    expect(out.backstab).toBe(false)
  })

  it('una diana sin orientación (forward nulo) nunca recibe backstab', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, 0)], K, out)
    expect(out.backstab).toBe(false)
    expect(out.damage).toBe(65)
  })
})

describe('rango y obstáculos', () => {
  it('un objetivo más allá del alcance no recibe daño', () => {
    const out = createMeleeResult()
    // 3 m > range (1.5 m).
    resolveMeleeHit(ORIGIN, 0, 0, 'slash', false, victimaAlFrente(3.0), [vec3(0, 0, 1)], K, out)
    expect(out.hit).toBe(false)
    expect(out.damage).toBe(0)
  })

  it('un objetivo justo dentro del alcance sí recibe daño', () => {
    const out = createMeleeResult()
    // 1.4 m < range (1.5 m); radio 0.1 para que el borde cercano quede a ~1.3 m.
    resolveMeleeHit(ORIGIN, 0, 0, 'slash', false, victimaAlFrente(1.4, 0, 0.1), [vec3(0, 0, 1)], K, out)
    expect(out.hit).toBe(true)
    expect(out.damage).toBe(40)
  })
})

describe('stepMelee: cooldown, no munición, auto-repetición', () => {
  function inputSlash(): MeleeInput {
    return { slashHeld: true, stabHeld: false, origin: ORIGIN, pitch: 0, yaw: 0 }
  }

  it('el primer tajo sale de inmediato (arma recién equipada, lista)', () => {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    const golpeo = stepMelee(state, K, inputSlash(), victimaAlFrente(1.0), [vec3(0, 0, 1)], 1 / 60, out)
    expect(golpeo).toBe(true)
    expect(out.hit).toBe(true)
    expect(out.damage).toBe(40)
  })

  it('respeta la cadencia: no vuelve a golpear antes del intervalo', () => {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    const hb = victimaAlFrente(1.0)
    const fwd = [vec3(0, 0, 1)]
    // Primer tajo.
    expect(stepMelee(state, K, inputSlash(), hb, fwd, 1 / 60, out)).toBe(true)
    // Enseguida, mucho antes de 0.4 s: no golpea.
    expect(stepMelee(state, K, inputSlash(), hb, fwd, 0.05, out)).toBe(false)
    // Acumulando hasta pasar el intervalo: vuelve a golpear.
    expect(stepMelee(state, K, inputSlash(), hb, fwd, 0.4, out)).toBe(true)
  })

  it('sin botón no golpea nunca (sin munición que gastar, pero sin input tampoco ataca)', () => {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    const sinBoton: MeleeInput = { slashHeld: false, stabHeld: false, origin: ORIGIN, pitch: 0, yaw: 0 }
    for (let i = 0; i < 100; i++) {
      expect(stepMelee(state, K, sinBoton, victimaAlFrente(1.0), [vec3(0, 0, 1)], 0.1, out)).toBe(false)
    }
  })

  it('reducción por consecutivo: 1er tajo 40, siguiente inmediato 25, tras pausa vuelve a 40', () => {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    const hb = victimaAlFrente(1.0)
    const fwd = [vec3(0, 0, 1)]
    // Primer tajo: fresco.
    stepMelee(state, K, inputSlash(), hb, fwd, 1 / 60, out)
    expect(out.damage).toBe(40)
    // Siguiente al pasar justo el intervalo (0.4 s < ventana de reset 1 s): consecutivo.
    stepMelee(state, K, inputSlash(), hb, fwd, K.slashInterval, out)
    expect(out.damage).toBe(25)
    // Pausa larga (sin golpear) más que la ventana de reset, luego un tajo: fresco de nuevo.
    const sinBoton: MeleeInput = { slashHeld: false, stabHeld: false, origin: ORIGIN, pitch: 0, yaw: 0 }
    stepMelee(state, K, sinBoton, hb, fwd, K.freshSlashResetS + 0.2, out)
    stepMelee(state, K, inputSlash(), hb, fwd, K.slashInterval, out)
    expect(out.damage).toBe(40)
  })

  it('la estocada gana si se sostienen los dos botones', () => {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    const ambos: MeleeInput = { slashHeld: true, stabHeld: true, origin: ORIGIN, pitch: 0, yaw: 0 }
    stepMelee(state, K, ambos, victimaAlFrente(1.0), [vec3(0, 0, 1)], 1 / 60, out)
    expect(out.kind).toBe('stab')
    expect(out.damage).toBe(65)
  })
})

describe('EVIDENCIA MEDIBLE: tajo daña, estocada daña más, backstab mata de un golpe', () => {
  // Simula la vida de un enemigo de 100 (como aplica applyDamageToBot en
  // game.ts) y confirma el efecto de cada golpe.
  const VIDA = 100

  it('un tajo baja la vida pero no mata', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'slash', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    const vidaRestante = VIDA - out.damage
    expect(out.damage).toBe(40)
    expect(vidaRestante).toBe(60)
    expect(vidaRestante).toBeGreaterThan(0) // no mata
  })

  it('una estocada de frente hace más daño que un tajo, y no mata de un golpe', () => {
    const out = createMeleeResult()
    resolveMeleeHit(ORIGIN, 0, 0, 'slash', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    const dTajo = out.damage
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, 1)], K, out)
    const dEstocada = out.damage
    expect(dEstocada).toBeGreaterThan(dTajo)
    expect(VIDA - dEstocada).toBeGreaterThan(0) // 100 - 65 = 35, sobrevive
  })

  it('una estocada por la espalda MATA de un golpe (180 ≥ 100)', () => {
    const out = createMeleeResult()
    // Víctima dándome la espalda (mira -Z, igual que mi apuntado).
    resolveMeleeHit(ORIGIN, 0, 0, 'stab', false, victimaAlFrente(1.0), [vec3(0, 0, -1)], K, out)
    expect(out.backstab).toBe(true)
    expect(out.damage).toBe(180)
    expect(VIDA - out.damage).toBeLessThanOrEqual(0) // muerto
  })
})

describe('INTEGRACIÓN: golpe → vida REAL de un bot (bots/health.ts) → muerte', () => {
  // Prueba el camino completo con el mismo `applyDamageToBot` que usa game.ts,
  // no un 100 hardcodeado: stepMelee resuelve el golpe, y su daño se aplica a
  // un bot de vida llena (BOTS.maxHealth = 100).
  const hb = victimaAlFrente(1.0)
  const deFrente = [vec3(0, 0, 1)] // víctima mirándome: no backstab
  const deEspaldas = [vec3(0, 0, -1)] // víctima dándome la espalda: backstab

  function golpear(input: MeleeInput, ownerForward: ReturnType<typeof vec3>[]) {
    const state = createMeleeState(K)
    const out = createMeleeResult()
    stepMelee(state, K, input, hb, ownerForward, 1 / 60, out)
    return out
  }

  it('una ESTOCADA POR LA ESPALDA mata a un bot de 100 de un solo golpe', () => {
    const bot = createBotHealthState() // 100
    expect(bot.health).toBe(100)
    const out = golpear({ slashHeld: false, stabHeld: true, origin: ORIGIN, pitch: 0, yaw: 0 }, deEspaldas)
    expect(out.backstab).toBe(true)
    const murio = applyDamageToBot(bot, out.damage)
    expect(murio).toBe(true)
    expect(bot.alive).toBe(false)
  })

  it('un TAJO de frente daña pero NO mata (queda vivo con 60)', () => {
    const bot = createBotHealthState()
    const out = golpear({ slashHeld: true, stabHeld: false, origin: ORIGIN, pitch: 0, yaw: 0 }, deFrente)
    const murio = applyDamageToBot(bot, out.damage)
    expect(murio).toBe(false)
    expect(bot.alive).toBe(true)
    expect(bot.health).toBe(60)
  })

  it('dos ESTOCADAS de frente matan (65 + 65 = 130 ≥ 100), la primera no', () => {
    const bot = createBotHealthState()
    const out = createMeleeResult()
    const state = createMeleeState(K)
    const input: MeleeInput = { slashHeld: false, stabHeld: true, origin: ORIGIN, pitch: 0, yaw: 0 }
    // Primera estocada.
    stepMelee(state, K, input, hb, deFrente, 1 / 60, out)
    expect(applyDamageToBot(bot, out.damage)).toBe(false)
    expect(bot.alive).toBe(true)
    // Segunda estocada, pasado el cooldown del secondary.
    stepMelee(state, K, input, hb, deFrente, K.stabInterval, out)
    expect(applyDamageToBot(bot, out.damage)).toBe(true)
    expect(bot.alive).toBe(false)
  })
})

describe('presupuesto de asignaciones del melee', () => {
  it('stepMelee (cooldown + trace de mapa + hitboxes) no retiene nada de un golpe al siguiente', () => {
    // Mismo patrón y razonamiento que combat/allocations.test.ts: MeshBVH
    // asigna objetos transitorios por trace, así que se mide con gc() antes y
    // después del tramo y un umbral holgado; una fuga real (algo RETENIDO por
    // golpe) sobrevive al GC y lo supera igual.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const state = createMeleeState(K)
    const out = createMeleeResult()
    const hitboxes = victimaAlFrente(1.0)
    const ownerForward = [vec3(0, 0, 1)]
    const input: MeleeInput = { slashHeld: true, stabHeld: false, origin: ORIGIN, pitch: 0, yaw: 0 }
    // dt = el intervalo exacto del tajo: cada llamada resuelve un golpe real
    // (trace de mapa + hitboxes), nunca sólo la rama ociosa.
    const dt = K.slashInterval

    for (let i = 0; i < 2000; i++) stepMelee(state, K, input, hitboxes, ownerForward, dt, out)

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    const ITERACIONES = 200_000
    let golpes = 0
    for (let i = 0; i < ITERACIONES; i++) {
      if (stepMelee(state, K, input, hitboxes, ownerForward, dt, out)) golpes++
    }
    expect(golpes).toBeGreaterThan(2000)

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    expect(crecimientoMB).toBeLessThan(0.5)
  })
})
