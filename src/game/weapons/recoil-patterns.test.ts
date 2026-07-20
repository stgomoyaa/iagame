import { describe, expect, it } from 'vitest'
import { ARCHETYPES, radToDeg } from '@/game/weapons/archetypes'
import { PITCH_LIMIT } from '@/game/engine/input'
import {
  AK47_CS_CLIMB_DEG,
  MIN_LEARNABLE_CLIMB_DEG,
  REAL_RECOIL_PATTERNS,
  recoilPatternGame,
  resolveRecoilPattern,
} from '@/game/weapons/recoil-patterns'
import { SOURCE_WEAPONS_BY_SLUG } from '@/game/weapons/source-catalog'

/** Subida total (grados) de un patrón: el punto más alto que alcanza. */
function climbDeg(points: readonly (readonly [number, number])[]): number {
  return radToDeg(Math.max(...points.map((p) => p[1])))
}

/** Convención de PANTALLA: `x` del motor es yaw, y yaw positivo mira a la
 *  IZQUIERDA (engine/input.ts resta el movimiento del mouse). Para razonar
 *  sobre "el patrón se va a la derecha" hay que invertirlo. */
function screenX(point: readonly [number, number]): number {
  return -point[0]
}

describe('patrones reales: integridad de la tabla', () => {
  it('todo slug con patrón real existe en el catálogo de armas locales', () => {
    const slugs = Object.keys(REAL_RECOIL_PATTERNS)
    expect(slugs.length).toBeGreaterThan(0)
    for (const slug of slugs) {
      expect(SOURCE_WEAPONS_BY_SLUG.get(slug), `${slug} no está en el catálogo`).toBeDefined()
    }
  })

  it('cada patrón cubre el cargador entero de SU arquetipo (mismo invariante que los generados)', () => {
    // Nuestras estadísticas son nuestras: el cargador lo manda el arquetipo,
    // no el que el arma tiene en el juego de origen. Lo que se importa es el
    // dibujo, no el contexto en el que se dispara.
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      const archetype = ARCHETYPES[SOURCE_WEAPONS_BY_SLUG.get(slug)!.archetype]
      expect(entry.points.length, `${slug} (${archetype.id})`).toBe(archetype.magazine)
    }
  })

  it('el disparo 0 de todo patrón real es exactamente [0, 0]: el primer tiro no se desvía', () => {
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      expect(entry.points[0][0], `${slug} x`).toBe(0)
      expect(entry.points[0][1], `${slug} y`).toBe(0)
    }
  })

  it('todo patrón declara de qué juego viene', () => {
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      expect(entry.game, slug).toBe('CS')
    }
    expect(recoilPatternGame('ak47')).toBe('CS')
    // Un arma CC0 no tiene patrón real y por lo tanto tampoco juego de origen.
    expect(recoilPatternGame('assaultrifle-1')).toBeNull()
    expect(recoilPatternGame(null)).toBeNull()
  })

  it('ninguna arma por debajo del umbral de forma aprendible entró a la tabla', () => {
    // Las de cadencia baja (cerrojo, escopeta de bombeo) no acumulan dibujo en
    // el juego original: su patrón real es un cero. Ver el encabezado del
    // módulo. Si alguna se colara, el arma quedaría SIN retroceso.
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      expect(climbDeg(entry.points), `${slug} entró siendo plano`).toBeGreaterThanOrEqual(
        MIN_LEARNABLE_CLIMB_DEG,
      )
    }
    for (const slug of ['awp', 'ssg08', 'nova', 'sawedoff', 'mag7', 'revolver', 'famas']) {
      expect(REAL_RECOIL_PATTERNS[slug], `${slug} no debería tener patrón real`).toBeUndefined()
    }
  })
})

describe('patrones reales: cordura física', () => {
  it('la subida total de cada patrón queda bien adentro del PITCH_LIMIT (mitad o menos)', () => {
    const limitDeg = radToDeg(PITCH_LIMIT)
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      expect(climbDeg(entry.points), slug).toBeLessThanOrEqual(limitDeg / 2)
    }
  })

  it('la escala se RE-DERIVA del patrón del AK, no se cree la constante', () => {
    // Si alguien re-escalara los datos (o cambiara el factor de conversión)
    // sin tocar la constante, esto falla. Es el guard de la conversión de
    // unidades: grados del juego original -> radianes nuestros, factor 1.
    const ak = REAL_RECOIL_PATTERNS.ak47
    expect(climbDeg(ak.points)).toBeCloseTo(AK47_CS_CLIMB_DEG, 4)
  })

  it('ningún paso disparo-a-disparo pega un salto absurdo (detecta datos corruptos o un wrap roto)', () => {
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      const total = climbDeg(entry.points)
      for (let i = 1; i < entry.points.length; i++) {
        const dy = Math.abs(radToDeg(entry.points[i][1] - entry.points[i - 1][1]))
        expect(dy, `${slug} salto en el disparo ${i}`).toBeLessThan(total)
      }
    }
  })
})

