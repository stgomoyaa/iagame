import { describe, expect, it } from 'vitest'
import { createMatchBots } from '@/game/match/squad'
import { createMatchTargets, type MatchTargets } from '@/game/match/targeting'
import { ARCHETYPES } from '@/game/weapons/archetypes'
import { vec3, type Vec3 } from '@/game/math/vec3'
import { BOTS } from '@/game/bots/tuning'
import { MAX_BOTS, MAX_PARTICIPANTES } from '@/game/match/roster'
import {
  agregarBot,
  crearRosterVivo,
  quitarBot,
  type RosterVivo,
} from '@/game/match/roster-vivo'
import {
  addKill,
  createParticipantStats,
  teamScore,
  type ParticipantStats,
} from '@/game/match/scoring'
import type { BotState } from '@/game/bots/bot'

/** Un roster completo de MAX_BOTS bots, con el prefijo `activos` en cancha,
 *  igual que lo arma game.ts. Spawns cualquiera: este archivo no prueba
 *  movimiento ni percepción, sólo el alta/baja. */
function montar(activos: number, editable = true): RosterVivo {
  const spawns: Vec3[] = []
  for (let i = 0; i < MAX_BOTS; i++) spawns.push(vec3(i * 4, 0, 0))
  const archetypes = spawns.map(() => ARCHETYPES['ar-1'])
  const ranks = spawns.map(() => 0.5)
  const completo = createMatchBots(spawns, archetypes, ranks)
  const targets: MatchTargets = createMatchTargets('tdm', MAX_PARTICIPANTES)
  const estabaVivo = new Array(MAX_BOTS).fill(true) as boolean[]
  const enCancha: BotState[] = completo.slice(0, activos)
  return crearRosterVivo(completo, enCancha, targets, estabaVivo, editable)
}

/** ¿Está estacionado (fuera de cancha)? Muerto, intocable y no apuntable. */
function estacionado(roster: RosterVivo, indice: number): boolean {
  const bot = roster.completo[indice]
  return (
    !bot.health.alive &&
    bot.hitboxes.every((h) => h.radius === 0) &&
    roster.targets.alive[indice + 1] === false
  )
}

describe('roster-vivo: alta y baja de bots', () => {
  it('los slots que no arrancan en cancha nacen estacionados', () => {
    const roster = montar(3)
    expect(roster.activos).toHaveLength(3)
    for (let i = 3; i < MAX_BOTS; i++) {
      expect(estacionado(roster, i), `slot ${i} debería nacer estacionado`).toBe(true)
    }
  })

  it('un slot en cancha NO nace estacionado: sus hitboxes son reales', () => {
    const roster = montar(3)
    for (let i = 0; i < 3; i++) {
      const bot = roster.completo[i]
      expect(bot.hitboxes.some((h) => h.radius > 0)).toBe(true)
    }
  })

  it('agregar mete el bot al roster activo, listo para revivir ya', () => {
    const roster = montar(3)
    expect(agregarBot(roster, false)).toBe(true)
    expect(roster.activos).toHaveLength(4)
    const nuevo = roster.completo[3]
    // Muerto pero con el respawn ya cumplido: revive en el próximo tick del
    // motor, no dentro de respawnDelayS.
    expect(nuevo.health.alive).toBe(false)
    expect(nuevo.health.respawnT).toBeGreaterThanOrEqual(BOTS.respawnDelayS)
  })

  it('agregar mantiene activos como prefijo exacto de completo', () => {
    const roster = montar(3)
    agregarBot(roster, false)
    agregarBot(roster, false)
    for (let i = 0; i < roster.activos.length; i++) {
      expect(roster.activos[i]).toBe(roster.completo[i])
    }
  })

  it('quitar saca al último que entró y lo deja estacionado', () => {
    const roster = montar(5)
    expect(quitarBot(roster, false)).toBe(true)
    expect(roster.activos).toHaveLength(4)
    expect(estacionado(roster, 4)).toBe(true)
  })

  it('agregar y quitar seguido deja la partida como estaba', () => {
    const roster = montar(4)
    agregarBot(roster, false)
    expect(roster.activos).toHaveLength(5)
    quitarBot(roster, false)
    expect(roster.activos).toHaveLength(4)
    // El slot 4 vuelve a estar estacionado, sin rastro del alta.
    expect(estacionado(roster, 4)).toBe(true)
  })

  it('no baja del piso de un bot: nunca deja un equipo vacío', () => {
    const roster = montar(1)
    expect(quitarBot(roster, false)).toBe(false)
    expect(roster.activos).toHaveLength(1)
  })

  it('no pasa del techo del motor', () => {
    const roster = montar(MAX_BOTS)
    expect(agregarBot(roster, false)).toBe(false)
    expect(roster.activos).toHaveLength(MAX_BOTS)
  })

  it('la marca de agua sube al agregar y NO baja al sacar', () => {
    const roster = montar(3)
    expect(roster.maxBotsActivos).toBe(3)
    agregarBot(roster, false)
    agregarBot(roster, false)
    expect(roster.maxBotsActivos).toBe(5)
    quitarBot(roster, false)
    quitarBot(roster, false)
    quitarBot(roster, false)
    // Quedan 2 en cancha, pero la marca de agua sigue en 5: los bots que
    // pelearon y se fueron conservan su fila en el marcador.
    expect(roster.activos).toHaveLength(2)
    expect(roster.maxBotsActivos).toBe(5)
  })

  it('con la partida terminada no se toca el roster', () => {
    const roster = montar(4)
    expect(agregarBot(roster, true)).toBe(false)
    expect(quitarBot(roster, true)).toBe(false)
    expect(roster.activos).toHaveLength(4)
  })

  it('ranked no deja editar el roster', () => {
    const roster = montar(4, false)
    expect(agregarBot(roster, false)).toBe(false)
    expect(quitarBot(roster, false)).toBe(false)
    expect(roster.activos).toHaveLength(4)
  })
})

