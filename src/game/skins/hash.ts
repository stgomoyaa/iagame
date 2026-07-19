/**
 * Hash y PRNG del generador de skins (sección 7 del spec: `seed -> hash ->
 * parámetros`).
 *
 * Dos piezas separadas a propósito:
 *
 * - `hashSeed` convierte el string de la seed en un entero de 32 bits. Es
 *   xmur3: mezcla cada carácter, así que dos seeds parecidas ("drop-1" y
 *   "drop-2") caen en puntos lejanos del espacio y no producen skins casi
 *   iguales. Un hash más simple (sumar códigos de carácter) tiene el
 *   problema contrario y se nota enseguida cuando las seeds son
 *   correlativas, que es justo cómo las genera un drop por partida.
 * - `createSkinRandom` es mulberry32, el mismo PRNG que ya usan
 *   combat/spread.ts, bots/aim.ts y weapons/archetypes.ts. No se usa
 *   Math.random() en ninguna parte: una skin guardada en localStorage tiene
 *   que verse igual después de recargar (sección 7 y sección 13 del spec),
 *   y eso exige que todo el generador sea una función pura de la seed.
 */

/** Hash de string a entero de 32 bits sin signo. xmur3. */
export function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  h = Math.imul(h ^ (h >>> 13), 3266489909)
  return (h ^= h >>> 16) >>> 0
}

/** Stream determinista de números en [0, 1). mulberry32. */
export function createSkinRandom(state: number): () => number {
  let s = state >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Elige un elemento de una lista con el próximo número del stream. */
export function pick<T>(rand: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pick: lista vacía')
  const index = Math.min(items.length - 1, Math.floor(rand() * items.length))
  return items[index]
}

/** Número en [min, max) con el próximo valor del stream. */
export function range(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min)
}
