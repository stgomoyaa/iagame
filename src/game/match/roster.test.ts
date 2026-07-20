import { describe, expect, it } from 'vitest'
import {
  acotarBots,
  equipoDelProximoBot,
  idDelBotASacar,
  MAX_BOTS,
  MAX_PARTICIPANTES,
  MIN_BOTS,
  puedeAgregar,
  puedeQuitar,
  tamanoDeEquipo,
} from '@/game/match/roster'
import { BOT_NAMES } from '@/ui/bot-names'
import { participantLabel } from '@/ui/participant-label'
import { teamForParticipant } from '@/game/match/types'

describe('roster de bots en caliente', () => {
  // Ésta es LA propiedad que hace que el resto funcione sin una tabla de
  // equipos: si el prefijo dejara de repartir por paridad, todo lo demás de
  // este archivo dejaría de ser cierto en silencio.
  it('el bot nuevo entra siempre al equipo con menos gente (o empata)', () => {
    for (let bots = MIN_BOTS; bots < MAX_BOTS; bots++) {
      const equipoQueEntra = equipoDelProximoBot('tdm', bots)
      const otro = equipoQueEntra === 0 ? 1 : 0
      const nEntra = tamanoDeEquipo('tdm', bots, equipoQueEntra)
      const nOtro = tamanoDeEquipo('tdm', bots, otro)
      expect(
        nEntra,
        `con ${bots} bots el nuevo entra al equipo ${equipoQueEntra} (${nEntra}) ` +
          `pero el otro tiene ${nOtro}`,
      ).toBeLessThanOrEqual(nOtro)
    }
  })

  it('los equipos nunca se separan por más de uno, agregando de a uno', () => {
    for (let bots = MIN_BOTS; bots <= MAX_BOTS; bots++) {
      const a = tamanoDeEquipo('tdm', bots, 0)
      const b = tamanoDeEquipo('tdm', bots, 1)
      expect(Math.abs(a - b), `con ${bots} bots quedó ${a} contra ${b}`).toBeLessThanOrEqual(1)
    }
  })

  it('ningún equipo queda en cero mientras se respete el piso', () => {
    for (let bots = MIN_BOTS; bots <= MAX_BOTS; bots++) {
      expect(tamanoDeEquipo('tdm', bots, 0)).toBeGreaterThan(0)
      expect(tamanoDeEquipo('tdm', bots, 1)).toBeGreaterThan(0)
    }
  })

  it('sacar quita al último que entró, y nunca al jugador', () => {
    for (let bots = MIN_BOTS + 1; bots <= MAX_BOTS; bots++) {
      const id = idDelBotASacar(bots)
      expect(id).toBe(bots)
      expect(id).toBeGreaterThan(0) // 0 es el jugador (PLAYER_ID)
    }
  })

  it('en el piso no se puede sacar y en el techo no se puede agregar', () => {
    expect(puedeQuitar(MIN_BOTS)).toBe(false)
    expect(idDelBotASacar(MIN_BOTS)).toBe(-1)
    expect(puedeAgregar(MAX_BOTS)).toBe(false)
    expect(puedeAgregar(MIN_BOTS)).toBe(true)
    expect(puedeQuitar(MAX_BOTS)).toBe(true)
  })

  it('acota pedidos fuera de rango y basura sin romper', () => {
    expect(acotarBots(0)).toBe(MIN_BOTS)
    expect(acotarBots(-5)).toBe(MIN_BOTS)
    expect(acotarBots(999)).toBe(MAX_BOTS)
    expect(acotarBots(Number.NaN)).toBe(MIN_BOTS)
    expect(acotarBots(4.7)).toBe(4)
  })

  // El requisito de la tarea era "un bot que entra a mitad de partida tiene
  // que tomar un nombre libre, no repetir uno en uso". Se cumple por
  // construcción -- nombre por id, ids distintos, roster más chico que la
  // lista -- y esto es lo que impide que el tope crezca por encima de la
  // lista de nombres sin que nadie se entere.
  it('el roster completo cabe en la lista de nombres', () => {
    expect(MAX_PARTICIPANTES).toBeLessThanOrEqual(BOT_NAMES.length)
  })

  it('ningún par de participantes del roster completo comparte nombre', () => {
    const vistos = new Set<string>()
    for (let id = 0; id < MAX_PARTICIPANTES; id++) {
      const nombre = participantLabel(id)
      expect(vistos.has(nombre), `"${nombre}" repetido en el id ${id}`).toBe(false)
      vistos.add(nombre)
    }
    expect(vistos.size).toBe(MAX_PARTICIPANTES)
  })

  it('FFA no tiene equipos que equilibrar: cada id es el suyo', () => {
    for (let bots = MIN_BOTS; bots < MAX_BOTS; bots++) {
      expect(equipoDelProximoBot('ffa', bots)).toBe(bots + 1)
      expect(tamanoDeEquipo('ffa', bots, teamForParticipant('ffa', 1))).toBe(1)
    }
  })
})
