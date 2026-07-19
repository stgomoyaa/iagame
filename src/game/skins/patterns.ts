/**
 * Catálogo de patrones. El patrón se evalúa en el shader (material.ts) a
 * partir de la posición en espacio de objeto: no hay texturas, así que el
 * costo en bytes de descarga de una skin sigue siendo cero (sección 7 del
 * spec).
 *
 * Este archivo sólo declara los ids, su índice para el uniform entero que
 * consume el shader, y el adjetivo con que entran al nombre de la skin. La
 * implementación GLSL de cada uno vive en material.ts, en un `switch` sobre
 * ese índice: un solo programa para todos los patrones, elegido por uniform,
 * en vez de un shader por patrón. Ésa es la diferencia entre cambiar de skin
 * escribiendo un uniform (gratis) y recompilar el shader al equiparla (un
 * tirón visible).
 */

export type PatternId =
  | 'solido'
  | 'bandas'
  | 'camo'
  | 'digital'
  | 'astillas'
  | 'hidrografico'
  | 'degradado'

/**
 * Índice que se manda al shader como uniform. El orden es contrato con el
 * `switch` de material.ts: no reordenar sin cambiar los dos lados.
 */
export const PATTERN_INDEX: Record<PatternId, number> = {
  solido: 0,
  bandas: 1,
  camo: 2,
  digital: 3,
  astillas: 4,
  hidrografico: 5,
  degradado: 6,
}

/** Adjetivo del nombre de la skin ("Carmesí" + "Fracturado"). */
export const PATTERN_LABEL: Record<PatternId, string> = {
  solido: 'Liso',
  bandas: 'Rayado',
  camo: 'Mimético',
  digital: 'Digital',
  astillas: 'Fracturado',
  hidrografico: 'Hidrográfico',
  degradado: 'Degradado',
}

/**
 * Escala espacial del patrón, en repeticiones por metro de arma. Cada
 * patrón tiene su rango propio porque no se leen igual: un camuflaje con
 * manchas de 5cm se ve como camuflaje, y con manchas de 40cm se ve como una
 * mancha; un degradado necesita justo lo contrario, una sola pasada a lo
 * largo del arma.
 */
export const PATTERN_SCALE_RANGE: Record<PatternId, readonly [number, number]> = {
  solido: [1, 1],
  bandas: [2, 6],
  camo: [5, 11],
  digital: [7, 16],
  astillas: [3, 7],
  hidrografico: [2.5, 6],
  degradado: [0.8, 1.6],
}
