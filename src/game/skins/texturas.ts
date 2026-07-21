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

import type { AnimationId, RarityId } from '@/game/skins/rarity'

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
  /**
   * Rareza del camo, del mismo enum que la vía procedural (rarity.ts). NO es
   * decoración: el shader la usa para ESCALAR el brillo. Más legendario = más
   * emisión, más núcleo blanco y más saturación, que es la lógica de los
   * mastery camos de Call of Duty ("el camuflaje más brillante es el más
   * raro"). El campo vive en el catálogo y no se sortea porque estos camos se
   * DESBLOQUEAN por maestría de arma, no caen de una seed: cada uno tiene una
   * rareza fija y elegida, no una tirada. `rarityRank` (rarity.ts) la convierte
   * en el 0..1 que viaja al uniform `uSkinRarity`.
   */
  rarity: RarityId
  /**
   * NIVELES del heightmap: piso y techo del gris ÚTIL del patrón, 0..1. El
   * shader remapea `(g - nivelBajo) / (nivelAlto - nivelBajo)` y lo clampa,
   * igual que la herramienta de niveles de un editor de imágenes.
   *
   * Es la pieza que arregla "gris sobre gris". Cada patrón trae un histograma
   * distinto —vetas ya tiene fondo negro y vetas casi blancas; lava vive en una
   * banda gris estrecha 0.2..0.55; fractura tiene el fondo en gris medio— así
   * que un único umbral en el shader no puede servir a todos. Estirando el
   * rango útil de cada patrón, el VALLE cae a negro profundo y la CRESTA sube a
   * blanco, que es el "neón sobre negro" de las referencias. Sin esto, el fondo
   * gris de fractura/lava tiñe el arma de gris y ninguna paleta lo salva.
   */
  nivelBajo: number
  nivelAlto: number
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
  // --- vetas: filamentos casi blancos sobre negro (el patrón estrella) -----
  // vetas.png ya es lo que quieren las referencias: vetas finas brillantes
  // sobre fondo negro (el swatch de lava de la referencia es exactamente
  // esto). Nivel bajo/alto suaves: el fondo ya es negro, sólo hay que estirar
  // un poco para que la veta llegue a blanco.
  {
    id: 'elemento-115',
    nombre: 'Elemento 115',
    patron: 'vetas',
    // Fondo negro profundo: en la referencia (Weaponized 115) el arma es negra
    // y las vetas son lo ÚNICO que emite. Nada de verde en el fondo.
    base: '#03060a',
    // El acento es el hombro de la veta antes del núcleo blanco: verde medio,
    // no oscuro. El glow verde radiactivo y el núcleo casi blanco los pone el
    // shader arriba del acento.
    accent: '#1e7a34',
    glow: '#a6ff4d',
    emissive: 0.95,
    metal: 0.35,
    rugosidad: 0.42,
    barniz: 0.35,
    // Pulso: las vetas respiran, no se desplazan. Es lo que hace "reactor".
    animation: 'pulso',
    // Escala baja: con vetas.png a 3+ repeticiones las vetas caen sub-píxel y
    // aliasan a ruido; a ~1.6 se leen como filamentos gruesos y continuos con
    // negro entre medio, que es el look de la referencia.
    escala: 1.7,
    // Exótico: la rareza tope, la más brillante. Es el mastery camo insignia.
    rarity: 'exotico',
    nivelBajo: 0.13,
    nivelAlto: 0.46,
  },
  {
    id: 'otromundo',
    nombre: 'Otromundo',
    patron: 'vetas',
    base: '#04060f',
    // Cian/azul de Afterlife y Singularity: la misma red de vetas, otra energía.
    accent: '#1c5fae',
    glow: '#48ecff',
    emissive: 0.88,
    metal: 0.4,
    rugosidad: 0.48,
    barniz: 0.45,
    // Flujo: acá las vetas SÍ se desplazan a lo largo del arma. Es el remolino
    // que fluye de Afterlife, y es lo que una imagen fija no puede dar.
    animation: 'flujo',
    escala: 1.6,
    rarity: 'legendario',
    nivelBajo: 0.13,
    nivelAlto: 0.46,
  },
  // --- nebulosa: nube HDR con núcleos brillantes --------------------------
  {
    id: 'nebulosa',
    nombre: 'Nebulosa',
    patron: 'nebulosa',
    base: '#05030f',
    accent: '#8a2fa6',
    glow: '#ff5ad0',
    emissive: 0.82,
    metal: 0.3,
    rugosidad: 0.55,
    barniz: 0.6,
    // Espectro: el tono cicla, como el "glow" neón de la referencia. Sobre una
    // nube difusa el barrido de color se lee como gas estelar.
    animation: 'espectro',
    escala: 1.8,
    // Exótico: saturación neón extrema, la referencia "glow".
    rarity: 'exotico',
    nivelBajo: 0.2,
    nivelAlto: 0.86,
  },
  {
    id: 'aurora',
    nombre: 'Aurora',
    patron: 'nebulosa',
    base: '#02100f',
    accent: '#1f8a76',
    // Verde/cian sobre casi negro: la misma nube, leída como aurora boreal.
    glow: '#5affc8',
    emissive: 0.6,
    metal: 0.28,
    rugosidad: 0.6,
    barniz: 0.5,
    animation: 'espectro',
    escala: 1.6,
    rarity: 'epico',
    nivelBajo: 0.22,
    nivelAlto: 0.86,
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
    // contra el que se miden los caros. Común = la rareza más baja, no escala.
    emissive: 0,
    metal: 0.2,
    rugosidad: 0.8,
    barniz: 0.1,
    animation: 'ninguna',
    escala: 2.0,
    rarity: 'comun',
    // Niveles suaves: no queremos binarizar el humo, es ruido continuo.
    nivelBajo: 0.12,
    nivelAlto: 0.88,
  },
  // --- lava/vetas: grietas incandescentes sobre negro ---------------------
  {
    id: 'magma',
    nombre: 'Magma',
    // Sobre VETAS y no sobre lava.png: el swatch de la referencia de lava (la
    // más útil, la del tilde) son vetas rojas FINAS sobre negro profundo, que
    // es lo que da vetas.png. lava.png es piedra gris agrietada de bajo
    // contraste y jamás llega a "vetas rojas incandescentes sobre negro". El
    // patrón de piedra queda para Ceniza, que sí quiere roca apagada.
    patron: 'vetas',
    base: '#0a0402',
    accent: '#8a2408',
    // Naranja/rojo incandescente; el núcleo lo lleva el shader a blanco-amarillo
    // como el corazón de la brasa.
    glow: '#ff5a14',
    emissive: 0.95,
    metal: 0.3,
    rugosidad: 0.48,
    barniz: 0.3,
    // Pulso: la lava late como brasa viva.
    animation: 'pulso',
    escala: 1.6,
    rarity: 'legendario',
    nivelBajo: 0.13,
    nivelAlto: 0.46,
  },
  {
    id: 'ceniza',
    nombre: 'Ceniza',
    patron: 'lava',
    base: '#0c0c0e',
    accent: '#4a3a30',
    // La roca agrietada apagándose: rojo tenue que apenas corre por las grietas
    // entre placas casi negras. Los niveles estiran la banda gris estrecha de
    // lava.png para que las placas caigan a negro y las grietas se lean.
    glow: '#c04824',
    emissive: 0.3,
    metal: 0.45,
    rugosidad: 0.62,
    barniz: 0.35,
    animation: 'flujo',
    escala: 2.6,
    rarity: 'raro',
    nivelBajo: 0.32,
    nivelAlto: 0.62,
  },
  // --- damasco: grano de acero plegado ------------------------------------
  {
    id: 'damasco-acero',
    nombre: 'Damasco',
    patron: 'damasco',
    base: '#14161a',
    accent: '#9aa2ac',
    glow: '#c8d2dc',
    // Acero cepillado: casi no emite, el reflejo metálico es la gracia.
    emissive: 0.15,
    metal: 0.9,
    rugosidad: 0.3,
    barniz: 0.55,
    animation: 'flujo',
    escala: 2.8,
    rarity: 'raro',
    nivelBajo: 0.24,
    nivelAlto: 0.8,
  },
  {
    id: 'filigrana-oro',
    nombre: 'Filigrana de Oro',
    patron: 'damasco',
    base: '#120e06',
    accent: '#c69328',
    glow: '#ffd766',
    emissive: 0.42,
    // Oro: reflejo chico, durísimo y DORADO (metal casi 1), como la filigrana.
    metal: 0.95,
    rugosidad: 0.22,
    barniz: 0.8,
    animation: 'pulso',
    escala: 2.6,
    rarity: 'epico',
    nivelBajo: 0.24,
    nivelAlto: 0.8,
  },
  // --- marmol: veta fina sobre piedra pulida ------------------------------
  {
    id: 'marmol',
    nombre: 'Mármol',
    patron: 'marmol',
    base: '#e6e2da',
    accent: '#9a8f80',
    glow: '#ffffff',
    // Piedra clara y pulida: barniz alto para la resina, casi sin emisión. Es
    // el otro camo claro (con humo son los dos que NO son neón sobre negro).
    emissive: 0.08,
    metal: 0.25,
    rugosidad: 0.28,
    barniz: 1.2,
    animation: 'ninguna',
    escala: 2.2,
    rarity: 'comun',
    // Niveles casi identidad: el mármol es claro a propósito, no se binariza.
    nivelBajo: 0.08,
    nivelAlto: 0.92,
  },
  {
    id: 'obsidiana',
    nombre: 'Obsidiana',
    patron: 'marmol',
    base: '#08080c',
    accent: '#2c2c34',
    // La misma veta sobre piedra negra: vidrio volcánico, reflejo frío.
    glow: '#6a7280',
    emissive: 0.14,
    metal: 0.6,
    rugosidad: 0.2,
    barniz: 1.0,
    animation: 'flujo',
    escala: 2.2,
    rarity: 'raro',
    nivelBajo: 0.15,
    nivelAlto: 0.85,
  },
  // --- fractura: grietas radiales desde puntos de impacto -----------------
  {
    id: 'materia-oscura',
    nombre: 'Materia Oscura',
    patron: 'fractura',
    base: '#05081a',
    accent: '#33509e',
    // En Dark Matter la magia es el REFLEJO, no el glow, pero el fondo tiene que
    // ser NEGRO: fractura.png trae el fondo en gris medio, así que los niveles
    // lo bajan a negro y dejan sólo las grietas, por donde corre el reflejo. Un
    // toque de emisión azul da presencia a las grietas cuando el reflejo del
    // entorno (tenue en la vitrina) no alcanza a encenderlas.
    glow: '#7ec0ff',
    emissive: 0.5,
    metal: 0.85,
    rugosidad: 0.16,
    barniz: 1.1,
    animation: 'flujo',
    escala: 1.9,
    rarity: 'legendario',
    nivelBajo: 0.42,
    nivelAlto: 0.62,
  },
  {
    id: 'grieta-carmesi',
    nombre: 'Grieta Carmesí',
    patron: 'fractura',
    base: '#0a0204',
    accent: '#7a1020',
    // La misma red de grietas, encendida: rojo agresivo que late. Los niveles
    // apagan a negro el fondo gris de fractura para que la grieta roja sea lo
    // único que brilla.
    glow: '#ff2a4a',
    emissive: 0.92,
    metal: 0.4,
    rugosidad: 0.46,
    barniz: 0.4,
    animation: 'pulso',
    // Escala baja para que las grietas se lean gruesas, y ventana de niveles
    // ESTRECHA justo encima del fondo (0.45): así casi toda la grieta enciende,
    // no sólo su núcleo, sin levantar el fondo a gris.
    escala: 1.7,
    rarity: 'exotico',
    nivelBajo: 0.42,
    nivelAlto: 0.6,
  },
  // --- topografico: curvas de nivel concéntricas --------------------------
  {
    id: 'cota',
    nombre: 'Cota',
    patron: 'topografico',
    base: '#02100a',
    accent: '#1e8a48',
    glow: '#4affa0',
    // Líneas finas que ciclan el tono: se lee como un mapa de calor vivo. Las
    // líneas de topografico.png son tenues, así que los niveles las suben.
    emissive: 0.58,
    metal: 0.35,
    rugosidad: 0.5,
    barniz: 0.45,
    animation: 'espectro',
    escala: 2.0,
    rarity: 'epico',
    nivelBajo: 0.12,
    nivelAlto: 0.42,
  },
  {
    id: 'radar',
    nombre: 'Radar',
    patron: 'topografico',
    base: '#06080f',
    accent: '#2a4060',
    // Las mismas curvas, en ámbar de instrumento.
    glow: '#ffb02a',
    emissive: 0.52,
    metal: 0.4,
    rugosidad: 0.55,
    barniz: 0.4,
    animation: 'flujo',
    escala: 2.0,
    rarity: 'epico',
    nivelBajo: 0.12,
    nivelAlto: 0.42,
  },
  // --- mercurio: metal líquido en gotas que se funden ---------------------
  {
    id: 'mercurio',
    nombre: 'Mercurio',
    patron: 'mercurio',
    base: '#16181c',
    accent: '#b4bcc6',
    glow: '#dfe6ee',
    // Cromo espejado: metal casi total, rugosidad baja, el reflejo lo es todo.
    emissive: 0.1,
    metal: 0.95,
    rugosidad: 0.14,
    barniz: 1.15,
    animation: 'flujo',
    escala: 2.0,
    rarity: 'raro',
    nivelBajo: 0.35,
    nivelAlto: 0.8,
  },
  {
    id: 'oro-liquido',
    nombre: 'Oro Líquido',
    patron: 'mercurio',
    base: '#14100a',
    accent: '#b98a20',
    glow: '#ffd061',
    // El mismo metal fluido, en oro: gotas doradas que corren al girar.
    emissive: 0.4,
    metal: 0.95,
    rugosidad: 0.2,
    barniz: 0.9,
    animation: 'flujo',
    escala: 2.0,
    rarity: 'legendario',
    nivelBajo: 0.35,
    nivelAlto: 0.8,
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
