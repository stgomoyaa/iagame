import { describe, expect, it } from 'vitest'
import {
  AR_REFERENCE_CLIMB_DEG_MAX,
  AR_REFERENCE_CLIMB_DEG_MIN,
  ARCHETYPE_LIST,
  ARCHETYPES,
  damageAtRange,
  generateRecoilPattern,
  radToDeg,
  recoilOffsetForShot,
  shotsToKill,
  ttkMs,
  type ArchetypeId,
} from '@/game/weapons/archetypes'
import { PITCH_LIMIT } from '@/game/engine/input'

const HEALTH = 100

// Los dos arquetipos de un solo tiro a rango óptimo: la sección 5 del spec
// los llama explícitamente "instantáneo" (francotirador) y "a quemarropa"
// (escopeta). Su TTK da 0ms por fórmula, fuera de la banda 250-400ms, y eso
// es correcto: no son un caso que "no dio" el balance, son la excepción que
// el propio spec documenta.
const ONE_SHOT_ARCHETYPES: ArchetypeId[] = ['sniper-bolt', 'shotgun']

/** Componente vertical (climb) de cada entrada del patrón. */
function verticals(archetype: ArchetypeId): number[] {
  return ARCHETYPES[archetype].recoil.pattern.map(([, y]) => y)
}

/**
 * Subida vertical total del patrón, en grados: pico menos valle. No se usa
 * sólo el último valor menos el primero porque el jitter puede hacer que el
 * pico real no caiga exactamente en el último disparo.
 */
function totalClimbDeg(archetype: ArchetypeId): number {
  const ys = verticals(archetype)
  return radToDeg(Math.max(...ys) - Math.min(...ys))
}

/**
 * Banda físicamente sana de subida vertical total por arquetipo, en grados.
 * `ar-1` tiene que caer dentro de AR_REFERENCE_CLIMB_DEG_MIN/MAX (15-20°,
 * la referencia real de CS/Valorant sobre un cargador completo, ver el
 * comentario de esa constante en archetypes.ts): es el arquetipo de línea
 * base, así que usa la banda sin ajustar. El resto escala por carácter:
 * - lmg sube más en total por su cargador de 100 balas (más acumulación),
 *   aunque el ritmo por disparo sea el más suave del arsenal.
 * - smg-1/smg-2 suben menos que el rifle base (calibre menor); smg-2 gana
 *   en control sobre smg-1, como documenta su comentario en archetypes.ts.
 * - sniper-bolt, sniper-marksman y shotgun disparan semi/cerrojo con
 *   pausas largas entre tiros: cada uno da un golpe seco chico en vez de
 *   una escalada de spray.
 * - ar-2 es una ráfaga de 3 balas que resetea entre ráfagas: su "cargador"
 *   real a efectos de retroceso es la ráfaga, no las 30 balas del arma.
 */
const CLIMB_BAND_DEG: Record<ArchetypeId, [number, number]> = {
  'smg-1': [8, 16],
  'smg-2': [5, 13],
  'ar-1': [AR_REFERENCE_CLIMB_DEG_MIN, AR_REFERENCE_CLIMB_DEG_MAX],
  'ar-2': [2, 8],
  'ar-3': [15, 25],
  'sniper-bolt': [3, 10],
  'sniper-marksman': [6, 15],
  shotgun: [5, 13],
  lmg: [18, 28],
  pistol: [6, 14],
}

describe('arquetipos: catálogo', () => {
  it('hay exactamente 10 arquetipos', () => {
    expect(ARCHETYPE_LIST.length).toBe(10)
  })

  it('cada arquetipo tiene magazine, fireRate y daño positivos', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(a.magazine).toBeGreaterThan(0)
      expect(a.fireRate).toBeGreaterThan(0)
      expect(a.damage.base).toBeGreaterThan(0)
    }
  })

  it('id del arquetipo coincide con la clave con la que está registrado', () => {
    for (const [key, archetype] of Object.entries(ARCHETYPES)) {
      expect(archetype.id).toBe(key)
    }
  })
})

