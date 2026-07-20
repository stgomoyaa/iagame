import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { SOURCE_WEAPONS } from '@/game/weapons/source-catalog'
import {
  crosshairOpacityUnderScope,
  mildotOffsetPx,
  SCOPE,
  scopeAlpha,
  scopeLensRadiusPx,
  scopeLensScale,
  scopeReticleForWeapon,
  sightForSlug,
} from '@/game/feedback/scope'

describe('qué armas llevan estampa de visor', () => {
  it('el cerrojo con óptica lleva mildot y el marksman con óptica lleva duplex', () => {
    expect(scopeReticleForWeapon('sniper-bolt', 'optica')).toBe('mildot')
    expect(scopeReticleForWeapon('sniper-marksman', 'optica')).toBe('duplex')
  })

  // El corazón de la regla: las variantes `_scopeless` son el MISMO
  // arquetipo. Si el criterio fuera sólo por arquetipo, estas seis se
  // comerían un tubo negro sin tener visor en el modelo.
  it('las variantes _scopeless del catálogo NO llevan estampa, pese a ser arquetipo de francotirador', () => {
    const scopeless = SOURCE_WEAPONS.filter((w) => w.slug.endsWith('_scopeless'))
    expect(scopeless.length).toBeGreaterThan(0)
    for (const arma of scopeless) {
      expect(scopeReticleForWeapon(arma.archetype, arma.sight), arma.slug).toBeNull()
    }
  })

  // La otra mitad: `optica` no implica visor telescópico. aug y sg553 son
  // fusiles de asalto con óptica integrada y en CS tampoco tapan la pantalla.
  it('los fusiles con óptica integrada (ar-3) NO llevan estampa', () => {
    const conOptica = SOURCE_WEAPONS.filter((w) => w.sight === 'optica' && w.archetype === 'ar-3')
    expect(conOptica.map((w) => w.slug)).toEqual(['aug', 'sg553'])
    for (const arma of conOptica) {
      expect(scopeReticleForWeapon(arma.archetype, arma.sight), arma.slug).toBeNull()
    }
  })

  it('exactamente cuatro armas del catálogo llevan estampa, y son las cuatro de precisión con óptica', () => {
    const conEstampa = SOURCE_WEAPONS.filter(
      (w) => scopeReticleForWeapon(w.archetype, w.sight) !== null,
    ).map((w) => w.slug)
    expect(conEstampa).toEqual(['awp', 'ssg08', 'scar20', 'g3sg1'])
  })

  it('ninguna arma de hierros lleva estampa: el camino de ADS medido al píxel queda intacto', () => {
    const hierros = SOURCE_WEAPONS.filter((w) => w.sight === 'hierros')
    for (const arma of hierros) {
      expect(scopeReticleForWeapon(arma.archetype, arma.sight), arma.slug).toBeNull()
    }
  })

  it('un arma sin fila en el catálogo de Source (CC0) no lleva estampa aunque su arquetipo sea de precisión', () => {
    expect(sightForSlug('assaultrifle-1')).toBeUndefined()
    expect(sightForSlug(null)).toBeUndefined()
    expect(scopeReticleForWeapon('sniper-bolt', undefined)).toBeNull()
  })

  it('sightForSlug lee el catálogo real', () => {
    expect(sightForSlug('awp')).toBe('optica')
    expect(sightForSlug('awp_scopeless')).toBe('hierros')
    expect(sightForSlug('ak47')).toBe('hierros')
  })

  it('sin arma equipada no hay estampa', () => {
    expect(scopeReticleForWeapon(null, 'optica')).toBeNull()
  })

  // Guard de cobertura: que ningún arquetipo NUEVO herede estampa por
  // descuido. Si mañana entra un `sniper-3`, este test obliga a decidir.
  it('sólo dos de los diez arquetipos pueden llevar estampa', () => {
    const conEstampa = (Object.keys(ARCHETYPES) as ArchetypeId[]).filter(
      (id) => scopeReticleForWeapon(id, 'optica') !== null,
    )
    expect(conEstampa).toEqual(['sniper-bolt', 'sniper-marksman'])
  })
})

