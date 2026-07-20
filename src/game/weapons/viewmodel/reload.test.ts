import { describe, expect, it } from 'vitest'
import {
  chargeShape,
  createMagTransform,
  magazinePose,
  reloadEnvelope,
  slapShape,
  snap,
  tug,
  yankShape,
} from '@/game/weapons/viewmodel/reload'
import {
  createViewmodelState,
  reloadFraction,
  startReload,
  stepViewmodel,
  type ViewmodelInput,
} from '@/game/weapons/viewmodel/rig'
import type { VmTransform, WeaponVisual } from '@/game/weapons/viewmodel/types'
import { VIEWMODEL } from '@/game/weapons/viewmodel/tuning'
import { TICK_DT } from '@/game/engine/constants'

const MAG_OUT = VIEWMODEL.reloadMagOutAt
const MAG_IN = VIEWMODEL.reloadMagInAt

/** Recorre [0, 1.5] con paso fino. Devuelve las fracciones muestreadas. */
function barrido(paso = 0.001): number[] {
  const fracs: number[] = []
  for (let f = 0; f <= 1.5; f += paso) fracs.push(f)
  return fracs
}

describe('las dos fracciones del spec no se movieron', () => {
  // La tarea permite agregar fases pero NO mover magOut ni magIn, y hay un
  // test de timing de eventos en rig.test.ts que depende de estos dos
  // valores. Este test es el recordatorio explícito de por qué son sagrados.
  it('magOut sigue en 0.25 y magIn en 0.55', () => {
    expect(VIEWMODEL.reloadMagOutAt).toBe(0.25)
    expect(VIEWMODEL.reloadMagInAt).toBe(0.55)
  })

  it('los dos golpes secos arrancan exactamente en esas dos fracciones', () => {
    // El acento visual y el evento tienen que ser el mismo instante: si el
    // golpe arrancara antes o después, el jugador vería el arma sacudirse en
    // un momento y (con munición real) el contador cambiar en otro.
    expect(yankShape(MAG_OUT - 1e-9)).toBe(0)
    expect(yankShape(MAG_OUT + 1e-6)).toBeGreaterThan(0)
    expect(slapShape(MAG_IN - 1e-9)).toBe(0)
    expect(slapShape(MAG_IN + 1e-6)).toBeGreaterThan(0)
  })
})

describe('todo vuelve a reposo exacto', () => {
  // La garantía central del archivo: una recarga terminada -o pasada de largo
  // por un dt gigante- deja el arma en su pose base SIN residuo. No "casi".
  it('todas las formas valen exactamente 0 en frac >= 1', () => {
    for (const f of [1, 1.0001, 1.1, 2, 10, 1e6]) {
      expect(reloadEnvelope(f), `envelope en ${f}`).toBe(0)
      expect(yankShape(f), `yank en ${f}`).toBe(0)
      expect(slapShape(f), `slap en ${f}`).toBe(0)
      expect(chargeShape(f), `charge en ${f}`).toBe(0)
    }
  })

  it('ninguna ventana de golpe se pasa de frac = 1', () => {
    // Si una ventana cerrara después de 1, el arma terminaría la recarga con
    // un offset colgando y el test de arriba fallaría por un motivo que no se
    // vería. Esto lo hace explícito.
    expect(VIEWMODEL.reloadMagOutAt + VIEWMODEL.reloadSnapSpan).toBeLessThan(1)
    expect(VIEWMODEL.reloadMagInAt + VIEWMODEL.reloadSnapSpan).toBeLessThan(1)
    expect(VIEWMODEL.reloadChargeAt + VIEWMODEL.reloadChargeSpan).toBeLessThan(1)
    expect(VIEWMODEL.reloadMagInAt + VIEWMODEL.reloadMagInsertSpan).toBeLessThan(1)
  })

  it('la envolvente nunca sale negativa ni se pasa de 1 en todo el barrido', () => {
    // Una envolvente negativa levantaría el arma POR ENCIMA de su reposo
    // durante la recarga (el bug de overshoot que el clamp de la fase C
    // atajaba en la versión anterior, y que hay que seguir atajando).
    for (const f of barrido()) {
      const v = reloadEnvelope(f)
      expect(v, `envelope en ${f}`).toBeGreaterThanOrEqual(0)
      expect(v, `envelope en ${f}`).toBeLessThanOrEqual(1)
    }
  })
})