describe('TTK: banda 250-400ms a rango óptimo (sección 5 del spec)', () => {
  const multiShot = ARCHETYPE_LIST.filter((a) => !ONE_SHOT_ARCHETYPES.includes(a.id))

  it('los arquetipos de más de un disparo caen dentro de la banda, calculado, no hardcodeado', () => {
    for (const a of multiShot) {
      const ttk = ttkMs(a, HEALTH)
      expect(ttk, `${a.id}: ttk=${ttk}`).toBeGreaterThanOrEqual(250)
      expect(ttk, `${a.id}: ttk=${ttk}`).toBeLessThanOrEqual(400)
    }
  })

  it('los arquetipos de un solo tiro matan en 1 disparo a rango óptimo (TTK=0, fuera de la banda a propósito)', () => {
    for (const id of ONE_SHOT_ARCHETYPES) {
      const a = ARCHETYPES[id]
      expect(shotsToKill(a, HEALTH, a.damage.optimalRange)).toBe(1)
      expect(ttkMs(a, HEALTH)).toBe(0)
    }
  })

  it('AR 1 reproduce el ejemplo exacto del spec: 24 daño / 600 RPM -> 5 disparos, 400ms', () => {
    const ar1 = ARCHETYPES['ar-1']
    expect(ar1.damage.base).toBe(24)
    expect(ar1.fireRate).toBe(600)
    expect(shotsToKill(ar1, HEALTH, ar1.damage.optimalRange)).toBe(5)
    expect(ttkMs(ar1, HEALTH)).toBe(400)
  })

  it('SMG 1 reproduce el ejemplo exacto del spec: 18 daño / 850 RPM -> 6 disparos, ~353ms', () => {
    const smg1 = ARCHETYPES['smg-1']
    expect(smg1.damage.base).toBe(18)
    expect(smg1.fireRate).toBe(850)
    expect(shotsToKill(smg1, HEALTH, smg1.damage.optimalRange)).toBe(6)
    expect(ttkMs(smg1, HEALTH)).toBeCloseTo(352.94, 1)
  })

  it('sniper-bolt reproduce el ejemplo exacto del spec: 110 de cuerpo es un solo tiro', () => {
    const bolt = ARCHETYPES['sniper-bolt']
    expect(bolt.damage.base).toBe(110)
    expect(shotsToKill(bolt, HEALTH, bolt.damage.optimalRange)).toBe(1)
  })

  it('la escopeta reproduce el ejemplo exacto del spec: 8 pellets x 14 = 112, un tiro a quemarropa', () => {
    const shotgun = ARCHETYPES.shotgun
    expect(shotgun.damage.base).toBe(8 * 14)
    expect(shotsToKill(shotgun, HEALTH, shotgun.damage.optimalRange)).toBe(1)
  })
})

describe('caída de daño por distancia', () => {
  it('nunca sube con la distancia, para ningún arquetipo', () => {
    for (const a of ARCHETYPE_LIST) {
      const { optimalRange, maxRange } = a.damage
      const distancias = [
        0,
        optimalRange / 2,
        optimalRange,
        optimalRange + (maxRange - optimalRange) / 4,
        (optimalRange + maxRange) / 2,
        maxRange,
        maxRange * 1.5,
        maxRange * 3,
      ]
      let anterior = Infinity
      for (const d of distancias) {
        const dmg = damageAtRange(a, d)
        expect(dmg, `${a.id} en ${d}m: ${dmg} > anterior ${anterior}`).toBeLessThanOrEqual(anterior)
        anterior = dmg
      }
    }
  })

  it('el daño es completo hasta optimalRange y nunca baja del piso más allá de maxRange', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(damageAtRange(a, a.damage.optimalRange)).toBe(a.damage.base)
      expect(damageAtRange(a, 0)).toBe(a.damage.base)
      const piso = a.damage.base * a.damage.minMultiplier
      expect(damageAtRange(a, a.damage.maxRange)).toBeCloseTo(piso, 9)
      expect(damageAtRange(a, a.damage.maxRange * 5)).toBeCloseTo(piso, 9)
    }
  })
})

