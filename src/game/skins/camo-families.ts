/**
 * Las seis familias de camuflaje, como capa DERIVADA sobre el generador.
 *
 * De dónde salen: `scripts/lib/camo-families.ts` las generó y validó como
 * funciones puras de (u,v) para producir las teselas máster PNG. Acá no se
 * importa nada de eso — el dibujo vive en GLSL (skins/material.ts) y las
 * teselas nunca llegan al juego. Este archivo sólo decide **qué familia le
 * toca a cada skin**, que es la parte que tiene que ser matemática pura.
 *
 *
 * EL PROBLEMA, Y POR QUÉ LA FAMILIA NO ES UN PARÁMETRO NUEVO DEL GENERADOR
 *
 * La tentación obvia era agregar `familia` al sorteo de generator.ts, o meter
 * ids nuevos en `tier.patterns`. Las dos rompen el contrato explícito de la
 * cabecera de generator.ts: el generador consume el stream del PRNG en un
 * orden fijo, y `pick(rand, tier.patterns)` depende del LARGO de esa lista.
 * Un `rand()` de más, o un patrón de más en un tier, y **todas las skins ya
 * guardadas en localStorage cambian de rareza, de color y de patrón**. Una
 * legendaria guardada ayer aparecería mañana como una común lisa.
 *
 * Así que la familia se DERIVA de lo que el generador ya decidió:
 *
 *     familia = f( patrón, rareza, animación, seed )
 *
 * Cero tiradas nuevas del PRNG, cero cambios en `tier.patterns`. El objeto
 * Skin que devuelve una seed es idéntico campo por campo antes y después de
 * esta tarea salvo por `family`, que es aditivo. Lo verifica
 * camo-families.test.ts con un snapshot de seeds congelado.
 *
 *
 * EL MAPEO, Y LAS DOS DESVIACIONES DELIBERADAS DE LA TABLA
 *
 * La tarea previa fijó familia -> (rareza, animación, patrón). Dos entradas
 * de esa tabla no son alcanzables tal cual está armado el enum hoy, y acá se
 * documenta qué se hizo con cada una:
 *
 * 1. **cebra se engancha a la ANIMACIÓN, no al patrón.** La tabla la pide en
 *    `bandas` + exótico + espectro, pero el tier exótico no tiene `bandas` en
 *    su lista de patrones (rarity.ts: astillas, hidrografico, degradado), así
 *    que esa combinación **nunca sale**. Agregar `bandas` al tier arreglaría
 *    el dibujo y rompería todas las skins exóticas guardadas, que es
 *    exactamente lo que no se puede hacer. La salida: `espectro` es exclusivo
 *    del exótico y hay UNA sola animación así en todo el sistema, así que la
 *    animación identifica la familia sin ambigüedad. Y encaja con el motivo
 *    que dio la tarea previa para el par cebra/espectro — "es la única donde
 *    ciclar el tono ejecuta la idea del patrón en vez de romperle la paleta":
 *    lo que define a la cebra es el barrido de tono, no de qué lista de
 *    patrones salió. Las franjas las dibuja la familia por su cuenta.
 *
 * 2. **multicam y follaje comparten casillero, y los separa la seed.** Las
 *    dos son `camo` sin animación; multicam además figura como "común/raro",
 *    pero el tier común ni siquiera tiene `camo` (sólo solido y bandas), así
 *    que las dos viven en raro y la tabla no las distingue. El desempate sale
 *    de un hash APARTE de la seed (`hashSeed(seed + SAL)`), no del stream del
 *    PRNG: es determinista, es estable entre máquinas, y no mueve un solo bit
 *    del generador.
 *
 * Lo que NO se extendió, y por qué:
 *
 * - **gema nunca fluye.** `astillas` + `flujo` (alcanzable en legendario) cae
 *   en clásico a propósito, no en gema. La retícula de piedras es fija: si el
 *   patrón se desplazara, las gemas patinarían sobre el arma. Es la razón por
 *   la que la tarea previa le puso pulso y no flujo, y respetarla acá es
 *   respetarla de verdad y no sólo en la fila de la tabla.
 * - **multicam y follaje nunca brillan.** Se limitan a común/raro, los tiers
 *   con emisivo 0. Un multicam que emite deja de leerse como camuflaje: es
 *   ropa de dotación, es mate por definición.
 *
 * Toda combinación que no cae en una familia sigue con el patrón procedural
 * de siempre (`clasico`). Eso mantiene el costo de GPU de las seis familias
 * fuera del camino común: común y raro son el 77% de los drops.
 */

import { hashSeed } from '@/game/skins/hash'
import type { PatternId } from '@/game/skins/patterns'
import type { AnimationId, RarityId } from '@/game/skins/rarity'

/**
 * `clasico` no es una familia: es "ninguna de las seis, usá el patrón
 * procedural que ya existía". Tiene índice 0 para que el `switch` del shader
 * lo tome como el caso por defecto.
 */
export type CamoFamilyId =
  | 'clasico'
  | 'multicam'
  | 'follaje'
  | 'filigrana'
  | 'gema'
  | 'damasco'
  | 'cebra'

/**
 * Índice que viaja al shader como uniform. Contrato con el `switch` de
 * material.ts: no reordenar sin cambiar los dos lados.
 */
export const CAMO_FAMILY_INDEX: Record<CamoFamilyId, number> = {
  clasico: 0,
  multicam: 1,
  follaje: 2,
  filigrana: 3,
  gema: 4,
  damasco: 5,
  cebra: 6,
}

