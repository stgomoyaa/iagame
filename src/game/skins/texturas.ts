/**
 * La vía de camuflaje POR TEXTURA, en paralelo a la procedural de siempre.
 *
 *
 * QUÉ RESUELVE, Y POR QUÉ NO ES "CARGAR UNA IMAGEN COMO SKIN"
 *
 * El dueño quiere volumen de camuflajes al estilo de los mastery camos de
 * Call of Duty (Element 115, Afterlife, Dark Matter), generándolos con un
 * generador de imágenes. La trampa es dónde está la belleza de esos camos:
 *
 *   - Element 115: vetas verdes que EMITEN luz propia. Eso es emisión, no
 *     dibujo.
 *   - Afterlife: un remolino violeta y cian que FLUYE. Flujo más ciclo de
 *     tono.
 *   - Dark Matter: el patrón base es simple; toda la magia está en el
 *     MOVIMIENTO y el REFLEJO.
 *
 * O sea que el brillo y la animación no pueden venir DENTRO de la imagen. Una
 * imagen generada trae el reflejo pintado y fijo; en un motor PBR eso se ve
 * como calcomanía, porque el brillo pintado no se mueve mientras la luz real
 * sí, y encima pelea contra el specular del material. Es el mismo motivo por
 * el que las seis familias procedurales (camo-families.ts) devuelven su
 * máscara de emisivo desde la matemática y no desde una textura.
 *
 * La división, entonces:
 *
 *   - El generador de imágenes aporta SÓLO el patrón, en escala de grises.
 *     Sin color final, sin brillos, sin metal, sin iluminación. Es un
 *     heightmap: claro = alto, oscuro = bajo.
 *   - El motor aporta color (paleta base/acento), emisión (dónde y de qué
 *     color brilla), metalness/roughness/barniz (cómo responde a la luz) y
 *     una de las cuatro animaciones que ya existen.
 *
 * El resultado: un MISMO patrón en escala de grises, con distinta paleta y
 * animación, da camos que se sienten distintos. Eso es lo que multiplica el
 * catálogo sin multiplicar los bytes. Un patrón comprimido pesa ~40..110 kB
 * (ver docs/PROMPTS-CAMOS.md y scripts/patrones-camo-prueba.ts); las diecisiete
 * definiciones de abajo salen de nueve archivos.
 *
 *
 * POR QUÉ ESTE ARCHIVO ES PURO (NO IMPORTA THREE)
 *
 * Acá vive el CATÁLOGO y sus parámetros, que es matemática y datos: se testea
 * sin GPU, igual que palettes.ts y rarity.ts. La carga de la textura en sí
 * (TextureLoader, wrapping, colorSpace) vive en skins/material.ts, que ya es
 * el único borde de las skins contra three. Un camo por textura es una
 * definición de este catálogo MÁS el `Texture` que material.ts carga bajo
 * demanda a partir de `patronUrl`.
 *
 *
 * CARGA BAJO DEMANDA (regla dura del sistema)
 *
 * Los camos procedurales pesan cero bytes; las texturas rompen esa propiedad.
 * Este catálogo son sólo strings y números: importarlo NO baja ninguna
 * imagen. La textura se pide recién cuando un camo se equipa o se previsualiza
 * (skins/material.ts, `cargarPatron`), y se cachea por URL. Entrar al juego no
 * descarga ni un patrón.
 */

import type { AnimationId } from '@/game/skins/rarity'

/**
 * Un camuflaje por textura: qué patrón en gris usar y cómo lo viste el motor.
 *
 * Todo lo visual sale de acá menos el dibujo, que es el heightmap gris. Dos
 * entradas con el mismo `patron` y distinto resto son camos distintos: es el
 * mecanismo de multiplicación del catálogo.
 */
