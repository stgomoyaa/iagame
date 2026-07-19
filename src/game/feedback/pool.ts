/**
 * Pool de anillo genérico: capacidad fija, preasignada una sola vez en
 * createRingPool(). `nextSlot` nunca asigna nada — devuelve el próximo
 * elemento del anillo y avanza el cursor, punto. Si ese slot todavía tenía
 * un efecto activo (el pool está "lleno" en el sentido de que todos sus
 * slots están en uso), lo pisa: el efecto más viejo se corta corto en vez
 * de que un disparo nuevo se pierda o el pool crezca. Esto es "degradar
 * sin asignar", el requisito de la sección 5 del spec ("qué pasa cuando
 * salen más efectos que los que el pool aguanta -- tiene que degradar,
 * nunca asignar ni crashear").
 *
 * No expone iteración con callback (`forEach`) a propósito: los callers
 * que recorren el pool en el camino de frame lo hacen con un `for` plano
 * sobre `pool.items`, sin crear un closure nuevo por llamada.
 */
export interface RingPool<T> {
  readonly items: T[]
  readonly capacity: number
  cursor: number
}

export function createRingPool<T>(capacity: number, factory: (index: number) => T): RingPool<T> {
  const items: T[] = []
  for (let i = 0; i < capacity; i++) items.push(factory(i))
  return { items, capacity, cursor: 0 }
}

/** Devuelve el slot a escribir para un efecto nuevo y avanza el cursor. */
export function nextPoolSlot<T>(pool: RingPool<T>): T {
  const slot = pool.items[pool.cursor]
  pool.cursor = (pool.cursor + 1) % pool.capacity
  return slot
}