/** Nombre de la familia para la UI de la armería. */
export const CAMO_FAMILY_LABEL: Record<CamoFamilyId, string> = {
  clasico: '',
  multicam: 'Multicam',
  follaje: 'Follaje',
  filigrana: 'Filigrana',
  gema: 'Gema',
  damasco: 'Damasco',
  cebra: 'Cebra Arcoíris',
}

/**
 * Cobertura emisiva de referencia de cada familia, medida sobre las máscaras
 * máster (`skin-tiles/emisivo/*.png`, campo `cobertura_emisiva` de
 * camo-tiles.json). Es el promedio de la máscara, no el porcentaje de píxeles
 * encendidos.
 *
 * Está acá y no sólo en un comentario porque es el objetivo contra el que se
 * mide el port: la máscara que calcula el shader tiene que caer cerca de
 * estos números, y sobre todo tiene que dejar en cero el FONDO (el campo teal
 * del damasco, la franja negra de la cebra, el fondo oscuro de filigrana y
 * gema). Son las zonas que dan legibilidad; si se encienden, el arma se lava
 * y deja de leerse la silueta.
 */
export const COBERTURA_EMISIVA: Record<CamoFamilyId, number> = {
  clasico: 0,
  multicam: 0,
  follaje: 0,
  filigrana: 0.2774,
  gema: 0.227,
  damasco: 0.1173,
  cebra: 0.5247,
}

/**
 * Multiplicador de escala por familia.
 *
 * Hace falta porque una familia puede caer sobre patrones anfitriones con
 * rangos de escala muy distintos (`PATTERN_SCALE_RANGE`: hidrografico va de
 * 2.5 a 6, degradado de 0.8 a 1.6). Sin corregir, la misma familia saldría
 * con cuatro veces más repeticiones en un anfitrión que en otro. El
 * multiplicador la lleva a su densidad propia: las gemas necesitan tamaño
 * para que se lea la talla, y el damasco necesita muchas curvas de nivel
 * juntas para leerse como metal y no como mapa.
 *
 * Los números salieron de mirar las seis sobre el arma y compararlas con los
 * PNG máster, no de calcularlos: en la primera pasada follaje, gema y cebra
 * quedaron con tan pocas repeticiones a lo largo del cañón que el dibujo
 * dejaba de leerse —el follaje se veía como una masa verde sin hojas, la gema
 * como piedra agrietada y la cebra como manchones de arcoíris—. Es
 * exactamente la advertencia que dejó la tarea previa: un patrón calibrado
 * sobre un cuadrado plano no se lee igual envuelto sobre la geometría del
 * arma, y la verificación tiene que ser sobre el arma.
 */
export const ESCALA_FAMILIA: Record<CamoFamilyId, number> = {
  clasico: 1,
  multicam: 1.5,
  // El follaje necesita muchas hojas chicas: una hoja tiene silueta
  // reconocible sólo si entran varias a lo ancho del arma. Con pocas, se ve
  // el interior de una hoja y parece mármol verde.
  follaje: 2.1,
  filigrana: 1.2,
  // La retícula de gemas es la más sensible en las dos direcciones: con
  // demasiadas celdas cada piedra queda de pocos píxeles y las facetas no
  // tienen lugar para leerse (el modo de falla que la tarea previa documentó
  // al bajar de 8x8 a 6x6 en la tesela); con muy pocas, el arma muestra tres
  // piedras enormes y se lee como roca partida.
  gema: 2.2,
  damasco: 1.15,
  cebra: 1.5,
}

/**
 * Sal del hash de desempate. Cualquier string sirve mientras no cambie: el
 * día que cambie, las skins raras con `camo` se dan vuelta entre multicam y
 * follaje. Por eso está como constante con nombre y no incrustada.
 */
const SAL_FAMILIA = '#camo'

/**
 * Datos que la derivación necesita. Es un subconjunto de `Skin` a propósito:
 * así esta función se puede testear sin construir una skin entera, y queda
 * explícito que la familia depende de estos cuatro campos y de nada más.
 */
export interface EntradaFamilia {
  seed: string
  rarity: RarityId
  pattern: PatternId
  animation: AnimationId
}

/**
 * Decide la familia de una skin. Función pura: no toca el PRNG del
 * generador, así que agregarla no corre el stream ni cambia ninguna skin ya
 * guardada.
 */
export function camoFamily(entrada: EntradaFamilia): CamoFamilyId {
  const { seed, rarity, pattern, animation } = entrada

  // 1. Espectro es exclusivo del exótico y es la única animación de su tipo
  //    en todo el sistema: alcanza para identificar la cebra sin mirar el
  //    patrón. Ver la desviación 1 de la cabecera.
  if (animation === 'espectro') return 'cebra'

  // 2. Las dos familias que sólo se distinguen por el par patrón+animación.
  if (pattern === 'hidrografico' && animation === 'pulso') return 'filigrana'
  if (pattern === 'hidrografico' && animation === 'flujo') return 'damasco'
  // `astillas` + `flujo` cae a clásico a propósito: la gema no se desplaza.
  if (pattern === 'astillas' && animation === 'pulso') return 'gema'

  // 3. Multicam y follaje: sólo en los tiers sin emisivo, desempatados por un
  //    hash aparte de la seed. Ver la desviación 2 de la cabecera.
  if (pattern === 'camo' && animation === 'ninguna' && (rarity === 'comun' || rarity === 'raro')) {
    return hashSeed(seed + SAL_FAMILIA) % 2 === 0 ? 'multicam' : 'follaje'
  }

  return 'clasico'
}