describe('el problema que esta tarea arregla: cada arma tiene SU dibujo', () => {
  it('dos armas del mismo arquetipo ya no comparten patrón (AK-47 y M4A4 son las dos ar-1)', () => {
    const ak = REAL_RECOIL_PATTERNS.ak47.points
    const m4 = REAL_RECOIL_PATTERNS.m4a4.points
    expect(ARCHETYPES[SOURCE_WEAPONS_BY_SLUG.get('ak47')!.archetype].id).toBe('ar-1')
    expect(ARCHETYPES[SOURCE_WEAPONS_BY_SLUG.get('m4a4')!.archetype].id).toBe('ar-1')
    expect(ak).not.toEqual(m4)
    // Y no es "el mismo dibujo un poco más chico": el AK sube claramente más.
    expect(climbDeg(ak)).toBeGreaterThan(climbDeg(m4) * 1.15)
  })

  it('ningún par de armas comparte patrón, salvo las variantes sin visor de la MISMA arma', () => {
    const entries = Object.entries(REAL_RECOIL_PATTERNS)
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [a, pa] = entries[i]
        const [b, pb] = entries[j]
        // `aug` y `aug_scopeless` son el mismo arma con y sin óptica: quitar
        // el visor no le cambia el retroceso, así que ahí compartir es correcto.
        const mismaArma = a.replace('_scopeless', '') === b.replace('_scopeless', '')
        if (mismaArma) {
          expect(pa.points, `${a} vs ${b}`).toEqual(pb.points)
        } else {
          expect(pa.points, `${a} y ${b} comparten patrón`).not.toEqual(pb.points)
        }
      }
    }
  })

  it('ningún patrón real coincide con el generado de su arquetipo', () => {
    for (const [slug, entry] of Object.entries(REAL_RECOIL_PATTERNS)) {
      const archetype = ARCHETYPES[SOURCE_WEAPONS_BY_SLUG.get(slug)!.archetype]
      expect(entry.points, slug).not.toEqual(archetype.recoil.pattern)
    }
  })
})

describe('la firma del AK-47: sube, hace la pipa a la DERECHA y vuelve a la izquierda', () => {
  // Esto es lo que hace que el patrón sea "el del AK" y no "un patrón". Está
  // escrito sobre la forma, no sobre números puntuales, para que sobreviva a
  // una reconversión y siga fallando si el dibujo deja de ser el del juego.
  const ak = REAL_RECOIL_PATTERNS.ak47.points

  it('las primeras balas suben casi rectas: el tallo del patrón', () => {
    const maxLateral = Math.max(...ak.map((p) => Math.abs(p[0])))
    for (let i = 0; i <= 4; i++) {
      expect(Math.abs(ak[i][0]), `disparo ${i} se va de lado`).toBeLessThan(maxLateral * 0.1)
    }
    // Y para el disparo 5 ya subió una parte apreciable del total.
    expect(ak[5][1]).toBeGreaterThan(ak[ak.length - 1][1] * 0.4)
  })

  it('la vertical llega a su meseta en la primera mitad del cargador', () => {
    const total = Math.max(...ak.map((p) => p[1]))
    expect(ak[12][1]).toBeGreaterThan(total * 0.85)
  })

  it('a media subida se va a la DERECHA (la pipa) y después vuelve a la IZQUIERDA', () => {
    const derecha = Math.max(...ak.slice(9, 16).map(screenX))
    const izquierda = Math.min(...ak.slice(16, 27).map(screenX))
    expect(derecha, 'la pipa a la derecha no está').toBeGreaterThan(0)
    expect(izquierda, 'no vuelve a la izquierda').toBeLessThan(0)
    // Las dos ramas tienen que ser anchas de verdad, no un temblor.
    expect(derecha - izquierda).toBeGreaterThan(maxAbsLateral(ak) * 0.8)
  })

  it('el extremo derecho llega ANTES que el izquierdo: primero pipa, después vuelta', () => {
    const iDerecha = indexOfMax(ak.map(screenX))
    const iIzquierda = indexOfMax(ak.map((p) => -screenX(p)))
    expect(iDerecha).toBeLessThan(iIzquierda)
  })
})

describe('resolveRecoilPattern: respaldo por arquetipo', () => {
  it('un arma con patrón real devuelve el suyo', () => {
    const ar1 = ARCHETYPES['ar-1']
    expect(resolveRecoilPattern('ak47', ar1)).toBe(REAL_RECOIL_PATTERNS.ak47.points)
    expect(resolveRecoilPattern('ak47', ar1)).not.toBe(ar1.recoil.pattern)
  })

  it('un arma CC0 (sin contraparte real) cae al patrón generado de su arquetipo', () => {
    const ar1 = ARCHETYPES['ar-1']
    expect(resolveRecoilPattern('assaultrifle-1', ar1)).toBe(ar1.recoil.pattern)
  })

  it('un arma local sin forma aprendible (AWP) también cae al generado', () => {
    const bolt = ARCHETYPES['sniper-bolt']
    expect(resolveRecoilPattern('awp', bolt)).toBe(bolt.recoil.pattern)
  })

  it('sin slug (bots, que eligen por arquetipo) devuelve el del arquetipo', () => {
    const lmg = ARCHETYPES.lmg
    expect(resolveRecoilPattern(null, lmg)).toBe(lmg.recoil.pattern)
  })
})

function maxAbsLateral(points: readonly (readonly [number, number])[]): number {
  return Math.max(...points.map((p) => Math.abs(p[0])))
}

function indexOfMax(values: number[]): number {
  let best = 0
  for (let i = 1; i < values.length; i++) if (values[i] > values[best]) best = i
  return best
}
