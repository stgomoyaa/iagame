import { describe, expect, it } from 'vitest'
import { ARENA } from '@/game/map/arena'
import { BUNKER } from '@/game/map/bunker'
import { TORRE } from '@/game/map/torre'
import { MAPS } from '@/game/map/registry'
import { MATCH } from '@/game/match/tuning'
import { MAX_PARTICIPANTES } from '@/game/match/roster'
import {
  AREA_NAVEGABLE_ARENA_M2,
  AREA_POR_JUGADOR_M2,
  areaNavegableM2,
  densidadImplicitaDeLaArena,
  jugadoresQueSostiene,
  medirMapa,
  tamanoPorJugadores,
} from '@/game/match/tamano-mapa'

describe('tamaño de mapa medido', () => {
  it('mide la arena en el área con la que se calibró la densidad', () => {
    // Si este número se mueve, AREA_POR_JUGADOR_M2 quedó apoyado en una
    // medición que ya no existe. Tolerancia de una celda o dos del navgrid,
    // no de un cambio real de geometría.
    expect(areaNavegableM2(ARENA)).toBeCloseTo(AREA_NAVEGABLE_ARENA_M2, -1)
  })

  it('la densidad por jugador sigue siendo la que implica MATCH.botCount', () => {
    // Ata AREA_POR_JUGADOR_M2 a la única calibración jugada que hay en el
    // repo: si alguien retunea botCount, esto falla y obliga a despejar el
    // número de nuevo en vez de dejarlo apoyado en un valor viejo.
    expect(densidadImplicitaDeLaArena()).toBeCloseTo(AREA_POR_JUGADOR_M2, 0)
  })

  it('ordena los mapas de código por tamaño real', () => {
    // bunker (40x40) < torre (48x48) < arena (60x60). No se afirman valores
    // absolutos de torre y bunker: lo que importa es que la medición
    // distinga tamaños, no que memorice números.
    const bunker = areaNavegableM2(BUNKER)
    const torre = areaNavegableM2(TORRE)
    const arena = areaNavegableM2(ARENA)
    expect(bunker).toBeLessThan(torre)
    expect(torre).toBeLessThan(arena)
  })

  it('mide sólo lo alcanzable desde los spawns, no toda celda caminable', () => {
    // El área navegable nunca puede superar la huella del mapa. Es la
    // afirmación que caería si se sacara el filtro por componente conexa en
    // un mapa con techos (ver la cabecera del módulo).
    for (const def of MAPS) {
      const huella =
        (def.bounds.max.x - def.bounds.min.x) * (def.bounds.max.z - def.bounds.min.z)
      expect(areaNavegableM2(def), def.name).toBeLessThanOrEqual(huella)
    }
  })

  it('sugiere un número par de jugadores dentro de lo que el motor sostiene', () => {
    for (const def of MAPS) {
      const m = medirMapa(def)
      expect(m.jugadoresSugeridos % 2, `${def.name} sugiere impar`).toBe(0)
      expect(m.jugadoresSugeridos).toBeGreaterThanOrEqual(2)
      expect(m.jugadoresSugeridos).toBeLessThanOrEqual(MAX_PARTICIPANTES)
      expect(m.porEquipoSugerido * 2).toBe(m.jugadoresSugeridos)
    }
  })

  it('la arena sugiere alrededor del roster que el repo ya tenía tuneado', () => {
    // MATCH.botCount + 1 participantes es lo que este repo verificó jugando
    // en la arena. La medición tiene que caer ahí al lado, o la densidad no
    // está diciendo lo que dice que dice.
    const m = medirMapa(ARENA)
    expect(Math.abs(m.jugadoresSugeridos - (MATCH.botCount + 1))).toBeLessThanOrEqual(1)
  })

  it('un mapa más chico sugiere menos gente que uno más grande', () => {
    expect(medirMapa(BUNKER).jugadoresSugeridos).toBeLessThan(
      medirMapa(ARENA).jugadoresSugeridos,
    )
  })

  it('las etiquetas de tamaño siguen los cortes de los presets', () => {
    expect(tamanoPorJugadores(4)).toBe('pequeno') // 2v2
    expect(tamanoPorJugadores(6)).toBe('pequeno') // 3v3
    expect(tamanoPorJugadores(8)).toBe('mediano')
    expect(tamanoPorJugadores(10)).toBe('mediano')
    expect(tamanoPorJugadores(12)).toBe('grande') // 6v6
    expect(tamanoPorJugadores(16)).toBe('grande')
  })

  it('un área degenerada no rompe la sugerencia', () => {
    expect(jugadoresQueSostiene(0)).toBe(2)
    expect(jugadoresQueSostiene(-100)).toBe(2)
    expect(jugadoresQueSostiene(Number.NaN)).toBe(2)
    expect(jugadoresQueSostiene(1e9)).toBe(MAX_PARTICIPANTES)
  })
})