export interface CamoTextura {
  /** Id estable para persistir cuál equipó el jugador. */
  id: string
  /** Nombre para la armería. */
  nombre: string
  /**
   * Nombre del patrón en escala de grises, sin carpeta ni extensión
   * ('vetas' -> /assets/camos/vetas.png). Varios camos comparten patrón a
   * propósito: es lo que hace barato el catálogo.
   */
  patron: string
  /** Color de las zonas OSCURAS del patrón (el valle del heightmap). Hex sRGB. */
  base: string
  /** Color de las zonas CLARAS del patrón (la cresta). Hex sRGB. */
  accent: string
  /**
   * Color de la EMISIÓN. Separado del acento a propósito: Element 115 tiene
   * base oscura y vetas que brillan VERDE, no del color del acento. Poder
   * elegir el color del glow aparte es la mitad de lo que distingue dos camos
   * del mismo patrón. Hex sRGB.
   */
  glow: string
  /** Fuerza de la emisión, 0..1. 0 = mate (no brilla), 1 = vetas encendidas. */
  emissive: number
  /** Metalicidad, 0..1: de qué color es el reflejo (blanco vs teñido). */
  metal: number
  /** Rugosidad, 0..1: el tamaño del brillo (0 espejo, 1 mate). */
  rugosidad: number
  /** Barniz, 0..1: capa pulida y blanca encima del patrón (la resina). */
  barniz: number
  /** Una de las cuatro animaciones ya implementadas en el shader. */
  animation: AnimationId
  /** Repeticiones del patrón a lo largo del arma. */
  escala: number
}

/** Carpeta pública donde viven los patrones en gris. Local-only: ver .gitignore. */
const DIR_PATRONES = '/assets/camos'

/**
 * URL del PNG de un patrón. Única función que arma esa ruta, mismo criterio
 * que `weaponAssetUrl` en weapons/registry.ts: si mañana cambia la carpeta,
 * cambia en un solo lugar.
 */
export function patronUrl(camo: CamoTextura): string {
  return `${DIR_PATRONES}/${camo.patron}.png`
}

/**
 * El catálogo.
 *
 * Diecisiete camos de NUEVE patrones reales (docs/PROMPTS-CAMOS.md, generados
 * con Higgsfield y verificados uno por uno con el chequeo de teselado: razón
 * 0.5..1.3, muy por debajo del umbral 1.8, croma 0). La repetición de `patron`
 * es el punto entero de la vía: `vetas` aparece como Elemento 115 (verde que
 * respira) y como Otromundo (cian/violeta que fluye) — mismo dibujo, dos camos
 * que no se parecen en nada. Igual `mercurio` rinde como cromo espejado y como
 * oro líquido, y `fractura` como Materia Oscura reflectante y como una grieta
 * carmesí encendida.
 *
 * Los nueve son ORGÁNICOS a propósito: un generador de imágenes no cierra la
 * costura de una grilla rígida (panal, circuito, escamas), así que esos van por
 * el generador procedural de camo-families.ts, que tesela por construcción. La
 * vía por textura se queda con lo que el generador hace bien: vetas, nubes,
 * lava, mármol, fractura, mercurio.
 *
 * Los parámetros no son físicos: son lo que hace que cada uno se lea como lo
 * que quiere ser cuando el arma gira, igual que `skinSuperficie` en
 * material.ts. La calibración fina se hace mirando el arma en movimiento, que
 * es el único juez válido (ver el entregable de la tarea). Los que heredé del
 * set de prueba (Elemento 115, Otromundo, Materia Oscura, Nebulosa, Humo) ya
 * pasaron por ese ojo; los nuevos son un punto de partida razonable por tipo
 * (emisivo / reflectante / mate), a afinar cuando se los vea en pantalla.
 */
