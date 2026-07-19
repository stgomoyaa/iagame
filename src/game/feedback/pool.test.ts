import { describe, expect, it } from 'vitest'
import { createRingPool, nextPoolSlot } from '@/game/feedback/pool'

interface Slot {
  id: number
  active: boolean
}

describe('pool de anillo', () => {
  it('preasigna exactamente `capacity` elementos y nunca crece', () => {
    const pool = createRingPool<Slot>(4, (i) => ({ id: i, active: false }))
    expect(pool.items.length).toBe(4)

    for (let i = 0; i < 50; i++) {
      const slot = nextPoolSlot(pool)
      slot.active = true
    }
    expect(pool.items.length).toBe(4)
  })

  it('recicla el slot más viejo cuando se agota la capacidad, en vez de perder el nuevo efecto', () => {
    const pool = createRingPool<Slot>(3, (i) => ({ id: i, active: false }))
    const primero = nextPoolSlot(pool)
    nextPoolSlot(pool)
    nextPoolSlot(pool)
    // El cuarto pedido (pool lleno) tiene que ser la MISMA identidad de
    // objeto que el primero: se reutiliza el slot, no se crea uno nuevo.
    const cuarto = nextPoolSlot(pool)
    expect(cuarto).toBe(primero)
  })

  it('el orden de reciclado es un anillo estable (round-robin), no aleatorio', () => {
    const pool = createRingPool<Slot>(3, (i) => ({ id: i, active: false }))
    const orden: number[] = []
    for (let i = 0; i < 9; i++) orden.push(nextPoolSlot(pool).id)
    expect(orden).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2])
  })

  it('nextPoolSlot no asigna: miles de llamadas no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const pool = createRingPool<Slot>(8, (i) => ({ id: i, active: false }))
    for (let i = 0; i < 2000; i++) nextPoolSlot(pool).active = true

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 200_000; i++) {
      const slot = nextPoolSlot(pool)
      slot.active = true
      slot.id = i
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