describe('forma de los golpes', () => {
  it('snap no anticipa: vale 0 antes de su arranque', () => {
    // Un pulso simétrico movería el arma ANTES del evento, y eso se lee como
    // si el arma supiera lo que va a pasar.
    for (const f of [0, 0.1, 0.2, 0.2499]) expect(snap(f, 0.25, 0.1)).toBe(0)
  })

  it('snap sube rápido y decae: el pico está en el primer cuarto de la ventana', () => {
    const start = 0.25
    const span = 0.1
    const pico = snap(start + span * 0.25, start, span)
    expect(pico).toBeCloseTo(1, 10)
    // Antes del pico ya subió bastante; después decae sin volver a subir.
    expect(snap(start + span * 0.5, start, span)).toBeLessThan(pico)
    expect(snap(start + span * 0.75, start, span)).toBeLessThan(
      snap(start + span * 0.5, start, span),
    )
    // JUSTO en el borde de cierre la división (frac-start)/span puede dar
    // 0,9999999999999998 en vez de 1, así que el guard `t >= 1` no llega a
    // dispararse y queda un residuo denormal (~1e-46 m). Se afirma
    // despreciable y no exactamente 0: es la verdad, y forzar el cero exacto
    // ahí pediría comparar fracciones sin normalizar por un residuo billones
    // de veces más chico que un átomo. El cero EXACTO que sí importa -el de
    // frac >= 1, donde t se va muy por encima de 1 y el guard sí dispara- lo
    // cubre 'todas las formas valen exactamente 0 en frac >= 1'.
    expect(Math.abs(snap(start + span, start, span))).toBeLessThan(1e-12)
    expect(snap(start + span * 1.0001, start, span)).toBe(0)
  })

  it('tug va y vuelve: 0 en los extremos, 1 en el medio', () => {
    expect(tug(0.5, 0.5, 0.2)).toBe(0)
    expect(tug(0.6, 0.5, 0.2)).toBeCloseTo(1, 12)
    // Mismo residuo de borde que en snap, por el mismo motivo.
    expect(Math.abs(tug(0.7, 0.5, 0.2))).toBeLessThan(1e-12)
    expect(tug(0.9, 0.5, 0.2)).toBe(0)
  })
})

describe('pose del cargador', () => {
  const pose = createMagTransform()

  it('está puesto y visible antes de que arranque la recarga', () => {
    for (const f of [0, 0.1, 0.24, MAG_OUT - 1e-9]) {
      magazinePose(f, pose)
      expect(pose.py, `py en ${f}`).toBe(0)
      expect(pose.rx, `rx en ${f}`).toBe(0)
      expect(pose.visible, `visible en ${f}`).toBe(true)
    }
  })

  it('cae hacia abajo, cada vez más rápido, y voltea mientras cae', () => {
    const inicio = MAG_OUT
    const fin = MAG_OUT + VIEWMODEL.reloadMagFallSpan
    let anterior = 0
    let deltaAnterior = 0
    for (let i = 1; i <= 20; i++) {
      const f = inicio + ((fin - inicio) * i) / 21
      magazinePose(f, pose)
      // Monótonamente hacia abajo.
      expect(pose.py, `py en ${f}`).toBeLessThan(anterior)
      // Y acelerando: cada tramo baja más que el anterior. Es lo que
      // distingue una caída por gravedad de un descenso suavizado, que se
      // leería como si el cargador flotara.
      const delta = anterior - pose.py
      if (i > 1) expect(delta, `aceleración en ${f}`).toBeGreaterThan(deltaAnterior)
      deltaAnterior = delta
      anterior = pose.py
      expect(pose.visible).toBe(true)
      expect(Math.abs(pose.rx), `tumble en ${f}`).toBeGreaterThan(0)
    }
  })

  it('se esconde en el hueco entre que sale el viejo y entra el nuevo', () => {
    const huecoInicio = MAG_OUT + VIEWMODEL.reloadMagFallSpan
    expect(huecoInicio).toBeLessThan(MAG_IN) // si no, no hay hueco que testear
    for (let f = huecoInicio; f < MAG_IN; f += 0.005) {
      magazinePose(f, pose)
      expect(pose.visible, `visible en ${f}`).toBe(false)
    }
  })

  it('el nuevo entra desde abajo y se asienta EXACTAMENTE en cero', () => {
    magazinePose(MAG_IN, pose)
    expect(pose.visible).toBe(true)
    expect(pose.py).toBeCloseTo(-VIEWMODEL.reloadMagEntryDistance, 12)

    // Sube monótonamente.
    let anterior = pose.py
    const fin = MAG_IN + VIEWMODEL.reloadMagInsertSpan
    for (let i = 1; i < 20; i++) {
      const f = MAG_IN + ((fin - MAG_IN) * i) / 20
      magazinePose(f, pose)
      expect(pose.py, `py en ${f}`).toBeGreaterThan(anterior)
      anterior = pose.py
    }

    // Y termina en cero exacto, no en "casi cero": un cargador que queda a
    // un milímetro de su asiento se ve flotando.
    magazinePose(fin, pose)
    expect(pose.py).toBe(0)
    expect(pose.rx).toBe(0)
    expect(pose.visible).toBe(true)
  })

  it('con la recarga terminada (frac >= 1) el cargador está puesto', () => {
    for (const f of [1, 1.5, 42]) {
      magazinePose(f, pose)
      expect(pose.py, `py en ${f}`).toBe(0)
      expect(pose.pz, `pz en ${f}`).toBe(0)
      expect(pose.rz, `rz en ${f}`).toBe(0)
      expect(pose.visible, `visible en ${f}`).toBe(true)
    }
  })

  it('es función pura de frac: no arrastra nada del tramo anterior', () => {
    // Recorrer la secuencia entera y después volver a pedir una fracción del
    // medio tiene que dar lo mismo que pedirla en frío.
    const enFrio = createMagTransform()
    magazinePose(0.45, enFrio)

    for (const f of barrido(0.01)) magazinePose(f, pose)
    magazinePose(0.45, pose)

    expect(pose.px).toBe(enFrio.px)
    expect(pose.py).toBe(enFrio.py)
    expect(pose.pz).toBe(enFrio.pz)
    expect(pose.rx).toBe(enFrio.rx)
    expect(pose.rz).toBe(enFrio.rz)
    expect(pose.visible).toBe(enFrio.visible)
  })
})

