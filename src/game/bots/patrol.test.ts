import { describe, expect, it } from 'vitest'
import { buildPatrolGraph, nearestPatrolNode, pickPatrolNode } from '@/game/bots/patrol'
import { buildNavGrid } from '@/game/bots/navgrid'
import { BOTS } from '@/game/bots/tuning'
import { ARENA } from '@/game/map/arena'

function arenaGraph() {
  const grid = buildNavGrid(ARENA, 1, 1.8)
  return { grid, graph: buildPatrolGraph(grid, BOTS.patrolNodeSpacingM) }
}

describe('red de patrulla horneada del navgrid', () => {
  it('genera varios nodos, todos sobre celdas caminables y sin repetir celda', () => {
    const { grid, graph } = arenaGraph()

    expect(graph.count).toBeGreaterThan(8)
    const vistas = new Set<number>()
    for (let i = 0; i < graph.count; i++) {
      expect(grid.walkable[graph.cell[i]]).toBe(1)
      expect(vistas.has(graph.cell[i])).toBe(false)
      vistas.add(graph.cell[i])
    }
  })

  it('los nodos cubren los cuatro cuadrantes del mapa: patrullar no es dar vueltas por una esquina', () => {
    const { graph } = arenaGraph()
    let noroeste = 0
    let noreste = 0
    let suroeste = 0
    let sureste = 0

    for (let i = 0; i < graph.count; i++) {
      const oeste = graph.x[i] < graph.centerX
      const norte = graph.z[i] < graph.centerZ
      if (oeste && norte) noroeste++
      else if (!oeste && norte) noreste++
      else if (oeste) suroeste++
      else sureste++
    }

    expect(noroeste).toBeGreaterThan(0)
    expect(noreste).toBeGreaterThan(0)
    expect(suroeste).toBeGreaterThan(0)
    expect(sureste).toBeGreaterThan(0)
  })

  it('el centro del grafo cae cerca del centro real del mapa', () => {
    const { graph } = arenaGraph()
    expect(Math.hypot(graph.centerX, graph.centerZ)).toBeLessThan(BOTS.navCellSize * 2)
  })

  it('un grid sin ninguna celda caminable no revienta: devuelve una red vacía', () => {
    const grid = buildNavGrid(
      { name: 'vacio', boxes: [], spawns: [], bounds: { min: { x: -5, y: 0, z: -5 }, max: { x: 5, y: 4, z: 5 } } },
      1,
      1.8,
    )
    const graph = buildPatrolGraph(grid, 2)
    expect(graph.count).toBe(0)
    expect(pickPatrolNode(graph, 0, 0, -1, 1)).toBe(-1)
  })
})

describe('elección de destino de patrulla', () => {
  it('nunca devuelve el nodo excluido (el recién visitado): la patrulla avanza, no rebota', () => {
    const { graph } = arenaGraph()
    for (let nodo = 0; nodo < graph.count; nodo++) {
      const elegido = pickPatrolNode(graph, graph.x[nodo], graph.z[nodo], nodo, 7)
      expect(elegido).not.toBe(nodo)
      expect(elegido).toBeGreaterThanOrEqual(0)
    }
  })

  it('elige un destino lejano: nunca uno a menos de patrolMinTravelM habiendo lejanos', () => {
    const { graph } = arenaGraph()
    for (let nodo = 0; nodo < graph.count; nodo++) {
      const elegido = pickPatrolNode(graph, graph.x[nodo], graph.z[nodo], nodo, 3)
      const distancia = Math.hypot(graph.x[elegido] - graph.x[nodo], graph.z[elegido] - graph.z[nodo])
      expect(distancia).toBeGreaterThanOrEqual(BOTS.patrolMinTravelM)
    }
  })

  it('el sesgo al centro pesa: los destinos elegidos quedan más cerca del centro que la esquina más lejana', () => {
    const { graph } = arenaGraph()
    // Distancia al centro del nodo MÁS lejano del centro (la peor esquina):
    // sin sesgo, "lo más lejos posible" elegiría siempre una de ésas.
    let peor = 0
    for (let i = 0; i < graph.count; i++) {
      const d = Math.hypot(graph.x[i] - graph.centerX, graph.z[i] - graph.centerZ)
      if (d > peor) peor = d
    }

    let suma = 0
    for (let bot = 0; bot < 8; bot++) {
      const desde = graph.count - 1 - bot
      const elegido = pickPatrolNode(graph, graph.x[desde], graph.z[desde], desde, bot)
      suma += Math.hypot(graph.x[elegido] - graph.centerX, graph.z[elegido] - graph.centerZ)
    }

    expect(suma / 8).toBeLessThan(peor * 0.8)
  })

  it('bots distintos en el mismo punto no eligen todos el mismo destino (jitter determinista por bot)', () => {
    const { graph } = arenaGraph()
    const elegidos = new Set<number>()
    for (let bot = 0; bot < 8; bot++) elegidos.add(pickPatrolNode(graph, -25, -25, -1, bot))
    expect(elegidos.size).toBeGreaterThan(1)
  })

  it('la elección es determinista: mismos argumentos, mismo nodo', () => {
    const { graph } = arenaGraph()
    for (let bot = 0; bot < 5; bot++) {
      expect(pickPatrolNode(graph, 12, -8, 2, bot)).toBe(pickPatrolNode(graph, 12, -8, 2, bot))
    }
  })

  it('nearestPatrolNode devuelve el nodo bajo los pies', () => {
    const { graph } = arenaGraph()
    for (let i = 0; i < graph.count; i++) {
      expect(nearestPatrolNode(graph, graph.x[i], graph.z[i])).toBe(i)
    }
  })
})