describe('retroceso: determinismo y cobertura del cargador', () => {
  it('generateRecoilPattern es determinista: misma seed, mismo patrón, siempre', () => {
    const a = generateRecoilPattern(4242, 20, 1.5, 0.6, 0.1)
    const b = generateRecoilPattern(4242, 20, 1.5, 0.6, 0.1)
    expect(a).toEqual(b)
  })

  it('seeds distintas producen patrones distintos', () => {
    const a = generateRecoilPattern(1, 10, 1, 0.5, 0.1)
    const b = generateRecoilPattern(2, 10, 1, 0.5, 0.1)
    expect(a).not.toEqual(b)
  })

  it('todo arquetipo tiene un patrón no vacío', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(a.recoil.pattern.length).toBeGreaterThan(0)
    }
  })

  it('recoilOffsetForShot devuelve un offset definido para cada disparo del cargador completo', () => {
    for (const a of ARCHETYPE_LIST) {
      for (let shot = 0; shot < a.magazine; shot++) {
        const [x, y] = recoilOffsetForShot(a, shot)
        expect(Number.isFinite(x), `${a.id} disparo ${shot}: x`).toBe(true)
        expect(Number.isFinite(y), `${a.id} disparo ${shot}: y`).toBe(true)
      }
    }
  })

  it('smg-1 y lmg ya no envuelven dentro de un cargador: el patrón cubre el cargador entero', () => {
    // Antes (bug corregido): smg-1 tenía patrón de 12 y lmg de 20, ambos más
    // cortos que su cargador, y envolvían por módulo. Ahora cada uno tiene
    // un patrón del mismo largo que su cargador, así que disparos distintos
    // dentro de una misma carga nunca comparten offset.
    const smg1 = ARCHETYPES['smg-1']
    expect(smg1.recoil.pattern.length).toBe(smg1.magazine)
    expect(recoilOffsetForShot(smg1, 12)).not.toEqual(recoilOffsetForShot(smg1, 0))

    const lmg = ARCHETYPES.lmg
    expect(lmg.recoil.pattern.length).toBe(lmg.magazine)
    expect(recoilOffsetForShot(lmg, 99)).toBeDefined()
    expect(recoilOffsetForShot(lmg, 20)).not.toEqual(recoilOffsetForShot(lmg, 0))
  })

  it('cuando el patrón cubre el cargador entero, no necesita envolver dentro de una sola carga', () => {
    // pistola: patrón de 12, cargador de 12. Cada disparo de la carga tiene
    // un offset propio, sin repetición hasta la carga siguiente.
    const pistol = ARCHETYPES.pistol
    expect(pistol.recoil.pattern.length).toBe(pistol.magazine)
  })

  it('ar-2 (ráfaga) es la única excepción con wrap intencional: el patrón de la ráfaga se repite exacto cada 3 disparos', () => {
    // Al contrario de smg-1/lmg arriba, acá el wrap es deliberado: una
    // ráfaga entera es el ciclo, y hay pausa de gatillo real entre ráfagas
    // para que la cámara recupere. El disparo 3 tiene que dar exactamente
    // el mismo offset que el 0 (empieza la ráfaga siguiente), y 30 % 3 = 0
    // así que ninguna ráfaga queda truncada dentro del cargador de 30.
    const ar2 = ARCHETYPES['ar-2']
    expect(ar2.recoil.pattern.length).toBeLessThan(ar2.magazine)
    expect(ar2.magazine % ar2.recoil.pattern.length).toBe(0)
    expect(recoilOffsetForShot(ar2, 3)).toEqual(recoilOffsetForShot(ar2, 0))
    expect(recoilOffsetForShot(ar2, 4)).toEqual(recoilOffsetForShot(ar2, 1))
    expect(recoilOffsetForShot(ar2, 29)).toEqual(recoilOffsetForShot(ar2, 29 % 3))
  })
})