describe('la recarga se lee como recarga, no como un agachón', () => {
  // Éste es el test que codifica el criterio de la tarea. Un agachón baja el
  // arma; una recarga la baja Y la rola para mostrar el pozo del cargador, y
  // tiene acentos en dos momentos precisos. Si alguien "simplifica" la
  // coreografía de vuelta a bajar+inclinar, esto falla.
  const ARMA: WeaponVisual = {
    hip: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    ads: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
    adsTime: 0.25,
    drawTime: 0.25,
    reloadTime: 1.0,
    kickMagnitude: 1,
  }
  const QUIETO: ViewmodelInput = {
    speed: 0,
    grounded: false,
    ads: false,
    mouseDeltaX: 0,
    mouseDeltaY: 0,
  }

  /** Corre una recarga entera y devuelve una muestra por tick. */
  function correrRecarga(): VmTransform[] {
    const state = createViewmodelState()
    const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
    const muestras: VmTransform[] = []
    startReload(state, ARMA)
    for (let i = 0; i < 130; i++) {
      stepViewmodel(state, QUIETO, ARMA, out, TICK_DT)
      muestras.push({ ...out })
    }
    return muestras
  }

  it('el arma rola de verdad durante la recarga', () => {
    const muestras = correrRecarga()
    const rollMax = Math.max(...muestras.map((m) => Math.abs(m.rz)))
    // Sin roll (la versión vieja) esto es exactamente 0. Se pide una fracción
    // grande del roll configurado para que bajarlo a un valor simbólico
    // tampoco pase.
    expect(rollMax).toBeGreaterThan(VIEWMODEL.reloadRoll * 0.9)
  })

  it('el arma baja durante la recarga', () => {
    const muestras = correrRecarga()
    expect(Math.min(...muestras.map((m) => m.py))).toBeLessThan(-VIEWMODEL.reloadDrop * 0.9)
  })

  it('hay un acento hacia abajo en magOut y otro hacia arriba en magIn', () => {
    const muestras = correrRecarga()
    // La envolvente sola es monótona dentro de cada fase. Los golpes rompen
    // esa monotonía, y eso es exactamente lo que se mide: la velocidad de py
    // cambia de signo alrededor de cada evento.
    const py = muestras.map((m) => m.py)

    // magOut cae en el tick 32 (0.25 * 128). Justo después del tirón, py
    // tiene que ir MÁS abajo que la meseta de la fase B, que vale
    // exactamente -reloadDrop.
    const mesetaB = -VIEWMODEL.reloadDrop
    const tirónMin = Math.min(...py.slice(32, 42))
    expect(tirónMin, 'el tirón de magOut tiene que pasarse de la meseta').toBeLessThan(
      mesetaB - VIEWMODEL.reloadYankAmount * 0.5,
    )

    // magIn cae en el tick ~71 (0.55 * 128). La palmada empuja hacia ARRIBA,
    // así que py tiene que quedar por encima de la meseta.
    const palmadaMax = Math.max(...py.slice(70, 82))
    expect(palmadaMax, 'la palmada de magIn tiene que levantar el arma').toBeGreaterThan(
      mesetaB + VIEWMODEL.reloadSlapAmount * 0.5,
    )
  })

  it('hay un tirón de manija de carga cerca del final', () => {
    const muestras = correrRecarga()
    // pz sólo se mueve por el kick (que no se disparó acá) y por la manija.
    const pzMax = Math.max(...muestras.map((m) => m.pz))
    expect(pzMax).toBeGreaterThan(VIEWMODEL.reloadChargeAmount * 0.9)
  })

  it('al terminar, el arma queda exactamente en reposo', () => {
    const muestras = correrRecarga()
    const ultima = muestras[muestras.length - 1]
    expect(ultima.px).toBe(0)
    expect(ultima.py).toBe(0)
    expect(ultima.pz).toBe(0)
    expect(ultima.rx).toBe(0)
    expect(ultima.ry).toBe(0)
    expect(ultima.rz).toBe(0)
  })
})

