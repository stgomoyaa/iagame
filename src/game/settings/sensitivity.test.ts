import { describe, expect, it } from 'vitest'
import {
  cmPer360,
  convert,
  edpi,
  formatForGame,
  sensFromCmPer360,
} from '@/game/settings/sensitivity'
import { GAME_PROFILES, SELECTABLE_PROFILES, findProfile } from '@/game/settings/games'

function profile(id: string) {
  const p = findProfile(id)
  if (!p) throw new Error(`perfil inexistente en el test: ${id}`)
  return p
}

const cs2 = profile('cs2')
const valorant = profile('valorant')
const overwatch = profile('overwatch2')
const apex = profile('apex')
const strike = profile('strike-protocol')

describe('cm/360', () => {
  // Estos dos son los anclajes de todo el módulo. Son valores públicos
  // conocidos: si alguno se rompe, la fórmula está mal, no el test.
  it('CS2 a 1.0 con 800 DPI da los 51.95 cm/360 de referencia', () => {
    expect(cmPer360(1.0, 800, cs2.yaw)).toBeCloseTo(51.95, 1)
  })

  it('Valorant a 0.4 con 800 DPI da los 40.8 cm/360 de referencia', () => {
    expect(cmPer360(0.4, 800, valorant.yaw)).toBeCloseTo(40.8, 1)
  })

  it('más sensibilidad significa menos centímetros', () => {
    expect(cmPer360(2, 800, cs2.yaw)).toBeLessThan(cmPer360(1, 800, cs2.yaw))
  })

  it('más DPI significa menos centímetros', () => {
    expect(cmPer360(1, 1600, cs2.yaw)).toBeLessThan(cmPer360(1, 800, cs2.yaw))
  })

  it('duplicar DPI equivale exactamente a duplicar sensibilidad', () => {
    expect(cmPer360(1, 1600, cs2.yaw)).toBeCloseTo(cmPer360(2, 800, cs2.yaw), 10)
  })

  it('entradas inválidas devuelven Infinity en vez de NaN', () => {
    expect(cmPer360(0, 800, cs2.yaw)).toBe(Number.POSITIVE_INFINITY)
    expect(cmPer360(1, 0, cs2.yaw)).toBe(Number.POSITIVE_INFINITY)
    expect(cmPer360(-1, 800, cs2.yaw)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('sensFromCmPer360', () => {
  it('es la inversa exacta de cmPer360', () => {
    for (const sens of [0.1, 0.4, 1.0, 2.5, 7.3]) {
      const cm = cmPer360(sens, 800, valorant.yaw)
      expect(sensFromCmPer360(cm, 800, valorant.yaw)).toBeCloseTo(sens, 10)
    }
  })

  it('entradas inválidas devuelven cero en vez de NaN', () => {
    expect(sensFromCmPer360(0, 800, cs2.yaw)).toBe(0)
    expect(sensFromCmPer360(50, 0, cs2.yaw)).toBe(0)
  })
})

describe('conversión entre juegos', () => {
  it('la distancia de 360 grados se conserva, que es el punto del conversor', () => {
    const r = convert({ from: cs2, to: valorant, sens: 1.0, dpi: 800 })
    expect(r.cmPer360).toBeCloseTo(r.sourceCmPer360, 6)
  })

  it('CS2 1.0 se convierte al 0.3143 de Valorant, el ratio 3.18 conocido', () => {
    const r = convert({ from: cs2, to: valorant, sens: 1.0, dpi: 800 })
    expect(r.sens).toBeCloseTo(0.3143, 3)
    expect(cs2.yaw / valorant.yaw).toBeCloseTo(1 / 3.1818, 4)
  })

  it('CS2 a Overwatch usa el ratio 3.333 conocido', () => {
    const r = convert({ from: cs2, to: overwatch, sens: 1.0, dpi: 800 })
    expect(r.sens).toBeCloseTo(3.333, 2)
  })

  it('entre juegos de la misma escala la sensibilidad no cambia', () => {
    const r = convert({ from: cs2, to: apex, sens: 2.5, dpi: 800 })
    expect(r.sens).toBeCloseTo(2.5, 10)
  })

  it('convertir a sí mismo es identidad', () => {
    const r = convert({ from: valorant, to: valorant, sens: 0.42, dpi: 1600 })
    expect(r.sens).toBeCloseTo(0.42, 10)
  })

  it('ida y vuelta devuelve el valor original', () => {
    const ida = convert({ from: cs2, to: overwatch, sens: 1.7, dpi: 800 })
    const vuelta = convert({ from: overwatch, to: cs2, sens: ida.sens, dpi: 800 })
    expect(vuelta.sens).toBeCloseTo(1.7, 8)
  })

  it('un cambio de DPI se compensa en la sensibilidad resultante', () => {
    const mismo = convert({ from: cs2, to: valorant, sens: 1.0, dpi: 800 })
    const distinto = convert({ from: cs2, to: valorant, sens: 1.0, dpi: 800, toDpi: 1600 })
    expect(distinto.sens).toBeCloseTo(mismo.sens / 2, 8)
    // Lo que importa: la distancia física sigue siendo la misma.
    expect(distinto.cmPer360).toBeCloseTo(mismo.cmPer360, 6)
  })

  it('marca cuando el valor ideal no entra en el rango del juego destino', () => {
    // Una sensibilidad absurdamente baja en CS pide un valor bajo el mínimo
    // que Valorant acepta.
    const r = convert({ from: cs2, to: valorant, sens: 0.1, dpi: 400 })
    if (r.sens < valorant.range.min) {
      expect(r.outOfRange).toBe(true)
      expect(r.clamped).toBe(valorant.range.min)
    }
  })

  it('cuando no hay recorte, clamped y sens coinciden', () => {
    const r = convert({ from: cs2, to: valorant, sens: 1.0, dpi: 800 })
    expect(r.outOfRange).toBe(false)
    expect(r.clamped).toBeCloseTo(r.sens, 10)
  })
})

describe('eDPI', () => {
  it('es sensibilidad por DPI', () => {
    expect(edpi(0.4, 800)).toBe(320)
  })

  it('el mismo eDPI en juegos de distinta escala NO es la misma sensación', () => {
    // Este es el malentendido más común sobre sensibilidad, y el test existe
    // para dejarlo escrito: 320 de eDPI en Valorant y en CS son distancias
    // de giro completamente distintas.
    const enValorant = cmPer360(0.4, 800, valorant.yaw)
    const enCs = cmPer360(0.4, 800, cs2.yaw)
    expect(enValorant).not.toBeCloseTo(enCs, 1)
  })
})

describe('formato para pegar en el juego', () => {
  it('usa los decimales que muestra cada juego', () => {
    expect(formatForGame(0.31428, valorant)).toBe('0.314')
    expect(formatForGame(3.3333, overwatch)).toBe('3.33')
  })
})

describe('tabla de perfiles', () => {
  it('sólo se ofrecen perfiles verificados', () => {
    for (const p of SELECTABLE_PROFILES) {
      expect(p.verified).toBe(true)
    }
  })

  it('todo perfil verificado tiene un yaw positivo', () => {
    for (const p of SELECTABLE_PROFILES) {
      expect(p.yaw).toBeGreaterThan(0)
    }
  })

  it('todo perfil no verificado queda fuera de la lista seleccionable', () => {
    const noVerificados = GAME_PROFILES.filter((g) => !g.verified)
    expect(noVerificados.length).toBeGreaterThan(0)
    for (const p of noVerificados) {
      expect(SELECTABLE_PROFILES).not.toContain(p)
    }
  })

  it('todo perfil verificado declara por qué se confía en su yaw', () => {
    for (const p of SELECTABLE_PROFILES) {
      expect(p.note.length).toBeGreaterThan(20)
    }
  })

  it('los rangos son coherentes y los ids únicos', () => {
    const ids = new Set<string>()
    for (const p of GAME_PROFILES) {
      expect(p.range.min).toBeLessThan(p.range.max)
      expect(ids.has(p.id)).toBe(false)
      ids.add(p.id)
    }
  })

  it('el juego propio adopta la escala Source para que CS convierta 1:1', () => {
    expect(strike.yaw).toBeCloseTo(cs2.yaw, 10)
    const r = convert({ from: cs2, to: strike, sens: 1.234, dpi: 800 })
    expect(r.sens).toBeCloseTo(1.234, 10)
  })
})