describe('retroceso: cordura física de las magnitudes', () => {
  it('la subida vertical total de cada arquetipo cae dentro de una banda físicamente sana (grados)', () => {
    for (const a of ARCHETYPE_LIST) {
      const [min, max] = CLIMB_BAND_DEG[a.id]
      const climb = totalClimbDeg(a.id)
      expect(climb, `${a.id}: ${climb.toFixed(2)}° fuera de [${min}, ${max}]°`).toBeGreaterThanOrEqual(min)
      expect(climb, `${a.id}: ${climb.toFixed(2)}° fuera de [${min}, ${max}]°`).toBeLessThanOrEqual(max)
    }
  })

  it('ar-1 (arquetipo base) cae en la referencia real de un rifle de asalto: 15-20° sobre el cargador completo', () => {
    const climb = totalClimbDeg('ar-1')
    expect(climb, `ar-1: ${climb.toFixed(2)}°`).toBeGreaterThanOrEqual(AR_REFERENCE_CLIMB_DEG_MIN)
    expect(climb, `ar-1: ${climb.toFixed(2)}°`).toBeLessThanOrEqual(AR_REFERENCE_CLIMB_DEG_MAX)
  })

  it('ningún paso disparo-a-disparo excede un múltiplo chico del paso típico del arma (detecta discontinuidades tipo wrap)', () => {
    // Recorre la secuencia real que ve un jugador: recoilOffsetForShot para
    // cada índice del cargador completo, no el array crudo del patrón. Si
    // el patrón es más corto que el cargador y envuelve por módulo, el
    // salto de vuelta al principio aparece acá, no en el array crudo (que
    // siempre es una rampa monótona sin discontinuidad propia).
    //
    // El paso típico es climb total / (largo del patrón - 1): por identidad
    // telescópica, es exactamente el promedio de los pasos consecutivos de
    // una rampa monótona (los términos intermedios se cancelan). El primer
    // paso de una rampa raíz-cuadrada de N disparos puede llegar a ser
    // hasta sqrt(N-1) veces ese promedio (la derivada de sqrt es infinita
    // en 0): para la LMG (100 disparos) eso da ~9.95x de forma sana y
    // esperable, sin ningún salto real. Un wrap roto en cambio cae del pico
    // a casi cero en un solo paso: QA midió 11x-17x sobre patrones más
    // cortos que el cargador. 12x deja margen sobre el caso sano más
    // extremo sin dejar pasar una discontinuidad real.
    const MAX_STEP_MULTIPLE = 12
    for (const a of ARCHETYPE_LIST) {
      const ys = verticals(a.id)
      const totalClimb = Math.max(...ys) - Math.min(...ys)
      const typicalStep = totalClimb / (ys.length - 1)
      const shots: number[] = []
      for (let shot = 0; shot < a.magazine; shot++) {
        shots.push(recoilOffsetForShot(a, shot)[1])
      }
      for (let i = 1; i < shots.length; i++) {
        const step = Math.abs(shots[i] - shots[i - 1])
        const ratio = typicalStep > 0 ? step / typicalStep : 0
        expect(
          step,
          `${a.id} disparo ${i - 1}->${i}: ${radToDeg(step).toFixed(2)}° (${ratio.toFixed(1)}x el típico de ${radToDeg(typicalStep).toFixed(2)}°)`,
        ).toBeLessThanOrEqual(typicalStep * MAX_STEP_MULTIPLE)
      }
    }
  })

  it('el patrón cubre el cargador entero: mismo largo que magazine para toda arma que no sea de ráfaga', () => {
    for (const a of ARCHETYPE_LIST) {
      if (a.fireMode === 'burst') continue
      expect(a.recoil.pattern.length, a.id).toBe(a.magazine)
    }
  })

  it('ar-2 (la única ráfaga) repite su patrón de ráfaga un número exacto de veces por cargador, sin ciclo truncado', () => {
    const burst = ARCHETYPE_LIST.filter((a) => a.fireMode === 'burst')
    expect(burst.map((a) => a.id)).toEqual(['ar-2'])
    for (const a of burst) {
      expect(a.magazine % a.recoil.pattern.length, a.id).toBe(0)
    }
  })

  it('la subida total de cada arquetipo queda bien adentro del PITCH_LIMIT de la cámara (mitad o menos)', () => {
    // Fase 1 va a aplicar este patrón al pitch de la cámara. PITCH_LIMIT es
    // el rango entero de -90° a 90° (menos un margen); un solo cargador no
    // puede ni acercarse a eso, o el jugador termina mirando al techo.
    for (const a of ARCHETYPE_LIST) {
      const ys = verticals(a.id)
      const climbRad = Math.max(...ys) - Math.min(...ys)
      expect(climbRad, `${a.id}: ${radToDeg(climbRad).toFixed(2)}°`).toBeLessThan(PITCH_LIMIT * 0.5)
    }
  })
})

