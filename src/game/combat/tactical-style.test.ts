/**
 * El eje táctico CS/COD (el pedido del dueño). Verifica las tres piezas del
 * eje y, sobre todo, las tres cosas que NO se pueden romper:
 *   1. La banda de TTK 300-400 ms se respeta en TODA variante de estilo.
 *   2. Las armas de CS con óptica conservan su ADS (sólo los hierros lo pierden).
 *   3. El estilo no toca el patrón de retroceso (se comparte por referencia).
 *
 * La dispersión efectiva de cada estilo en las tres condiciones (parado+tap,
 * parado+ráfaga, moviéndose) es el número medible que pidió el dueño: se afirma
 * como propiedades acá y se tabula en el entregable.
 */
import { describe, expect, it } from 'vitest'
import {
  archetypeForStyle,
  ARCHETYPE_LIST,
  ARCHETYPES,
  ttkMs,
  type ArchetypeId,
  type TacticalStyle,
} from '@/game/weapons/archetypes'
import { tacticalStyleForSlug, weaponAllowsAds } from '@/game/weapons/source-catalog'
import {
  createSpreadState,
  growSpread,
  movementSpread,
  MOVEMENT_SPREAD_REFERENCE_SPEED,
} from '@/game/combat/spread'

const HEALTH = 100
const ONE_SHOT: ArchetypeId[] = ['sniper-bolt', 'shotgun']
const MULTI_SHOT = ARCHETYPE_LIST.filter((a) => !ONE_SHOT.includes(a.id)).map((a) => a.id)

describe('tacticalStyleForSlug: el estilo sale de la procedencia, no del arquetipo', () => {
  it('un arma del pack CS es estilo cs', () => {
    expect(tacticalStyleForSlug('ak47')).toBe('cs') // AK-47 (CS)
    expect(tacticalStyleForSlug('awp')).toBe('cs')
  })
  it('un arma del pack COD es estilo cod', () => {
    expect(tacticalStyleForSlug('cod4_ak47')).toBe('cod') // AK-47 (COD)
    expect(tacticalStyleForSlug('mw3e_m4a1')).toBe('cod')
  })
  it('una CC0 o un slug desconocido es neutral (punto medio, sin bando)', () => {
    expect(tacticalStyleForSlug('AssaultRifle_2')).toBe('neutral')
    expect(tacticalStyleForSlug('cualquier_cosa')).toBe('neutral')
    expect(tacticalStyleForSlug(null)).toBe('neutral')
  })
  it('el mismo arma homónima cae en bandos distintos según su pack', () => {
    // ak47 (CS) y cod4_ak47 (COD): mismo nombre real, estilos opuestos.
    expect(tacticalStyleForSlug('ak47')).not.toBe(tacticalStyleForSlug('cod4_ak47'))
  })
})

describe('weaponAllowsAds: sin ADS sólo para los hierros de CS', () => {
  it('CS de hierros NO apunta (fusil/subfusil/pistola de mira metálica)', () => {
    for (const slug of ['ak47', 'm4a4', 'mp7', 'deagle', 'aug_scopeless']) {
      expect(weaponAllowsAds(slug), slug).toBe(false)
    }
  })
  it('CS con ÓPTICA SÍ conserva su mira: es la línea que no se puede borrar', () => {
    // El AWP, SSG08, SCAR-20 y G3SG1: sin esto se rompe la mira del sniper.
    for (const slug of ['awp', 'ssg08', 'scar20', 'g3sg1', 'aug', 'sg553']) {
      expect(weaponAllowsAds(slug), slug).toBe(true)
    }
  })
  it('COD apunta normal, sea hierros u óptica', () => {
    for (const slug of ['cod4_ak47', 'mw3e_mp7', 'cod4_m40a3', 'mw3e_deagle']) {
      expect(weaponAllowsAds(slug), slug).toBe(true)
    }
  })
  it('CC0 / desconocido apunta normal (sin procedencia no se le quita el ADS)', () => {
    expect(weaponAllowsAds('AssaultRifle_2')).toBe(true)
    expect(weaponAllowsAds(null)).toBe(true)
  })
})

describe('daño por bala del eje, con el gate de banda de TTK', () => {
  it('CS nunca pega menos que base; COD nunca pega más que base', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      const base = ARCHETYPES[id].damage.base
      expect(archetypeForStyle(id, 'cs').damage.base, `cs ${id}`).toBeGreaterThanOrEqual(base)
      expect(archetypeForStyle(id, 'cod').damage.base, `cod ${id}`).toBeLessThanOrEqual(base)
    }
  })

  // La regla que el dueño pidió no romper en silencio: la banda 300-400 ms se
  // respeta en TODA variante de estilo, no sólo en la base.
  it('TODA variante multishot (cs/cod/neutral) mata dentro de 300-400 ms a rango óptimo', () => {
    for (const style of ['cs', 'cod', 'neutral'] as TacticalStyle[]) {
      for (const id of MULTI_SHOT) {
        const ttk = ttkMs(archetypeForStyle(id, style), HEALTH)
        expect(ttk, `${style} ${id}: ttk=${ttk}`).toBeGreaterThanOrEqual(300)
        expect(ttk, `${style} ${id}: ttk=${ttk}`).toBeLessThanOrEqual(400)
      }
    }
  })

  it('las de un solo tiro (cerrojo, escopeta) no reciben tilt: se quedan en daño base', () => {
    for (const id of ONE_SHOT) {
      const base = ARCHETYPES[id].damage.base
      expect(archetypeForStyle(id, 'cs').damage.base).toBe(base)
      expect(archetypeForStyle(id, 'cod').damage.base).toBe(base)
    }
  })

  it('el tilt de verdad se aplica en algún arquetipo (si no, el gate lo comió entero)', () => {
    const csSubió = MULTI_SHOT.some(
      (id) => archetypeForStyle(id, 'cs').damage.base > ARCHETYPES[id].damage.base,
    )
    const codBajó = MULTI_SHOT.some(
      (id) => archetypeForStyle(id, 'cod').damage.base < ARCHETYPES[id].damage.base,
    )
    expect(csSubió, 'ningún arma CS recibió más daño').toBe(true)
    expect(codBajó, 'ningún arma COD recibió menos daño').toBe(true)
  })
})