export const CATALOGO_CAMOS: readonly CamoTextura[] = [
  // --- vetas: orgánico, filamentos que se encienden -----------------------
  {
    id: 'elemento-115',
    nombre: 'Elemento 115',
    patron: 'vetas',
    base: '#0a0f0a',
    accent: '#1c3a24',
    // El verde radiactivo de la referencia. Va en el glow, no en el acento:
    // el arma es casi negra y las vetas son lo único que emite.
    glow: '#8dff3a',
    emissive: 0.92,
    metal: 0.35,
    rugosidad: 0.45,
    barniz: 0.35,
    // Pulso: las vetas respiran, no se desplazan. Es lo que hace "reactor".
    animation: 'pulso',
    escala: 3.2,
  },
  {
    id: 'otromundo',
    nombre: 'Otromundo',
    patron: 'vetas',
    base: '#160a2a',
    accent: '#3d1f7a',
    // Cian frío sobre violeta: la misma red de vetas, otra energía.
    glow: '#38e6ff',
    emissive: 0.8,
    metal: 0.4,
    rugosidad: 0.5,
    barniz: 0.45,
    // Flujo: acá las vetas SÍ se desplazan a lo largo del arma. Es el remolino
    // que fluye de Afterlife, y es lo que una imagen fija no puede dar.
    animation: 'flujo',
    escala: 3.0,
  },
  // --- nebulosa: nube HDR con núcleos brillantes --------------------------
  {
    id: 'nebulosa',
    nombre: 'Nebulosa',
    patron: 'nebulosa',
    base: '#0c0820',
    accent: '#7a2b8f',
    glow: '#ff5ad0',
    emissive: 0.7,
    metal: 0.3,
    rugosidad: 0.55,
    barniz: 0.6,
    // Espectro: el tono cicla, como Afterlife. Sobre una nube difusa el
    // barrido de color se lee como gas estelar.
    animation: 'espectro',
    escala: 1.8,
  },
  {
    id: 'aurora',
    nombre: 'Aurora',
    patron: 'nebulosa',
    base: '#031014',
    accent: '#1f7a6a',
    // Verde/cian sobre casi negro: la misma nube, leída como aurora boreal.
    glow: '#5affc8',
    emissive: 0.62,
    metal: 0.28,
    rugosidad: 0.6,
    barniz: 0.5,
    animation: 'espectro',
    escala: 1.6,
  },
  // --- humo: ruido suave y apagado (el control) ---------------------------
  {
    id: 'humo-tactico',
    nombre: 'Humo Táctico',
    patron: 'humo',
    base: '#1a1c1f',
    accent: '#6a7178',
    glow: '#9aa0a6',
    // El control del catálogo: gris de dotación, sin brillo ni animación. Es
    // lo que prueba que la vía no depende del glow para verse bien, y el piso
    // contra el que se miden los caros.
    emissive: 0,
    metal: 0.2,
    rugosidad: 0.8,
    barniz: 0.1,
    animation: 'ninguna',
    escala: 2.0,
  },
  // --- lava: grietas que emiten entre placas oscuras ----------------------
  {
    id: 'magma',
    nombre: 'Magma',
    patron: 'lava',
    base: '#140805',
    accent: '#5a1e0a',
    // Naranja incandescente en las grietas; las placas quedan casi negras.
    glow: '#ff6a1a',
    emissive: 0.88,
    metal: 0.3,
    rugosidad: 0.5,
    barniz: 0.3,
    // Pulso: la lava late como brasa viva.
    animation: 'pulso',
    escala: 2.6,
  },
  {
    id: 'ceniza',
    nombre: 'Ceniza',
    patron: 'lava',
    base: '#0e0e10',
    accent: '#3a2f2a',
    // La misma roca agrietada apagándose: rojo tenue que apenas corre.
    glow: '#b23a1e',
    emissive: 0.34,
    metal: 0.45,
    rugosidad: 0.62,
    barniz: 0.35,
    animation: 'flujo',
    escala: 2.6,
  },
  // --- damasco: grano de acero plegado ------------------------------------
  {
    id: 'damasco-acero',
    nombre: 'Damasco',
    patron: 'damasco',
    base: '#14161a',
    accent: '#8a929c',
    glow: '#c8d2dc',
    // Acero cepillado: casi no emite, el reflejo metálico es la gracia.
    emissive: 0.15,
    metal: 0.9,
    rugosidad: 0.3,
    barniz: 0.55,
    animation: 'flujo',
    escala: 2.8,
  },
  {
    id: 'filigrana-oro',
    nombre: 'Filigrana de Oro',
    patron: 'damasco',
    base: '#1a1206',
    accent: '#c69328',
    glow: '#ffd766',
    emissive: 0.4,
    // Oro: reflejo chico, durísimo y DORADO (metal casi 1), como la filigrana.
    metal: 0.95,
    rugosidad: 0.22,
    barniz: 0.8,
    animation: 'pulso',
    escala: 2.6,
  },
  // --- marmol: veta fina sobre piedra pulida ------------------------------
  {
    id: 'marmol',
    nombre: 'Mármol',
    patron: 'marmol',
    base: '#e6e2da',
    accent: '#9a8f80',
    glow: '#ffffff',
    // Piedra clara y pulida: barniz alto para la resina, casi sin emisión.
    emissive: 0.08,
    metal: 0.25,
    rugosidad: 0.28,
    barniz: 1.2,
    animation: 'ninguna',
    escala: 2.2,
  },
  {
    id: 'obsidiana',
    nombre: 'Obsidiana',
    patron: 'marmol',
    base: '#0a0a0c',
    accent: '#2a2a30',
    // La misma veta sobre piedra negra: vidrio volcánico, reflejo frío.
    glow: '#6a7280',
    emissive: 0.12,
    metal: 0.6,
    rugosidad: 0.2,
    barniz: 1.0,
    animation: 'flujo',
    escala: 2.2,
  },
  // --- fractura: grietas radiales desde puntos de impacto -----------------
  {
    id: 'materia-oscura',
    nombre: 'Materia Oscura',
    patron: 'fractura',
    base: '#05070f',
    accent: '#1a2a55',
    // Casi sin emisión: en Dark Matter la magia es el REFLEJO, no el glow. El
    // barniz alto y la rugosidad baja son los que hacen correr el brillo por
    // la fractura cuando el arma gira.
    glow: '#6fb0ff',
    emissive: 0.28,
    metal: 0.85,
    rugosidad: 0.16,
    barniz: 1.1,
    animation: 'flujo',
    escala: 2.2,
  },
  {
    id: 'grieta-carmesi',
    nombre: 'Grieta Carmesí',
    patron: 'fractura',
    base: '#100305',
    accent: '#4a0d16',
    // La misma red de grietas, encendida: rojo agresivo que late.
    glow: '#ff2a4a',
    emissive: 0.85,
    metal: 0.4,
    rugosidad: 0.48,
    barniz: 0.4,
    animation: 'pulso',
    escala: 2.4,
  },
  // --- topografico: curvas de nivel concéntricas --------------------------
  {
    id: 'cota',
    nombre: 'Cota',
    patron: 'topografico',
    base: '#04120a',
    accent: '#186a3a',
    glow: '#4affa0',
    // Líneas finas que ciclan el tono: se lee como un mapa de calor vivo.
    emissive: 0.55,
    metal: 0.35,
    rugosidad: 0.5,
    barniz: 0.45,
    animation: 'espectro',
    escala: 2.0,
  },
  {
    id: 'radar',
    nombre: 'Radar',
    patron: 'topografico',
    base: '#0a0c14',
    accent: '#243a5a',
    // Las mismas curvas, en ámbar/cian de instrumento.
    glow: '#ffb02a',
    emissive: 0.5,
    metal: 0.4,
    rugosidad: 0.55,
    barniz: 0.4,
    animation: 'flujo',
    escala: 2.0,
  },
  // --- mercurio: metal líquido en gotas que se funden ---------------------
  {
    id: 'mercurio',
    nombre: 'Mercurio',
    patron: 'mercurio',
    base: '#16181c',
    accent: '#aeb6c0',
    glow: '#dfe6ee',
    // Cromo espejado: metal casi total, rugosidad baja, el reflejo lo es todo.
    emissive: 0.1,
    metal: 0.95,
    rugosidad: 0.14,
    barniz: 1.15,
    animation: 'flujo',
    escala: 2.0,
  },
  {
    id: 'oro-liquido',
    nombre: 'Oro Líquido',
    patron: 'mercurio',
    base: '#1c1305',
    accent: '#b98a20',
    glow: '#ffd061',
    // El mismo metal fluido, en oro: gotas doradas que corren al girar.
    emissive: 0.35,
    metal: 0.95,
    rugosidad: 0.2,
    barniz: 0.9,
    animation: 'flujo',
    escala: 2.0,
  },
]

export const CAMO_TEXTURA_POR_ID: Record<string, CamoTextura> = Object.fromEntries(
  CATALOGO_CAMOS.map((c) => [c.id, c]),
)

/**
 * Patrones únicos del catálogo. Es lo que de verdad se descarga: varios camos
 * comparten patrón, así que el peso del catálogo es el de los PNG distintos,
 * no el de las entradas. Con esto se calcula el costo real de un catálogo de
 * N camos (ver docs/PROMPTS-CAMOS.md).
 */
export function patronesUnicos(camos: readonly CamoTextura[] = CATALOGO_CAMOS): string[] {
  return [...new Set(camos.map((c) => c.patron))]
}