/**
 * Forma de la curva, estilo CS: la sección de arriba ya cubría magnitudes
 * (cuánto sube en total). Esto cubre la FORMA (cómo se reparte esa subida en
 * el tiempo), que es justo lo que raíz cuadrada rompía: los primeros
 * disparos se comían casi un quinto de todo el climb, al revés de cómo
 * funciona un spray real (apertura ajustada, ráfaga vertical, luego
 * plateau). Ver el comentario largo en generateRecoilPattern().
 *
 * Las armas full-auto sostenido (fireMode 'auto': smg-1, smg-2, ar-1, ar-3,
 * lmg) son las que tienen esta silueta de 3 fases. Las semi/cerrojo (sniper,
 * shotgun, pistola) y la ráfaga (ar-2) ya están documentadas como "golpe
 * seco" en vez de rampa — con 3-12 disparos no hay margen para que una
 * apertura-rampa-plateau se note, y el spec ya las trata distinto (ver sus
 * comentarios en archetypes.ts). Las pruebas de silueta sólo aplican a las
 * de fuego sostenido, que es para lo que existe la silueta.
 */
describe('retroceso: forma de la curva (apertura ajustada, rampa, plateau — estilo CS)', () => {
  const AUTO_IDS = ARCHETYPE_LIST.filter((a) => a.fireMode === 'auto').map((a) => a.id)

  it('el disparo 0 de todo arquetipo da offset exactamente cero, sin jitter (arranque de cargador limpio)', () => {
    for (const a of ARCHETYPE_LIST) {
      const [x, y] = a.recoil.pattern[0]
      expect(x, a.id).toBe(0)
      expect(y, a.id).toBe(0)
    }
  })

  it('la subida vertical nunca retrocede dentro de un patrón: puede aplanarse, pero jamás baja', () => {
    for (const a of ARCHETYPE_LIST) {
      const ys = verticals(a.id)
      for (let i = 1; i < ys.length; i++) {
        expect(ys[i], `${a.id} disparo ${i - 1}->${i}: ${radToDeg(ys[i - 1]).toFixed(3)}° -> ${radToDeg(ys[i]).toFixed(3)}°`).toBeGreaterThanOrEqual(ys[i - 1])
      }
    }
  })

  // Este es el test que habría atajado el bug original: con raíz cuadrada,
  // los primeros 3 disparos ya se comían 26-29% del climb total (medido
  // sobre smg-1/smg-2/ar-1/ar-3; 14% incluso en la lmg de 100 balas). Estilo
  // CS, tiene que quedar bien por debajo de eso: los primeros disparos son
  // para tirar al bulto con precisión, no el inicio de la escalada.
  it('el share del climb total gastado en los primeros 3 disparos queda chico (esto habría detectado el bug de raíz cuadrada)', () => {
    const FIRST_THREE_SHOTS_SHARE_MAX = 0.12
    for (const id of AUTO_IDS) {
      const ys = verticals(id)
      const total = Math.max(...ys) - Math.min(...ys)
      const share = (ys[2] - ys[0]) / total
      expect(share, `${id}: ${(share * 100).toFixed(1)}% del climb ya en el disparo 3`).toBeLessThan(
        FIRST_THREE_SHOTS_SHARE_MAX,
      )
    }
  })

  it('el último cuarto del cargador aporta poco climb vertical: la rampa ya aplanó antes de llegar ahí', () => {
    const FINAL_QUARTER_SHARE_MAX = 0.1
    for (const id of AUTO_IDS) {
      const ys = verticals(id)
      const total = Math.max(...ys) - Math.min(...ys)
      const q3Index = Math.floor((ys.length - 1) * 0.75)
      const climbBeforeFinalQuarter = ys[q3Index] - ys[0]
      const finalQuarterShare = 1 - climbBeforeFinalQuarter / total
      expect(
        finalQuarterShare,
        `${id}: el último cuarto aporta ${(finalQuarterShare * 100).toFixed(1)}% del climb`,
      ).toBeLessThan(FINAL_QUARTER_SHARE_MAX)
    }
  })

  it('el desvío horizontal en el primer cuarto del cargador es chico frente a su máximo, y crece después', () => {
    const FIRST_QUARTER_HORIZONTAL_RATIO_MAX = 0.3
    for (const id of AUTO_IDS) {
      const xs = ARCHETYPES[id].recoil.pattern.map(([x]) => Math.abs(x))
      const maxAbs = Math.max(...xs)
      const q1Index = Math.floor((xs.length - 1) * 0.25)
      const maxAbsFirstQuarter = Math.max(...xs.slice(0, q1Index + 1))
      const maxAbsAfter = Math.max(...xs.slice(q1Index + 1))
      const ratio = maxAbs > 0 ? maxAbsFirstQuarter / maxAbs : 0
      expect(ratio, `${id}: primer cuarto llega a ${(ratio * 100).toFixed(1)}% del máximo horizontal`).toBeLessThan(
        FIRST_QUARTER_HORIZONTAL_RATIO_MAX,
      )
      expect(maxAbsAfter, `${id}: el resto del cargador no supera al primer cuarto`).toBeGreaterThan(
        maxAbsFirstQuarter,
      )
    }
  })
})