describe('independencia del framerate de la recarga', () => {
  it('la secuencia a 120 y a 240 Hz recorre las mismas poses', () => {
    // Es la propiedad estructural del archivo: todo es función pura de frac,
    // así que no hay integración por frame que pueda depender del paso. Se
    // verifica igual de punta a punta, porque la propiedad vale sólo si NADIE
    // mete un resorte o un acumulador en el medio más adelante.
    const ARMA: WeaponVisual = {
      hip: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
      ads: { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 },
      adsTime: 0.25,
      drawTime: 0.25,
      reloadTime: 1.0,
      kickMagnitude: 1,
    }
    const QUIETO: ViewmodelInput = {
      speed: 0,
      grounded: false,
      ads: false,
      mouseDeltaX: 0,
      mouseDeltaY: 0,
    }

    /** Pose del cuerpo y del cargador a los `objetivo` segundos de recarga. */
    function poseA(objetivo: number, dt: number): { body: VmTransform; magPy: number } {
      const state = createViewmodelState()
      const out: VmTransform = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
      const mag = createMagTransform()
      startReload(state, ARMA)
      for (let t = 0; t < objetivo - 1e-9; t += dt) {
        stepViewmodel(state, QUIETO, ARMA, out, dt)
      }
      magazinePose(reloadFraction(state), mag)
      return { body: { ...out }, magPy: mag.py }
    }

    // Se muestrea en varios momentos de la secuencia, incluyendo uno dentro
    // de cada golpe seco, que es donde las curvas son más empinadas y donde
    // una dependencia del framerate se notaría primero.
    for (const objetivo of [0.125, 0.26, 0.3, 0.5, 0.57, 0.65, 0.78, 0.95]) {
      const a = poseA(objetivo, 1 / 120)
      const b = poseA(objetivo, 1 / 240)
      // Tolerancia chica: el único error posible es el de muestreo (los dos
      // framerates caen en fracs levemente distintas), no de integración.
      const tol = 0.02
      expect(Math.abs(a.body.py - b.body.py), `py en ${objetivo}`).toBeLessThan(tol)
      expect(Math.abs(a.body.pz - b.body.pz), `pz en ${objetivo}`).toBeLessThan(tol)
      expect(Math.abs(a.body.rx - b.body.rx), `rx en ${objetivo}`).toBeLessThan(tol)
      expect(Math.abs(a.body.rz - b.body.rz), `rz en ${objetivo}`).toBeLessThan(tol)
      expect(Math.abs(a.magPy - b.magPy), `magPy en ${objetivo}`).toBeLessThan(tol)
    }
  })
})