describe('transición de la estampa', () => {
  it('en cadera no hay nada dibujado', () => {
    expect(scopeAlpha(0)).toBe(0)
  })

  it('a ADS completo la estampa es totalmente opaca', () => {
    expect(scopeAlpha(1)).toBe(1)
  })

  it('no aparece nada hasta fadeStartT: el negro no entra mientras el FOV recién arranca', () => {
    expect(scopeAlpha(SCOPE.fadeStartT)).toBe(0)
    expect(scopeAlpha(SCOPE.fadeStartT - 0.01)).toBe(0)
    expect(scopeAlpha(SCOPE.fadeStartT + 0.01)).toBeGreaterThan(0)
  })

  it('crece de forma monótona: nunca retrocede en medio de la transición', () => {
    let previo = -1
    for (let i = 0; i <= 200; i++) {
      const alpha = scopeAlpha(i / 200)
      expect(alpha).toBeGreaterThanOrEqual(previo)
      previo = alpha
    }
  })

  // Esta es la propiedad que el dueño pidió con "que la transición no sea un
  // salto seco": la curva no puede tener un escalón. Se mide como paso
  // máximo entre muestras densas, no como un número mágico de la curva.
  it('no tiene salto seco: ningún paso de la curva es un escalón', () => {
    const MUESTRAS = 500
    let pasoMaximo = 0
    let previo = scopeAlpha(0)
    for (let i = 1; i <= MUESTRAS; i++) {
      const alpha = scopeAlpha(i / MUESTRAS)
      pasoMaximo = Math.max(pasoMaximo, alpha - previo)
      previo = alpha
    }
    // Un salto seco (escalón) daría un paso de 1 en una sola muestra. Una
    // rampa suave sobre el 45% final da pasos del orden de 1/(0.45*500)*1.5.
    expect(pasoMaximo).toBeLessThan(0.02)
  })

  it('arranca y termina con pendiente nula en los dos extremos: no hay codo al empalmar', () => {
    const h = 1 / 5000
    const arranque = scopeAlpha(SCOPE.fadeStartT + h) - scopeAlpha(SCOPE.fadeStartT)
    const cierre = scopeAlpha(1) - scopeAlpha(1 - h)
    expect(arranque).toBeLessThan(0.0005)
    expect(cierre).toBeLessThan(0.0005)
  })

  it('la lente se acerca al ojo: arranca ampliada y cierra exactamente en 1', () => {
    expect(scopeLensScale(0)).toBeCloseTo(SCOPE.lensZoomIn, 10)
    expect(scopeLensScale(1)).toBe(1)
    // Nunca por debajo de 1: si encogiera, el negro dejaría de cubrir los
    // bordes de la pantalla y se vería el mundo asomando por las esquinas.
    for (let i = 0; i <= 100; i++) {
      expect(scopeLensScale(i / 100)).toBeGreaterThanOrEqual(1)
    }
  })

  it('la mira normal se apaga justo cuando la estampa entra: nunca hay dos puntos de puntería', () => {
    expect(crosshairOpacityUnderScope(0)).toBeCloseTo(SCOPE.crosshairOpacity, 10)
    expect(crosshairOpacityUnderScope(1)).toBe(0)
    for (let i = 0; i <= 100; i++) {
      const alpha = i / 100
      // Suma acotada: la mira sólo puede estar visible en la medida en que
      // la estampa NO lo está.
      expect(crosshairOpacityUnderScope(alpha) + alpha * SCOPE.crosshairOpacity).toBeCloseTo(
        SCOPE.crosshairOpacity,
        10,
      )
    }
  })
})

describe('geometría de la lente', () => {
  it('la lente es un círculo atado al lado menor, en apaisado y en vertical', () => {
    expect(scopeLensRadiusPx(1280, 720)).toBeCloseTo(720 * SCOPE.lensRadiusFraction, 10)
    expect(scopeLensRadiusPx(720, 1280)).toBeCloseTo(720 * SCOPE.lensRadiusFraction, 10)
  })

  it('la lente nunca se sale de la pantalla por ningún lado', () => {
    for (const [w, h] of [
      [1280, 720],
      [3440, 1440],
      [800, 1200],
      [1024, 1024],
    ]) {
      const r = scopeLensRadiusPx(w, h)
      // Con lensZoomIn aplicado (el peor caso de la transición) el diámetro
      // sigue cabiendo en el lado menor.
      expect(2 * r * SCOPE.lensZoomIn).toBeLessThanOrEqual(Math.min(w, h))
    }
  })

  it('los mildots se reparten dentro de la lente y en orden', () => {
    const r = scopeLensRadiusPx(1280, 720)
    let previo = 0
    for (let i = 0; i < SCOPE.mildotsPerArm; i++) {
      const offset = mildotOffsetPx(i, r)
      expect(offset).toBeGreaterThan(previo)
      expect(offset).toBeLessThan(r)
      previo = offset
    }
  })

  it('el hueco central del duplex queda por dentro del arranque del poste grueso', () => {
    expect(SCOPE.duplexCenterGapFraction).toBeLessThan(SCOPE.duplexThickInnerFraction)
    expect(SCOPE.duplexThickInnerFraction).toBeLessThan(1)
  })
})