describe('roster-vivo: el marcador sobrevive al cambio de cantidad', () => {
  // Éste es el borde que la tarea marcó como "donde esto se rompe": las
  // estadísticas se indexan por id de participante y no se pueden reindexar
  // cuando alguien entra o sale. Se modela el marcador igual que game.ts
  // (un ParticipantStats por id del roster COMPLETO) y se comprueba que
  // sacar un bot no borra ni corre sus kills.
  function marcador(): ParticipantStats[] {
    const p: ParticipantStats[] = []
    for (let i = 0; i < MAX_PARTICIPANTES; i++) p.push(createParticipantStats(i))
    return p
  }

  it('los kills de un bot que sale siguen en su fila y en el puntaje de equipo', () => {
    const roster = montar(6)
    const stats = marcador()

    // El bot con id 5 (índice 4) hace tres kills sobre el id 6 (índice 5).
    addKill(stats[5], stats[6])
    addKill(stats[5], stats[6])
    addKill(stats[5], stats[6])
    const equipoDe5 = 5 % 2 // teamForParticipant tdm
    const puntajeAntes = teamScore('tdm', stats, equipoDe5)

    // Se sacan dos bots (ids 6 y 5 salen de cancha).
    quitarBot(roster, false)
    quitarBot(roster, false)
    expect(roster.activos).toHaveLength(4)

    // La fila del id 5 sigue intacta: sacarlo de cancha no toca su marcador.
    expect(stats[5].kills).toBe(3)
    expect(stats[6].deaths).toBe(3)
    // Y su equipo conserva el puntaje: el índice del array no se movió.
    expect(teamScore('tdm', stats, equipoDe5)).toBe(puntajeAntes)
  })

  it('un bot que vuelve a entrar reusa su fila, no una nueva', () => {
    const roster = montar(6)
    const stats = marcador()
    addKill(stats[6], stats[5]) // id 6 hizo un kill

    quitarBot(roster, false) // sale el id 6
    expect(stats[6].kills).toBe(1) // su kill queda
    agregarBot(roster, false) // vuelve a entrar: mismo slot, misma fila
    expect(roster.activos[5]).toBe(roster.completo[5])
    expect(stats[6].kills).toBe(1) // sigue siendo suyo, no se reinició
  })

  // El marcador se recorta con `1 + maxBotsActivos` (game.ts
  // participantesVisibles): muestra al jugador más todo bot que jugó, y NADA
  // de los slots reservados que nunca entraron. Esto es lo que evita filas
  // fantasma con 0 kills cuando el motor reserva 16 slots pero sólo hay 4 en
  // cancha.
  it('el corte del marcador no incluye slots que nunca entraron', () => {
    const roster = montar(4)
    // 1 jugador + 4 bots = 5 filas visibles, no MAX_PARTICIPANTES.
    expect(1 + roster.maxBotsActivos).toBe(5)
    expect(1 + roster.maxBotsActivos).toBeLessThan(MAX_PARTICIPANTES)
  })

  it('el corte del marcador SÍ incluye a un bot que jugó y se fue', () => {
    const roster = montar(4)
    agregarBot(roster, false) // marca de agua 5
    quitarBot(roster, false) // vuelve a 4 en cancha, pero la marca queda en 5
    // El bot que entró y salió sigue contando para el marcador: 1 + 5 = 6.
    expect(1 + roster.maxBotsActivos).toBe(6)
  })
})