describe('el estilo NO toca el patrón de retroceso real', () => {
  it('cs/cod comparten la misma referencia de patrón que el arquetipo base', () => {
    for (const id of Object.keys(ARCHETYPES) as ArchetypeId[]) {
      // Misma referencia de array: el patrón (donde viven los 30 reales de CS)
      // no se clona ni se toca al resolver el estilo.
      expect(archetypeForStyle(id, 'cs').recoil.pattern).toBe(ARCHETYPES[id].recoil.pattern)
      expect(archetypeForStyle(id, 'cod').recoil.pattern).toBe(ARCHETYPES[id].recoil.pattern)
    }
  })
})

describe('dispersión por movimiento: el corazón del eje', () => {
  it('parado (velocidad 0) no hay penalización, sea cual sea el estilo', () => {
    for (const style of ['cs', 'cod', 'neutral'] as TacticalStyle[]) {
      const curve = archetypeForStyle('ar-1', style).recoil.spread
      expect(movementSpread(curve, 0)).toBe(0)
    }
  })

  it('a la velocidad de referencia la penalización es exactamente movementPenalty', () => {
    const curve = archetypeForStyle('ar-1', 'cs').recoil.spread
    expect(movementSpread(curve, MOVEMENT_SPREAD_REFERENCE_SPEED)).toBeCloseTo(
      curve.movementPenalty,
      12,
    )
  })

  it('satura: correr/bhopear no penaliza MÁS que caminar', () => {
    const curve = archetypeForStyle('ar-1', 'cs').recoil.spread
    const aReferencia = movementSpread(curve, MOVEMENT_SPREAD_REFERENCE_SPEED)
    expect(movementSpread(curve, MOVEMENT_SPREAD_REFERENCE_SPEED * 3)).toBe(aReferencia)
  })

  it('rampa lineal entre 0 y la referencia (mitad de velocidad = mitad de penalización)', () => {
    const curve = archetypeForStyle('ar-1', 'neutral').recoil.spread
    expect(movementSpread(curve, MOVEMENT_SPREAD_REFERENCE_SPEED / 2)).toBeCloseTo(
      curve.movementPenalty / 2,
      12,
    )
  })

  // El eje existe: moviéndose, CS se dispara y COD casi no se mueve.
  it('moviéndose, la dispersión de CS es mucho mayor que la de COD (para el MISMO arquetipo)', () => {
    const v = MOVEMENT_SPREAD_REFERENCE_SPEED
    const csMov = movementSpread(archetypeForStyle('ar-1', 'cs').recoil.spread, v)
    const codMov = movementSpread(archetypeForStyle('ar-1', 'cod').recoil.spread, v)
    const neuMov = movementSpread(archetypeForStyle('ar-1', 'neutral').recoil.spread, v)
    expect(csMov).toBeGreaterThan(neuMov)
    expect(neuMov).toBeGreaterThan(codMov)
    // No es un pelo: CS moviéndose dispersa varias veces más que COD.
    expect(csMov / codMov).toBeGreaterThan(4)
  })

  it('parado, los tres estilos disparan con la MISMA precisión (el eje vive en el movimiento)', () => {
    // base (tap) y max (ráfaga) no dependen del estilo: sólo la penalización de
    // movimiento sí. Si esto fallara, el estilo habría empezado a inventar una
    // diferencia parado que el spec no pide.
    for (const style of ['cs', 'cod'] as TacticalStyle[]) {
      const curve = archetypeForStyle('ar-1', style).recoil.spread
      expect(curve.base).toBe(ARCHETYPES['ar-1'].recoil.spread.base)
      expect(curve.max).toBe(ARCHETYPES['ar-1'].recoil.spread.max)
    }
  })

  it('las tres condiciones ordenan como se espera para CS: tap < ráfaga, y moverse supera la ráfaga', () => {
    const cs = archetypeForStyle('ar-1', 'cs').recoil.spread
    const state = createSpreadState(cs, 1)
    const tap = state.radius // parado, primer tiro
    for (let i = 0; i < 200; i++) growSpread(state, cs)
    const rafaga = state.radius // parado, fuego sostenido -> max
    const moviendo = cs.base + movementSpread(cs, MOVEMENT_SPREAD_REFERENCE_SPEED)
    expect(tap).toBeLessThan(rafaga)
    expect(rafaga).toBe(cs.max)
    // En CS, moverse ensucia el tiro MÁS que quedarse quieto sprayando.
    expect(moviendo).toBeGreaterThan(rafaga)
  })

  it('en COD, en cambio, moverse (con tiros controlados) NO supera la ráfaga parado', () => {
    const cod = archetypeForStyle('ar-1', 'cod').recoil.spread
    const moviendo = cod.base + movementSpread(cod, MOVEMENT_SPREAD_REFERENCE_SPEED)
    expect(moviendo).toBeLessThan(cod.max)
  })
})