describe('golpe de vista (viewKick): presente y ordenado por carácter de clase', () => {
  it('todos los arquetipos declaran un viewKick > 0 (todo disparo patea la vista)', () => {
    for (const a of ARCHETYPE_LIST) {
      expect(a.recoil.viewKick, a.id).toBeGreaterThan(0)
    }
  })

  it('la escopeta y el cerrojo dan el golpe más fuerte; las SMG el más suave', () => {
    const kick = (id: keyof typeof ARCHETYPES): number => ARCHETYPES[id].recoil.viewKick
    // Eventos únicos de golpe seco grande.
    expect(kick('shotgun')).toBeGreaterThan(kick('ar-1'))
    expect(kick('sniper-bolt')).toBeGreaterThan(kick('ar-1'))
    expect(kick('sniper-marksman')).toBeGreaterThan(kick('ar-1'))
    // Cadencia altísima, muchos empujones chicos.
    expect(kick('smg-1')).toBeLessThan(kick('ar-1'))
    expect(kick('smg-2')).toBeLessThan(kick('ar-1'))
    expect(kick('lmg')).toBeLessThan(kick('ar-1'))
  })
})

describe('ar-2 (ráfaga): el patrón sube recto sin cambiar de dirección (no teletransporta)', () => {
  const ar2 = ARCHETYPES['ar-2']

  it('la subida vertical es monótona no decreciente', () => {
    const ys = ar2.recoil.pattern.map(([, y]) => y)
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1])
  })

  it('la deriva horizontal NO cambia de dirección entre balas (la causa del teletransporte)', () => {
    // El bug viejo: el serpenteo senoidal saltaba el yaw ~2.8° cambiando de
    // signo entre la bala 2 y la 3. Ahora la deriva es chica y de un solo lado:
    // los deltas de x no invierten el signo.
    const xs = ar2.recoil.pattern.map(([x]) => x)
    const deltas = xs.slice(1).map((x, i) => x - xs[i])
    const signos = new Set(deltas.filter((d) => Math.abs(d) > 1e-9).map((d) => Math.sign(d)))
    expect(signos.size).toBeLessThanOrEqual(1) // todos los deltas del mismo signo
    // Y la deriva total es chica frente a la subida (sube recto).
    const driftTotal = Math.abs(xs[xs.length - 1])
    const climbTotal = ar2.recoil.pattern[ar2.recoil.pattern.length - 1][1]
    expect(driftTotal).toBeLessThan(climbTotal * 0.3)
  })
})
