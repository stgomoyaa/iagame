import { describe, expect, it } from 'vitest'
import { buildArenaGeometry } from '@/game/map/mesh'
import { ARENA } from '@/game/map/arena'

describe('geometría de la arena', () => {
  it('fusiona todas las cajas en una sola geometría', () => {
    const geo = buildArenaGeometry(ARENA)
    const posiciones = geo.getAttribute('position')
    // 6 caras por caja, 2 triángulos por cara, 3 vértices por triángulo
    expect(posiciones.count).toBe(ARENA.boxes.length * 36)
  })

  it('incluye colores de vértice para legibilidad sin luces', () => {
    const geo = buildArenaGeometry(ARENA)
    expect(geo.getAttribute('color')).toBeDefined()
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count)
  })

  it('se mantiene bajo el presupuesto de triángulos', () => {
    const geo = buildArenaGeometry(ARENA)
    const triangulos = geo.getAttribute('position').count / 3
    expect(triangulos).toBeLessThan(150_000)
  })

  it('incluye normales para el sombreado', () => {
    const geo = buildArenaGeometry(ARENA)
    expect(geo.getAttribute('normal')).toBeDefined()
  })
})
