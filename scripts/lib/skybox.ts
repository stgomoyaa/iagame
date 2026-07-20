/**
 * Generador procedural del skybox "galaxia púrpura", horneado a un cubemap
 * de 6 caras PNG que Three.js consume con CubeTextureLoader (sin librerías
 * extra, sin loaders de HDR/EXR).
 *
 * # Por qué una función de la DIRECCIÓN y no un patrón por cara
 *
 * Todo el color sale de `colorDelCielo(dir)`, una función pura del vector
 * unitario que apunta a ese texel. Las caras del cubo no se generan
 * independientes: cada texel se convierte primero a su dirección en el
 * mundo y recién ahí se evalúa el color. Esto hace que las costuras entre
 * caras sean IMPOSIBLES por construcción, no algo que haya que corregir
 * después: dos texels de caras distintas que miran casi al mismo lado
 * evalúan casi la misma dirección, así que dan casi el mismo color. El
 * camino alternativo (generar ruido 2D por cara) produce costuras visibles
 * en las 12 aristas y no hay forma barata de arreglarlas.
 *
 * # La restricción que manda: legibilidad de siluetas, no estética
 *
 * El jugador tiene que distinguir la silueta de un enemigo recortada contra
 * el cielo. Eso impone dos cosas que van EN CONTRA del instinto de "espacio
 * = negro con estrellas":
 *
 *  1. **Piso de luminancia.** Un cielo casi negro y un enemigo a contraluz
 *     son los dos oscuros: la silueta desaparece. El cielo tiene que estar
 *     claramente MÁS CLARO que una silueta oscura en todo el domo. De ahí
 *     `LUMINANCIA_PISO`: el degradado base nunca baja de ahí, y la única
 *     capa que resta luz (el polvo) está construida para no poder bajarlo
 *     (ver `colorDelCielo`).
 *  2. **Techo de contraste LOCAL.** El problema no es el rango global del
 *     cielo -- un degradado suave de horizonte a cenit es gratis para la
 *     lectura, porque a la escala de un enemigo en pantalla es casi plano.
 *     El problema es la variación a la escala de la silueta: un grumo
 *     brillante de nebulosa del tamaño de un enemigo compite con él. Por
 *     eso la métrica de calidad no es "rango de luminancia" sino la
 *     desviación estándar en una ventana del tamaño angular de un enemigo
 *     (`contrasteLocalP999`, y la derivación de la ventana en
 *     `VENTANA_SILUETA_TEXELS`).
 *
 * Ese par (piso alto + contraste local bajo) es lo que define la paleta: un
 * púrpura DESATURADO y levantado, no un violeta saturado. La luminancia
 * Rec.709 pesa el verde 0.7152 y el azul apenas 0.0722, así que un púrpura
 * saturado (verde ~0) es necesariamente oscuro y rompe el piso. El púrpura
 * que sí cumple es el de un cielo nocturno con algo de contaminación
 * lumínica -- que además es exactamente el look que se buscaba.
 */

/** Vector 3D mutable. Se reusa entre texels: el horneado toca millones de
 *  texels y no puede asignar un objeto por cada uno. */
export interface Vec3 {
  x: number
  y: number
  z: number
}

/** Color lineal (NO codificado a sRGB). Ver `linealASrgb`. */
export interface ColorLineal {
  r: number
  g: number
  b: number
}

/**
 * Orden de caras del cubemap. Es contrato con Three.js: `CubeTextureLoader`
 * espera exactamente [+X, -X, +Y, -Y, +Z, -Z] y el orden no se puede
 * cambiar sin que el cielo quede rotado y espejado.
 */
export const CARAS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'] as const

export type Cara = (typeof CARAS)[number]

/**
 * Dirección en el mundo del texel (x, y) de una cara, según la convención
 * de cubemaps de OpenGL/WebGL (la misma que usa Three).
 *
 * Dos detalles que son la fuente clásica de un cielo espejado o de cabeza:
 *
 *  - La fila 0 de la imagen es ARRIBA (t = 0), al revés que una textura 2D
 *    normal. Los cubemaps se suben sin voltear: `CubeTexture` de Three nace
 *    con `flipY = false` justamente por esto. Si se genera pensando en
 *    "fila 0 = abajo", el cielo entero sale invertido en vertical.
 *  - El +0.5 muestrea el CENTRO del texel. Sin él, el borde de una cara
 *    cae exactamente sobre la arista y las dos caras vecinas muestrean
 *    direcciones distintas, que es justo la costura que este diseño existe
 *    para evitar.
 *
 * Devuelve el vector SIN normalizar (su largo es >= 1); `colorDelCielo`
 * normaliza. Separarlo permite testear la convención sin ruido de
 * normalización.
 */
export function direccionDeTexel(cara: Cara, x: number, y: number, tamano: number, out: Vec3): Vec3 {
  const s = (x + 0.5) / tamano
  const t = (y + 0.5) / tamano
  // sc/tc en [-1, 1]: coordenadas del plano de la cara.
  const sc = 2 * s - 1
  const tc = 2 * t - 1

  switch (cara) {
    case 'px':
      out.x = 1
      out.y = -tc
      out.z = -sc
      break
    case 'nx':
      out.x = -1
      out.y = -tc
      out.z = sc
      break
    case 'py':
      out.x = sc
      out.y = 1
      out.z = tc
      break
    case 'ny':
      out.x = sc
      out.y = -1
      out.z = -tc
      break
    case 'pz':
      out.x = sc
      out.y = -tc
      out.z = 1
      break
    case 'nz':
      out.x = -sc
      out.y = -tc
      out.z = -1
      break
  }
  return out
}

/** Normaliza en el lugar. */
export function normalizar(v: Vec3): Vec3 {
  const largo = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  v.x /= largo
  v.y /= largo
  v.z /= largo
  return v
}

// ---------------------------------------------------------------------------
// Ruido
// ---------------------------------------------------------------------------

/**
 * Hash entero de un punto de la grilla 3D. Mismo espíritu que
 * src/game/skins/hash.ts (xmur3 / mulberry32): mezcla multiplicativa con
 * `Math.imul` para que celdas vecinas caigan lejos en el espacio de salida.
 * Sumar coordenadas -- el hash ingenuo -- da planos de simetría visibles
 * como estructura diagonal en la nebulosa.
 */
export function hashCelda(ix: number, iy: number, iz: number, semilla: number): number {
  let h = semilla ^ 374761393
  h = Math.imul(h ^ ix, 3432918353)
  h = (h << 13) | (h >>> 19)
  h = Math.imul(h ^ iy, 2246822507)
  h = (h << 11) | (h >>> 21)
  h = Math.imul(h ^ iz, 3266489909)
  h ^= h >>> 15
  h = Math.imul(h, 2246822507)
  return (h ^ (h >>> 13)) >>> 0
}

/**
 * Los 12 gradientes del Perlin clásico (aristas de un cubo). Ruido de
 * GRADIENTE y no de valor: el ruido de valor tiene extremos anclados a la
 * grilla y deja una cuadrícula alineada a los ejes que en una nebulosa se
 * ve como tela, no como gas.
 */
const GRADIENTES: readonly (readonly [number, number, number])[] = [
  [1, 1, 0],
  [-1, 1, 0],
  [1, -1, 0],
  [-1, -1, 0],
  [1, 0, 1],
  [-1, 0, 1],
  [1, 0, -1],
  [-1, 0, -1],
  [0, 1, 1],
  [0, -1, 1],
  [0, 1, -1],
  [0, -1, -1],
]

/** Fade quíntico de Perlin: primera y segunda derivada nulas en 0 y 1, así
 *  las celdas se pegan sin que se vea la frontera. */
function suavizar(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10)
}

/**
 * Interpolación lineal en la forma `(1-t)*a + t*b` y no en la habitual
 * `a + (b-a)*t`.
 *
 * La habitual NO es exacta en los extremos: con t = 1 calcula
 * `a + (b-a)*1`, y esa resta y suma redondean, así que devuelve algo a unos
 * 1e-6 de `b` en vez de `b`. Acá eso importaba de verdad -- el test que
 * verifica que ninguna capa resta por debajo del degradado base fallaba en
 * el cenit exacto (t = 1) por 3.6e-6, sin que hubiera ninguna capa
 * restando. Esta forma devuelve `b` exacto en t = 1 y `a` exacto en t = 0.
 */
function interpolar(a: number, b: number, t: number): number {
  return (1 - t) * a + t * b
}

/** Ruido de gradiente 3D en [-1, 1] aprox. */
export function ruidoGradiente(x: number, y: number, z: number, semilla: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const iz = Math.floor(z)
  const fx = x - ix
  const fy = y - iy
  const fz = z - iz

  const u = suavizar(fx)
  const v = suavizar(fy)
  const w = suavizar(fz)

  let resultado = 0
  // Acumulación por esquina, sin arrays temporales: esto corre ~200M veces
  // por horneado y cualquier asignación adentro se nota en minutos.
  for (let dz = 0; dz <= 1; dz++) {
    for (let dy = 0; dy <= 1; dy++) {
      for (let dx = 0; dx <= 1; dx++) {
        const g = GRADIENTES[hashCelda(ix + dx, iy + dy, iz + dz, semilla) % 12]
        const px = fx - dx
        const py = fy - dy
        const pz = fz - dz
        const punto = g[0] * px + g[1] * py + g[2] * pz
        const peso =
          (dx === 0 ? 1 - u : u) * (dy === 0 ? 1 - v : v) * (dz === 0 ? 1 - w : w)
        resultado += punto * peso
      }
    }
  }
  return resultado
}

/** Suma de octavas (fBm) normalizada a [-1, 1] aprox. */
export function fbm(
  x: number,
  y: number,
  z: number,
  semilla: number,
  octavas: number,
  lacunaridad = 2.0,
  ganancia = 0.5,
): number {
  let suma = 0
  let amplitud = 1
  let normalizacion = 0
  let frecuencia = 1
  for (let o = 0; o < octavas; o++) {
    suma += amplitud * ruidoGradiente(x * frecuencia, y * frecuencia, z * frecuencia, semilla + o * 1013)
    normalizacion += amplitud
    amplitud *= ganancia
    frecuencia *= lacunaridad
  }
  return suma / normalizacion
}

/** fBm "ridged": |ruido| invertido. Da filamentos en vez de manchas, que es
 *  lo que hace leer una nebulosa como gas y no como niebla. */
export function fbmFilamentos(x: number, y: number, z: number, semilla: number, octavas: number): number {
  let suma = 0
  let amplitud = 1
  let normalizacion = 0
  let frecuencia = 1
  for (let o = 0; o < octavas; o++) {
    const n = 1 - Math.abs(ruidoGradiente(x * frecuencia, y * frecuencia, z * frecuencia, semilla + o * 7717))
    suma += amplitud * n * n
    normalizacion += amplitud
    amplitud *= 0.5
    frecuencia *= 2
  }
  return suma / normalizacion
}

// ---------------------------------------------------------------------------
// Color
// ---------------------------------------------------------------------------

/** Codifica un canal lineal a sRGB (la transferencia estándar, no la
 *  aproximación gamma 2.2: la parte lineal cerca del negro importa acá,
 *  donde vive casi todo el cielo). */
export function linealASrgb(c: number): number {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055
}

/** Decodifica sRGB a lineal. Inversa exacta de `linealASrgb`. */
export function srgbALineal(c: number): number {
  const x = Math.min(1, Math.max(0, c))
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)
}

/** Luminancia relativa Rec.709 de un color YA codificado a sRGB. Se mide
 *  sobre el valor codificado y no sobre el lineal a propósito: los umbrales
 *  de legibilidad de acá abajo son perceptuales, y sRGB es aproximadamente
 *  perceptualmente uniforme mientras que la luz lineal no lo es. */
export function luminanciaSrgb(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

// ---------------------------------------------------------------------------
// Paleta y presupuesto de legibilidad
// ---------------------------------------------------------------------------

/**
 * Piso de luminancia (en sRGB codificado) del cielo.
 *
 * Derivación: la silueta más oscura que puede recortarse contra el cielo es
 * un personaje a contraluz, que en la práctica cae cerca de 0.10 sRGB. Para
 * que un borde grande se lea sin esfuerzo hace falta bastante más que el
 * umbral de detección: 0.12 de diferencia en sRGB son ~30 niveles de 255,
 * varias veces el JND de un borde de ese tamaño, y aguanta un monitor mal
 * calibrado o una sala con luz. 0.10 + 0.12 = 0.22.
 */
export const LUMINANCIA_PISO = 0.22

/**
 * Techo de luminancia del cielo SIN estrellas.
 *
 * Dos razones, ninguna estética: (a) por encima de ~0.45 deja de leerse
 * como noche y el mapa, que es geometría sin iluminar (MeshBasicMaterial),
 * queda flotando sobre un fondo más claro que él; (b) hay que dejar cabeza
 * para que los colores de equipo saturados y claros (character-material.ts:
 * 0xffd21e, 0xff2e2e) sigan destacándose CONTRA el cielo, no sólo las
 * siluetas oscuras. El cielo tiene que quedar en el medio.
 */
export const LUMINANCIA_TECHO = 0.45

/**
 * Piso de contraste CROMÁTICO local: cuánta estructura de color tiene que
 * haber, como mínimo, a la escala de la silueta.
 *
 * Es el único gate que apunta hacia arriba, y existe porque todos los demás
 * son techos: un degradado liso sin galaxia los cumple todos y es justo el
 * cielo que el dueño rechazó por "muy baja calidad". Sin este número, una
 * regresión a lavanda plano pasaría el conjunto de tests entero en verde.
 *
 * Derivación, midiendo los dos cubemaps de 1024 con esta misma función:
 *
 *            contraste luminancia   contraste croma
 *   viejo    0.0389                 0.0155
 *   nuevo    0.0401                 0.0703
 *
 * O sea 4.5 veces más estructura cromática por el mismo costo en luminancia
 * (+3%), que es exactamente la estrategia del archivo: mover el tono y no el
 * brillo. El piso va en 0.040 -- 2.6x el cielo rechazado y 57% del actual:
 * lo bastante alto como para que volver a algo plano falle, y lo bastante
 * bajo como para no obligar a futuros retoques de paleta a mantener
 * exactamente esta cantidad de color.
 */
export const CROMA_ESTRUCTURA_PISO = 0.04

/**
 * Lado de la ventana, en texels del cubemap, sobre la que se mide el
 * contraste local.
 *
 * Derivación: un enemigo de 1.8 m a 30 m (distancia de combate típica en
 * una arena de 60x60, ver bots/tuning.ts) subtiende
 * 2*atan(0.9/30) = 3.4 grados. Una cara del cubemap cubre 90 grados en
 * `tamano` texels: a 1024 eso es 0.088 grados/texel, así que el enemigo
 * mide 3.4/0.088 = 39 texels. Se redondea a 32 (potencia de 2, y ser un
 * poco más chico que la silueta es el lado conservador: mide la variación
 * DENTRO del área que el enemigo tapa).
 *
 * Ojo: esto escala con la resolución. La constante es para 1024; el
 * analizador la reescala.
 */
export const VENTANA_SILUETA_TEXELS = 32

/**
 * Paleta del cielo, en luz LINEAL. Los comentarios dan el valor sRGB
 * equivalente, que es el que se ve en un selector de color.
 *
 * # Por qué la riqueza es de TONO y no de brillo
 *
 * El piso y el techo juntos dejan al cielo entero encerrado entre 0.22 y
 * 0.45 de luminancia. Eso es un sexto del rango disponible, y el primer
 * intento de esta paleta -- que respetaba los dos números -- salió un lila
 * plano, tipo sábana: correcto según las métricas y feo de mirar. El
 * problema es que "galaxia" en la cabeza de cualquiera es negro con puntos
 * brillantes, o sea justo el rango de luminancia que este juego no puede
 * gastar.
 *
 * La salida es mover el TONO en vez del brillo. El ojo separa muy bien
 * magenta de índigo aunque los dos tengan la misma luminancia, y la
 * detección de siluetas -- que es un problema de bordes -- corre casi toda
 * por el canal de luminancia. O sea: el color puede variar todo lo que
 * quiera mientras el brillo no lo haga. Por eso el cenit es índigo, el
 * núcleo de la banda es magenta y los bordes son azules, y los tres están
 * dentro de 0.05 de luminancia entre sí. La galaxia se lee por color; la
 * silueta del enemigo se lee por brillo. Cada uno usa un canal distinto y
 * no se pisan.
 */
export interface PaletaCielo {
  /** Color en el horizonte (|y| = 0). El más claro: el resplandor de la
   *  galaxia se acumula ahí igual que la contaminación lumínica real. */
  horizonte: ColorLineal
  /** Color en el cenit (y = +1). El más oscuro de la mitad de arriba. */
  cenit: ColorLineal
  /** Color en el nadir (y = -1). Casi nunca se ve (el piso del mapa lo
   *  tapa) pero tiene que existir: los mapas importados de Source tienen
   *  huecos por donde se ve abajo. */
  nadir: ColorLineal
  /**
   * Color cálido de los brazos (magenta/rojizo). Se SUMA al base.
   *
   * Verde casi nulo A PROPÓSITO: en Rec.709 el verde pesa 0.7152, así que un
   * aporte sin verde puede ser cromáticamente enorme y costar casi nada de
   * luminancia. Ese es el mecanismo que permite meter brazos, grano y polvo
   * dentro de una ventana de luminancia de 0.23 de ancho.
   */
  brazoCalido: ColorLineal
  /** Color frío de los brazos (azul). Mismo truco: casi sin rojo ni verde,
   *  así que aporta todavía menos luminancia que el cálido (el azul pesa
   *  0.0722) y sin embargo se separa de él a simple vista. */
  brazoFrio: ColorLineal
  /**
   * Color del núcleo. ESTE SÍ lleva verde: es el único lugar del cielo donde
   * se gasta luminancia a propósito, porque un núcleo que no sea claramente
   * más brillante que el disco no se lee como núcleo. Es el aporte caro y por
   * eso es el único que está limitado por el techo.
   */
  nucleo: ColorLineal
  /** Halo/bulbo alrededor del núcleo: cálido y tenue, hace de transición
   *  entre el blanco del núcleo y el magenta de los brazos. */
  bulbo: ColorLineal
}

/** Paleta por defecto: púrpura desaturado y levantado (ver el encabezado
 *  del archivo para por qué no puede ser un violeta saturado). */
export const PALETA_GALAXIA_PURPURA: PaletaCielo = {
  // sRGB (0.33, 0.235, 0.47) -- violeta cálido. Luminancia 0.272.
  //
  // Nota histórica útil: la primera versión usaba (0.27, 0.18, 0.40) para el
  // cenit, que "se ve" igual de púrpura y sin embargo da luminancia 0.215,
  // por DEBAJO de LUMINANCIA_PISO. Lo cazó el test del piso, no el ojo. La
  // luminancia de un púrpura hay que calcularla: el verde pesa 0.7152 en
  // Rec.709 y es justo el canal que un púrpura no tiene, así que dos
  // violetas indistinguibles de mirar pueden estar a un mundo de distancia
  // en lo único que importa para leer una silueta.
  horizonte: { r: srgbALineal(0.33), g: srgbALineal(0.235), b: srgbALineal(0.47) },
  // sRGB (0.23, 0.205, 0.50) -- índigo. Luminancia 0.232.
  // Apenas 0.04 más oscuro que el horizonte, pero MUY distinto de tono: es
  // el eje del truco descrito arriba.
  cenit: { r: srgbALineal(0.23), g: srgbALineal(0.205), b: srgbALineal(0.5) },
  // sRGB (0.26, 0.20, 0.39) -- violeta apagado. Luminancia 0.227.
  nadir: { r: srgbALineal(0.26), g: srgbALineal(0.2), b: srgbALineal(0.39) },
  // sRGB (0.46, 0.11, 0.30) de aporte -- magenta rojizo, el color de las
  // zonas HII de la referencia. Más saturado que el magenta viejo (0.34,
  // 0.13, 0.29) y aun así más barato en luminancia, porque el verde bajó.
  brazoCalido: { r: srgbALineal(0.54), g: srgbALineal(0.1), b: srgbALineal(0.33) },
  // sRGB (0.10, 0.19, 0.52) de aporte -- azul de cúmulos jóvenes.
  brazoFrio: { r: srgbALineal(0.09), g: srgbALineal(0.17), b: srgbALineal(0.56) },
  // sRGB (0.60, 0.62, 0.78) de aporte -- blanco azulado. El único aporte con
  // verde alto de toda la paleta, y por eso el único que hay que racionar.
  nucleo: { r: srgbALineal(0.6), g: srgbALineal(0.62), b: srgbALineal(0.78) },
  // sRGB (0.34, 0.20, 0.34) de aporte -- lila cálido del bulbo.
  bulbo: { r: srgbALineal(0.34), g: srgbALineal(0.2), b: srgbALineal(0.34) },
}

export interface ParamsCielo {
  paleta: PaletaCielo
  semilla: number

  // --- disco espiral (el rasgo principal) ----------------------------------
  /** Elevación del EJE del disco sobre el horizonte, en grados. 90 pondría
   *  el núcleo justo en el cenit. */
  elevacionEjeGrados: number
  /** Azimut del eje del disco, en grados. */
  azimutEjeGrados: number
  /** Radio angular del disco visible, en grados. */
  radioDiscoGrados: number
  /** Apertura del espiral logarítmico: tangente del ángulo de pitch. Más
   *  chico = brazos más enroscados. */
  aperturaEspiral: number
  /** Ancho de los brazos como fracción de la separación entre brazos
   *  (0-1). Lo que sobra son las bandas de polvo oscuras. */
  anchoBrazos: number
  /** Intensidad global del disco. 1 = paleta tal cual. */
  intensidadGalaxia: number
  /** Radio angular del núcleo (sigma de la gaussiana), en grados. */
  radioNucleoGrados: number
  /** Intensidad del núcleo. Es el aporte que gasta luminancia: subirlo es lo
   *  primero que rompe el techo. */
  intensidadNucleo: number

  // --- banda secundaria ----------------------------------------------------
  /** Inclinación de la banda secundaria en grados sobre el horizonte. Es el
   *  segundo brazo que cruza en diagonal en la referencia: una galaxia de
   *  canto, lejana, que corta el encuadre por otro lado que el disco. */
  inclinacionBandaGrados: number
  /** Giro de la banda secundaria alrededor del eje vertical, en grados. */
  giroBandaGrados: number
  /** Ancho angular de la banda (0-1, fracción del hemisferio). */
  anchoBanda: number
  /** Intensidad de la banda secundaria. 1 = paleta tal cual. */
  intensidadBanda: number

  // --- estrellas -----------------------------------------------------------
  /** Densidad de estrellas: probabilidad de que una celda de la grilla
   *  estelar tenga una. */
  densidadEstrellas: number
  /** Brillo máximo de una estrella, en sRGB codificado. */
  brilloEstrellas: number
}

export const PARAMS_POR_DEFECTO: ParamsCielo = {
  paleta: PALETA_GALAXIA_PURPURA,
  semilla: 0x9e3779b9,

  // 58 grados y no 90: a 90 el núcleo queda clavado en el cenit, que es
  // justo donde apunta la cámara al saltar o al pelear contra alguien en una
  // cornisa -- o sea el rasgo más brillante del cielo permanentemente en la
  // línea de tiro. A 58 el disco todavía se ve casi de frente mirando arriba
  // (que es como se aprueba esto), pero el núcleo cae hacia un costado y
  // buena parte del tiempo lo tapa la geometría del mapa.
  elevacionEjeGrados: 58,
  azimutEjeGrados: 205,
  // 74 grados de radio: el disco ocupa un cono ancho alrededor de su eje sin
  // llegar a envolver el domo entero. Más chico se lee como una mancha
  // pegada en el cielo; más grande deja de tener afuera contra qué leerse.
  radioDiscoGrados: 62,
  // 0.42 = pitch de ~23 grados, el rango real de una espiral Sb/Sc. Con
  // valores bajos (0.2) los brazos se enroscan tanto que a la escala de la
  // pantalla se leen como anillos concéntricos, no como espiral.
  aperturaEspiral: 0.32,
  // 0.52: un poco más de la mitad. Lo que sobra -- el 48% restante -- son
  // las bandas de polvo oscuras entre brazos, que es de donde sale la
  // estructura de la referencia. Subirlo a 0.8 borra las bandas y el disco
  // vuelve a ser una mancha.
  anchoBrazos: 0.44,
  intensidadGalaxia: 1.8,
  // 13 grados de sigma: el núcleo es GRANDE a propósito. La métrica que
  // manda es el contraste a escala de silueta (3.4 grados), y una gaussiana
  // de sigma 13 varía tan despacio a esa escala que su aporte al contraste
  // local es ~0.002 aunque su amplitud total sea 0.15 de luminancia. Un
  // núcleo chico y del mismo brillo sería un grumo del tamaño de un enemigo
  // y rompería el gate.
  radioNucleoGrados: 13,
  // 0.23 y no 1: este es EL número que fija el techo. Medido, el máximo del
  // cielo sin estrellas es 0.305 sin núcleo y sube ~0.55 por unidad de
  // intensidad; a 1 daba 0.711, o sea 58% por encima del techo de 0.45. A
  // 0.23 el pico queda en ~0.43, que deja el núcleo claramente más brillante
  // que el disco (0.26-0.30) sin comerle contraste a los colores de equipo
  // claros. Es la concesión concreta contra la referencia: ahí el núcleo
  // está quemado a blanco 1.0 y acá no puede estarlo.
  intensidadNucleo: 0.24,

  // 26 grados: la banda secundaria cruza en diagonal por otro lado que el
  // disco. Que los dos ejes NO coincidan es lo que hace que se lean como dos
  // objetos y no como un halo del mismo.
  inclinacionBandaGrados: 26,
  giroBandaGrados: 118,
  // 0.16 y no 0.30: la banda ahora es un rasgo de reparto, no el motivo
  // principal. Angosta se lee como una galaxia de canto vista de lejos.
  anchoBanda: 0.16,
  intensidadBanda: 0.55,

  // 0.10 contra 0.035 del original: casi el triple de estrellas. Se puede
  // gastar eso porque las estrellas ahora son MUCHO más finas (ver
  // RADIO_ESTRELLA_*), y la métrica de contraste local se dispara con el
  // TAMAÑO de los puntos brillantes, no con su cantidad: la versión vieja
  // gastaba 0.039 de un presupuesto de 0.05 en ~1600 estrellas gordas. Con
  // estrellas finas entran ~4600 por menos de la mitad de ese costo, y son
  // las que dan el grano de la referencia.
  densidadEstrellas: 0.1,
  brilloEstrellas: 0.8,
}

/** Escala de la grilla estelar: cuántas celdas por radio unitario. Más alto
 *  = estrellas más chicas y más juntas. */
const ESCALA_ESTRELLAS = 46

/**
 * Radio del perfil gaussiano de una estrella, en unidades de la grilla
 * estelar. El rango [MIN, MIN+RANGO] mezcla puntos finos con algunos algo
 * más abiertos.
 *
 * # Por qué son mucho más finas que en la primera versión
 *
 * La versión original usaba [0.16, 0.38] y ESO -- no la nebulosa -- era lo
 * que se comía el presupuesto de contraste local: medido por ablación, el
 * cielo sin estrellas daba 0.0087 y con estrellas 0.0393, de un máximo de
 * 0.05. Las estrellas más gordas de ese rango cubren ~1.6 grados, casi la
 * mitad de la ventana de silueta (3.4 grados), así que la métrica las contaba
 * como grumos que compiten con un enemigo -- y con razón.
 *
 * El rango de acá cubre ~0.35 grados en el peor caso: un punto, no un grumo.
 * Eso libera casi todo el presupuesto para gastarlo en la estructura del
 * disco, que es lo que de verdad hace que se lea como galaxia. Y de paso las
 * estrellas se parecen más a las de la referencia, que son granos finos.
 */
const RADIO_ESTRELLA_MIN = 0.085
const RADIO_ESTRELLA_RANGO = 0.075

/**
 * Estrellas como función pura de la dirección, con una grilla 3D de puntos
 * característicos (estilo Worley).
 *
 * Por qué así y no "salpicar N estrellas sobre las caras": salpicando, una
 * estrella cerca de una arista queda recortada a la mitad (su splat no
 * cruza a la cara vecina) y la densidad por ángulo sólido queda desparejo,
 * porque el centro de una cara del cubo cubre bastante menos ángulo por
 * texel que las esquinas. Evaluando desde la dirección, las dos cosas salen
 * gratis: la grilla vive en el espacio 3D, la esfera la corta parejo, y una
 * estrella sobre una arista se evalúa igual desde las dos caras.
 */
function estrellas(dir: Vec3, params: ParamsCielo): number {
  const px = dir.x * ESCALA_ESTRELLAS
  const py = dir.y * ESCALA_ESTRELLAS
  const pz = dir.z * ESCALA_ESTRELLAS
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  const iz = Math.floor(pz)

  let brillo = 0
  // Vecindario 3x3x3: el punto característico de una celda vecina puede
  // caer del lado de acá de la frontera. Con 2x2x2 se ven estrellas
  // cortadas contra los planos de la grilla.
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const h = hashCelda(ix + dx, iy + dy, iz + dz, params.semilla ^ 0x5bf03635)
        // Primer uso del hash: ¿esta celda tiene estrella? La mayoría no.
        const existe = (h & 0xffff) / 0x10000
        if (existe > params.densidadEstrellas) continue

        // Bits distintos del mismo hash para la posición dentro de la celda
        // y el brillo, para que no queden correlacionados con la existencia.
        const h2 = hashCelda(ix + dx, iy + dy, iz + dz, params.semilla ^ 0x27d4eb2d)
        const fx = ix + dx + ((h2 & 0x3ff) / 0x400)
        const fy = iy + dy + (((h2 >>> 10) & 0x3ff) / 0x400)
        const fz = iz + dz + (((h2 >>> 20) & 0x3ff) / 0x400)

        const largo = Math.sqrt(fx * fx + fy * fy + fz * fz)
        if (largo === 0) continue
        // Distancia angular aproximada: la cuerda entre la dirección del
        // texel y la dirección de la estrella, en unidades de la grilla.
        const ex = fx / largo
        const ey = fy / largo
        const ez = fz / largo
        const ddx = (dir.x - ex) * ESCALA_ESTRELLAS
        const ddy = (dir.y - ey) * ESCALA_ESTRELLAS
        const ddz = (dir.z - ez) * ESCALA_ESTRELLAS
        const d2 = ddx * ddx + ddy * ddy + ddz * ddz

        // Perfil gaussiano. El radio sale del hash: mezcla de estrellas
        // finas y algunas más abiertas.
        const radio = RADIO_ESTRELLA_MIN + (((h >>> 16) & 0xff) / 0xff) * RADIO_ESTRELLA_RANGO
        const caida = Math.exp(-d2 / (radio * radio))
        if (caida < 0.004) continue

        // Magnitud: la mayoría tenues, unas pocas brillantes. Elevar un
        // uniforme a la cuarta concentra la masa cerca de 0 y deja una cola
        // corta arriba, que es como se distribuyen las magnitudes reales.
        // Con una distribución plana (o con un piso alto) todas las
        // estrellas salen parecidas y el campo se lee como purpurina.
        const u = ((h2 >>> 24) & 0xff) / 0xff
        const magnitud = u * u * u * u
        brillo += caida * (0.05 + 0.95 * magnitud)
      }
    }
  }
  return brillo
}

/**
 * Base ortonormal del disco galáctico: el eje `a` y dos vectores `u`, `v` que
 * generan el plano del disco. Se calcula UNA vez por horneado y no por texel:
 * son ocho llamadas a trigonometría que darían lo mismo 6.3 millones de veces.
 */
export interface MarcoGalaxia {
  ax: number
  ay: number
  az: number
  ux: number
  uy: number
  uz: number
  vx: number
  vy: number
  vz: number
}

/** Construye el marco del disco a partir de la elevación y el azimut del eje. */
export function marcoGalaxia(params: ParamsCielo): MarcoGalaxia {
  const e = (params.elevacionEjeGrados * Math.PI) / 180
  const az = (params.azimutEjeGrados * Math.PI) / 180
  const ax = Math.cos(e) * Math.cos(az)
  const ay = Math.sin(e)
  const azv = Math.cos(e) * Math.sin(az)

  // Vector de referencia para generar el plano. Se elige el eje del mundo
  // MENOS parecido al eje del disco: si se usara siempre +Y, con un disco
  // casi horizontal (eje casi vertical) la resta de abajo daría ~0 y la base
  // quedaría indefinida -- el clásico polo degenerado.
  const usarY = Math.abs(ay) < 0.9
  const rx = usarY ? 0 : 1
  const ry = usarY ? 1 : 0
  const rz = 0

  const proy = rx * ax + ry * ay + rz * azv
  let ux = rx - ax * proy
  let uy = ry - ay * proy
  let uz = rz - azv * proy
  const largo = Math.sqrt(ux * ux + uy * uy + uz * uz)
  ux /= largo
  uy /= largo
  uz /= largo

  // v = a x u, que ya sale unitario porque a y u son unitarios y ortogonales.
  const vx = ay * uz - azv * uy
  const vy = azv * ux - ax * uz
  const vz = ax * uy - ay * ux

  return { ax, ay, az: azv, ux, uy, uz, vx, vy, vz }
}

/** Cantidad de brazos del espiral. Dos es lo que se ve en la referencia y lo
 *  más común en una Sb barrada. */
const BRAZOS = 2

/**
 * Color del cielo para una dirección unitaria, en luz LINEAL.
 *
 * El orden de las capas está elegido para que el piso de luminancia sea una
 * PROPIEDAD ESTRUCTURAL y no un clamp final:
 *
 *   base   = degradado vertical entre horizonte / cenit / nadir  (>= piso)
 *   disco  = espiral logarítmica alrededor del eje de la galaxia
 *   polvo  = fBm que MULTIPLICA al disco y a la banda (nunca al base)
 *   color  = base + disco * (1 - polvo) * colorBrazo + núcleo + banda + estrellas
 *
 * La clave es que el polvo multiplica el APORTE de la nebulosa en vez de
 * restarse del total. Restándolo -- que es como se hace normalmente para
 * conseguir las vetas oscuras de la Vía Láctea -- las vetas se comen el
 * base y abren agujeros por debajo del piso, que es exactamente el agujero
 * negro que rompe la lectura de siluetas. Multiplicando, el peor caso del
 * polvo es dejar el base intacto: el piso no se puede violar por
 * construcción, y no hace falta ningún clamp que lo rescate.
 *
 * # Cómo entra una espiral entera en 0.23 de luminancia
 *
 * La referencia que pidió el dueño tiene núcleo blanco quemado (luminancia
 * ~1.0) y calles casi negras: reproducirla literalmente rompe el gate de
 * legibilidad, porque ESE es exactamente el contraste local que hace
 * desaparecer una silueta oscura. Lo que sí se puede copiar es su
 * ESTRUCTURA, y para eso cada capa está construida para gastar mucho croma y
 * poca luminancia:
 *
 *  - Los brazos suman magenta y azul con verde casi nulo. En Rec.709 el
 *    verde pesa 0.7152, así que un aporte sin verde mueve el tono muchísimo
 *    y el brillo casi nada.
 *  - Las bandas de polvo NO son negro: son la ausencia del aporte de color,
 *    o sea el degradado base asomando. Se leen como oscuras por contraste
 *    simultáneo contra el magenta de al lado, no por bajar de verdad.
 *  - El núcleo es el único aporte con verde, y por eso es el único racionado
 *    por el techo. Es además deliberadamente ANCHO (sigma 13 grados): la
 *    métrica que manda mide variación a 3.4 grados, y una gaussiana tan
 *    ancha es casi plana a esa escala aunque su amplitud total sea grande.
 */
export function colorDelCielo(
  dir: Vec3,
  params: ParamsCielo,
  out: ColorLineal,
  marco: MarcoGalaxia = marcoGalaxia(params),
): ColorLineal {
  const p = params.paleta

  // --- base: degradado vertical -------------------------------------------
  // Exponente 0.85: cerca de lineal. Con 0.65 (el primer intento) el color
  // de horizonte trepaba hasta bien arriba del domo y se comía al cenit,
  // que es lo que dejaba el cielo de un solo color.
  const alturaArriba = Math.pow(Math.max(0, dir.y), 0.85)
  const alturaAbajo = Math.pow(Math.max(0, -dir.y), 0.85)
  const destinoR = dir.y >= 0 ? p.cenit.r : p.nadir.r
  const destinoG = dir.y >= 0 ? p.cenit.g : p.nadir.g
  const destinoB = dir.y >= 0 ? p.cenit.b : p.nadir.b
  const t = dir.y >= 0 ? alturaArriba : alturaAbajo
  let r = interpolar(p.horizonte.r, destinoR, t)
  let g = interpolar(p.horizonte.g, destinoG, t)
  let b = interpolar(p.horizonte.b, destinoB, t)

  // --- disco espiral ------------------------------------------------------
  // Coordenadas polares EN EL PLANO DEL DISCO: theta es la distancia angular
  // al eje (el "radio" visto desde adentro del domo) y phi el ángulo
  // alrededor. Todo el resto del disco es una función de estos dos.
  const cosEje = Math.min(1, Math.max(-1, dir.x * marco.ax + dir.y * marco.ay + dir.z * marco.az))
  const theta = Math.acos(cosEje)
  const radioDisco = (params.radioDiscoGrados * Math.PI) / 180
  const rNorm = theta / radioDisco

  // Perfil radial: 1 en el centro, 0 pasado el borde del disco.
  // Perfil radial con MESETA: el disco mantiene amplitud plena hasta el 30%
  // del radio y recién ahí cae. Con la caída arrancando en el centro (el
  // primer intento, 1 - suavizar(rNorm)) los brazos exteriores quedaban a un
  // tercio de amplitud y el 70% del disco se leía como un lavado plano.
  const disco = 1 - suavizar(Math.min(1, Math.max(0, (rNorm - 0.3) / 0.7)))

  const pu = dir.x * marco.ux + dir.y * marco.uy + dir.z * marco.uz
  const pv = dir.x * marco.vx + dir.y * marco.vy + dir.z * marco.vz
  const phi = Math.atan2(pv, pu)

  // Espiral logarítmica: el lugar geométrico de un brazo es
  // phi - ln(r)/apertura = constante. El clamp de r no es cosmético -- en
  // r = 0 el logaritmo diverge y el espiral daría infinitas vueltas en el
  // centro, o sea aliasing puro justo donde va el núcleo.
  const rSeguro = Math.max(rNorm, 0.09)
  // El desorden de baja frecuencia es lo que separa esto de un espiral de
  // CAD: en la referencia los brazos están rotos, se bifurcan y cambian de
  // ancho. Sin este término se ve la fórmula.
  const desorden = fbm(dir.x * 1.6, dir.y * 1.6, dir.z * 1.6, params.semilla + 401, 3) * 0.85
  const fase = (phi - Math.log(rSeguro) / params.aperturaEspiral + desorden) * BRAZOS
  // Distancia al brazo más cercano, envuelta a [0, 1]: 0 sobre el eje del
  // brazo, 1 justo en el medio entre dos brazos.
  const envuelta = fase - 2 * Math.PI * Math.floor(fase / (2 * Math.PI) + 0.5)
  const distBrazo = Math.abs(envuelta) / Math.PI
  const enBrazo = 1 - suavizar(Math.min(1, distBrazo / Math.max(0.001, params.anchoBrazos)))

  // Grano: dos escalas. La gruesa (fBm ridged al cuadrado) hace los grumos
  // que se ven a simple vista; la fina rompe cada grumo para que de cerca no
  // sea una mancha lisa. Es la "estructura granular" de la referencia, y es
  // barata para el gate porque vive a una escala MUY por debajo de la
  // ventana de silueta: se promedia sola dentro de la ventana.
  const granoGrueso = fbmFilamentos(dir.x * 16, dir.y * 16, dir.z * 16, params.semilla + 911, 4)
  const granoFino = fbm(dir.x * 48, dir.y * 48, dir.z * 48, params.semilla + 1301, 3) * 0.5 + 0.5
  // El x3.4 y el clamp renormalizan: el fBm ridged al cuadrado tiene media
  // ~0.17, así que sin esto el grano no texturaba el brazo sino que lo
  // APAGABA a un sexto de su amplitud -- que es exactamente por qué la
  // primera versión de esta espiral era invisible en el render.
  const grano = Math.min(1, granoGrueso * granoGrueso * (0.42 + 0.58 * granoFino) * 3.4)

  // Polvo: manchas de baja frecuencia que ATENÚAN el aporte de color (ver el
  // comentario del bloque de arriba: multiplica, no resta). Son las bandas
  // oscuras entre brazos de la referencia.
  const polvoBruto = fbm(dir.x * 3.4, dir.y * 3.4, dir.z * 3.4, params.semilla + 173, 4)
  const polvo = Math.min(0.92, Math.max(0, polvoBruto * 0.8 + 0.42))

  // El brazo tiene un piso propio (0.22) y el grano modula el 78% restante:
  // así el brazo es CONTINUO y el grano lo textura, como en la referencia.
  // Multiplicando el brazo por el grano a secas el brazo se desintegra en
  // manchas sueltas y se pierde la lectura de espiral.
  //
  // Los brazos se apagan hacia el centro, donde manda el bulbo. No es sólo
  // fidelidad astronómica: adentro de `rSeguro` el logaritmo está clampeado,
  // así que la fase del espiral se congela y `enBrazo` pasa a depender sólo
  // de phi. Eso dibuja un molinete de lóbulos duros justo en el centro --
  // era el artefacto más visible del primer render.
  const interior = suavizar(Math.min(1, rNorm / 0.18))
  const brazos =
    interior * disco * enBrazo * (0.22 + 0.78 * grano) * (1 - polvo) * params.intensidadGalaxia
  // Resplandor difuso del disco entero, sin estructura de brazos: le da
  // cuerpo al espacio entre brazos para que no sea base pelada. Al cuadrado
  // para que se concentre hacia el centro.
  const difuso = disco * disco * 0.08 * (1 - polvo * 0.5) * params.intensidadGalaxia

  // Mezcla de color frío/cálido. El sesgo por radio copia la referencia:
  // azul y blanco hacia adentro, magenta rojizo hacia afuera.
  const mezclaBruta = fbm(dir.x * 2.2, dir.y * 2.2, dir.z * 2.2, params.semilla + 577, 3) * 0.5 + 0.5
  const mezcla = suavizar(Math.min(1, Math.max(0, mezclaBruta * 1.15 + rNorm * 0.35 - 0.28)))
  const brazoR = interpolar(p.brazoFrio.r, p.brazoCalido.r, mezcla)
  const brazoG = interpolar(p.brazoFrio.g, p.brazoCalido.g, mezcla)
  const brazoB = interpolar(p.brazoFrio.b, p.brazoCalido.b, mezcla)

  r += brazos * brazoR + difuso * p.brazoFrio.r
  g += brazos * brazoG + difuso * p.brazoFrio.g
  b += brazos * brazoB + difuso * p.brazoFrio.b

  // --- núcleo y bulbo -----------------------------------------------------
  // Gaussianas en theta. Anchas a propósito: ver el encabezado de la función.
  const sigmaNucleo = (params.radioNucleoGrados * Math.PI) / 180
  const tn = theta / sigmaNucleo
  // DOS gaussianas concéntricas y no una. Una sola de sigma 13 grados da una
  // loma suave que se lee como "zona más clara del cielo", no como núcleo:
  // lo que hace que algo se lea como núcleo es tener un PICO. La angosta
  // (0.45 del sigma, ~5.9 grados) pone ese pico, y sigue siendo casi el
  // doble de la ventana de silueta (3.4 grados), así que no puede aparecer
  // como un grumo del tamaño de un enemigo.
  const ti = theta / (sigmaNucleo * 0.45)
  const nucleo = (Math.exp(-tn * tn) * 0.6 + Math.exp(-ti * ti) * 0.55) * params.intensidadNucleo
  const tb = theta / (sigmaNucleo * 2.6)
  const bulbo = Math.exp(-tb * tb) * params.intensidadNucleo

  r += nucleo * p.nucleo.r + bulbo * p.bulbo.r
  g += nucleo * p.nucleo.g + bulbo * p.bulbo.g
  b += nucleo * p.nucleo.b + bulbo * p.bulbo.b

  // --- banda secundaria ---------------------------------------------------
  // Un gran círculo con otro eje que el disco: la galaxia de canto que cruza
  // en diagonal en la referencia. La pertenencia depende de la distancia al
  // PLANO cuya normal es `ejeBanda`.
  const inc = (params.inclinacionBandaGrados * Math.PI) / 180
  const giro = (params.giroBandaGrados * Math.PI) / 180
  const nx = Math.sin(inc) * Math.cos(giro)
  const ny = Math.cos(inc)
  const nz = Math.sin(inc) * Math.sin(giro)
  const distanciaPlano = Math.abs(dir.x * nx + dir.y * ny + dir.z * nz)

  // Deformar la distancia con ruido de baja frecuencia ANTES del falloff:
  // así el borde de la banda ondula en vez de ser un círculo perfecto.
  const ondulacion = fbm(dir.x * 1.7, dir.y * 1.7, dir.z * 1.7, params.semilla + 31, 3) * 0.1
  const dBanda = Math.max(0, distanciaPlano + ondulacion)
  const bordeBanda = Math.max(0.001, params.anchoBanda)
  const u = Math.min(1, dBanda / bordeBanda)
  const pertenencia = 1 - suavizar(u)

  const nucleoBanda = pertenencia * pertenencia * grano * (1 - polvo) * params.intensidadBanda
  const haloBanda = pertenencia * 0.45 * (1 - polvo * 0.6) * params.intensidadBanda

  r += nucleoBanda * p.brazoCalido.r + haloBanda * p.brazoFrio.r
  g += nucleoBanda * p.brazoCalido.g + haloBanda * p.brazoFrio.g
  b += nucleoBanda * p.brazoCalido.b + haloBanda * p.brazoFrio.b

  // --- estrellas ----------------------------------------------------------
  // Se suman en lineal a partir de un brillo objetivo en sRGB: sumar
  // directo en lineal hace que una estrella "media" desaparezca, porque el
  // ojo no es lineal.
  //
  // El refuerzo dentro de los brazos es lo que convierte al campo estelar en
  // parte de la galaxia en vez de un fondo pegado detrás: en la referencia
  // los brazos SON granos de estrellas. Se modula el BRILLO y no la
  // existencia de la estrella a propósito -- la existencia se decide por
  // celda de la grilla y el refuerzo se evalúa por texel, así que modularla
  // partiría al medio las estrellas que caen sobre el borde de un brazo.
  const refuerzo = 1 + 5.5 * (interior * disco * enBrazo * grano) + 1.2 * nucleo
  const e = estrellas(dir, params) * refuerzo
  if (e > 0) {
    const objetivo = srgbALineal(Math.min(1, e * params.brilloEstrellas))
    // Levemente azuladas/cálidas según la banda, para que no sean puntos
    // grises pegados sobre el púrpura.
    r += objetivo * 0.95
    g += objetivo * 0.93
    b += objetivo
  }

  out.r = r
  out.g = g
  out.b = b
  return out
}

// ---------------------------------------------------------------------------
// Horneado
// ---------------------------------------------------------------------------

/** Hornea una cara completa a RGBA8888 plano, listo para `encodePng`. */
export function hornearCara(cara: Cara, tamano: number, params: ParamsCielo): Uint8Array {
  const rgba = new Uint8Array(tamano * tamano * 4)
  const dir: Vec3 = { x: 0, y: 0, z: 0 }
  const color: ColorLineal = { r: 0, g: 0, b: 0 }
  // El marco del disco es constante para todo el horneado: calcularlo acá y
  // no adentro de colorDelCielo ahorra ~6 millones de llamadas a trigonometría
  // por cara que darían todas exactamente lo mismo.
  const marco = marcoGalaxia(params)

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      direccionDeTexel(cara, x, y, tamano, dir)
      normalizar(dir)
      colorDelCielo(dir, params, color, marco)
      const i = (y * tamano + x) * 4
      rgba[i] = Math.round(linealASrgb(color.r) * 255)
      rgba[i + 1] = Math.round(linealASrgb(color.g) * 255)
      rgba[i + 2] = Math.round(linealASrgb(color.b) * 255)
      rgba[i + 3] = 255
    }
  }
  return rgba
}

// ---------------------------------------------------------------------------
// Análisis de legibilidad
// ---------------------------------------------------------------------------

export interface AnalisisLegibilidad {
  /** Luminancia sRGB mínima sobre todos los texels de todas las caras.
   *  Las estrellas sólo suman, así que el mínimo no depende de ellas. */
  luminanciaMin: number
  /** Percentil 99.9 de la luminancia, estrellas incluidas. */
  luminanciaP999: number
  luminanciaMedia: number
  /**
   * Percentil 99.9 del contraste local a escala de silueta. LA métrica.
   *
   * Se define como |media(ventana de silueta) - media(ventana 3x)|: cuánto
   * se despega un parche del tamaño de un enemigo respecto del fondo que lo
   * rodea. Ver `analizarLegibilidad` para por qué NO es la desviación
   * estándar de la ventana.
   */
  contrasteLocalP999: number
  contrasteLocalMedio: number
  /**
   * Percentil 99.9 del contraste CROMÁTICO local, medido con exactamente el
   * mismo pasa-banda que `contrasteLocalP999` pero sobre los ejes oponentes
   * de color en vez de sobre la luminancia.
   *
   * Es la métrica que faltaba, y la que corresponde al defecto que se estaba
   * arreglando. El presupuesto de legibilidad sólo pone TECHOS: piso de
   * luminancia, techo de luminancia, techo de contraste local. Un cielo
   * completamente plano -- un degradado liso sin galaxia -- cumple los tres
   * con holgura y es exactamente lo que el dueño rechazó por "muy baja
   * calidad". O sea que sin esta métrica el conjunto de tests no puede
   * distinguir el cielo bueno del malo, y una regresión a lavanda plano
   * pasaría verde.
   *
   * Acá funciona como PISO: el cielo tiene que tener estructura cromática a
   * la escala de la silueta. Y como el par (croma alto, luminancia baja) es
   * justo la estrategia que permite meter una galaxia adentro de la ventana
   * de luminancia, medir las dos por separado convierte esa estrategia en un
   * invariante verificable en vez de un comentario.
   */
  contrasteCromaP999: number
  /** Fracción de texels que son estrella visible (para reportar densidad). */
  fraccionEstrellas: number
}

/**
 * Direcciones repartidas parejo sobre la esfera (espiral de Fibonacci).
 * Parejo POR ÁNGULO SÓLIDO, a diferencia de barrer lat/long, que amontona
 * muestras en los polos y subrepresenta el ecuador -- justo donde vive la
 * banda galáctica.
 */
export function direccionesFibonacci(cantidad: number): Vec3[] {
  const salida: Vec3[] = []
  const phi = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < cantidad; i++) {
    const y = 1 - (i / (cantidad - 1)) * 2
    const radio = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = phi * i
    salida.push({ x: Math.cos(theta) * radio, y, z: Math.sin(theta) * radio })
  }
  return salida
}

/**
 * Luminancia máxima del cielo SIN estrellas, muestreando direcciones.
 *
 * Existe separado del análisis por texel porque el techo es una restricción
 * sobre el CIELO, no sobre las estrellas: una estrella de 2 texels puede y
 * debe pasarse de 0.45, es un punto brillante y no compite con nada. Medir
 * el percentil 99.9 sobre los texels horneados no sirve para esto -- las
 * estrellas ocupan el 0.12% de los texels, o sea que el p99.9 cae JUSTO
 * adentro de la cola de estrellas y termina reportando el brillo de una
 * estrella disfrazado de brillo del cielo. Apagarlas es la única lectura
 * honesta.
 */
export function maxLuminanciaSinEstrellas(params: ParamsCielo, muestras = 20000): number {
  const sinEstrellas: ParamsCielo = { ...params, densidadEstrellas: 0 }
  const color: ColorLineal = { r: 0, g: 0, b: 0 }
  const marco = marcoGalaxia(sinEstrellas)
  let max = 0
  for (const dir of direccionesFibonacci(muestras)) {
    colorDelCielo(dir, sinEstrellas, color, marco)
    const l = luminanciaSrgb(linealASrgb(color.r), linealASrgb(color.g), linealASrgb(color.b))
    if (l > max) max = l
  }
  return max
}

function percentil(ordenado: Float64Array, p: number): number {
  const i = Math.min(ordenado.length - 1, Math.max(0, Math.round(p * (ordenado.length - 1))))
  return ordenado[i]
}

/**
 * Mide luminancia y contraste local de un conjunto de caras ya horneadas.
 *
 * # Por qué el contraste local NO es la desviación estándar de la ventana
 *
 * La primera versión de esta función medía la desviación estándar de la
 * luminancia en una ventana del tamaño de la silueta. Suena razonable y
 * está mal: la desviación estándar es CIEGA A LA ESCALA. Una estrella de 2
 * texels y un grumo de nebulosa que llena media ventana pueden dar la misma
 * desviación, y de hecho la métrica terminaba dominada por las estrellas --
 * medía densidad estelar disfrazada de contraste, y el gate se disparaba
 * por lo único que no molesta.
 *
 * Que una estrella no compita con una silueta no es una opinión: la silueta
 * tapa ~40x40 texels y la estrella ocupa 4 de esos 1600. No le rompe el
 * borde a nada.
 *
 * Lo que sí compite es que un parche del tamaño del enemigo se despegue en
 * brillo del fondo que lo rodea, porque eso es un borde a la misma escala
 * que el borde del enemigo. Así que la métrica es exactamente eso:
 *
 *     contraste local = |media(ventana W) - media(ventana 3W)|
 *
 * Es un pasa-banda centrado en la escala de la silueta. Una estrella se
 * diluye en las dos medias y no aporta (1600 texels de promedio contra 4).
 * Un degradado suave de horizonte a cenit tampoco: las dos ventanas están
 * centradas en el mismo punto, así que sus medias coinciden y la resta da
 * ~0. Un grumo de nebulosa a escala de silueta sube la media chica sin
 * mover la grande, y salta. Las tres cosas que la métrica tiene que hacer.
 *
 * Las dos medias salen de la misma imagen integral (summed-area table) en
 * tiempo constante por texel. La versión ingenua es O(texels * ventana^2),
 * o sea 6.3M * 1600 operaciones, que no termina.
 *
 * La ventana se recorta al borde de la cara en vez de saltar a la cara
 * vecina. Es una aproximación consciente: subestima el contraste de una
 * ventana justo sobre una arista. Como el diseño no tiene ninguna
 * discontinuidad en las aristas (todo sale de `colorDelCielo`), no hay nada
 * que esa aproximación pueda estar escondiendo.
 */
export function analizarLegibilidad(
  caras: ReadonlyMap<Cara, Uint8Array>,
  tamano: number,
): AnalisisLegibilidad {
  const ventana = Math.max(4, Math.round((VENTANA_SILUETA_TEXELS * tamano) / 1024))
  const totalTexels = tamano * tamano * caras.size

  const lums = new Float64Array(totalTexels)
  const stds = new Float64Array(totalTexels)
  const cromas = new Float64Array(totalTexels)
  let escritos = 0
  let escritosStd = 0
  let sumaLum = 0
  let estrellasContadas = 0

  /**
   * Construye la summed-area table de un canal y devuelve la media de una
   * ventana cuadrada centrada, recortada al borde de la cara, en O(1).
   *
   * Está factorizado porque ahora se aplica el MISMO pasa-banda a tres
   * canales (luminancia y los dos ejes oponentes de color): que la métrica
   * cromática y la de luminancia compartan exactamente el mismo operador es
   * lo que permite compararlas entre sí y afirmar "hay mucho más croma que
   * brillo a la escala de la silueta".
   */
  const hacerMediaVentana = (canal: Float64Array): ((x: number, y: number, lado: number) => number) => {
    const ancho = tamano + 1
    const sat = new Float64Array(ancho * (tamano + 1))
    for (let y = 0; y < tamano; y++) {
      for (let x = 0; x < tamano; x++) {
        const v = canal[y * tamano + x]
        const idx = (y + 1) * ancho + (x + 1)
        sat[idx] = v + sat[idx - 1] + sat[idx - ancho] - sat[idx - ancho - 1]
      }
    }
    return (x: number, y: number, lado: number): number => {
      const mitad = Math.floor(lado / 2)
      const x0 = Math.max(0, x - mitad)
      const y0 = Math.max(0, y - mitad)
      const x1 = Math.min(tamano, x - mitad + lado)
      const y1 = Math.min(tamano, y - mitad + lado)
      const n = (x1 - x0) * (y1 - y0)
      return (
        (sat[y1 * ancho + x1] - sat[y0 * ancho + x1] - sat[y1 * ancho + x0] + sat[y0 * ancho + x0]) / n
      )
    }
  }

  for (const rgba of caras.values()) {
    // Luminancia y ejes oponentes de color, por texel.
    //
    // Los ejes oponentes (rojo-verde y azul-amarillo) y no el tono en HSV: el
    // tono es un ángulo y se envuelve, así que promediarlo en una ventana da
    // basura cerca del rojo. Los ejes oponentes son cartesianos, se promedian
    // como cualquier número, y son además el modelo de cómo la visión humana
    // codifica el color aparte de la luminancia -- que es justo la separación
    // que este cielo explota.
    const lum = new Float64Array(tamano * tamano)
    const ejeRg = new Float64Array(tamano * tamano)
    const ejeAa = new Float64Array(tamano * tamano)
    for (let i = 0; i < tamano * tamano; i++) {
      const cr = rgba[i * 4] / 255
      const cg = rgba[i * 4 + 1] / 255
      const cb = rgba[i * 4 + 2] / 255
      const l = luminanciaSrgb(cr, cg, cb)
      lum[i] = l
      ejeRg[i] = cr - cg
      ejeAa[i] = cb - (cr + cg) / 2
      lums[escritos++] = l
      sumaLum += l
    }

    const mediaLum = hacerMediaVentana(lum)
    const mediaRg = hacerMediaVentana(ejeRg)
    const mediaAa = hacerMediaVentana(ejeAa)

    for (let y = 0; y < tamano; y++) {
      for (let x = 0; x < tamano; x++) {
        stds[escritosStd] = Math.abs(mediaLum(x, y, ventana) - mediaLum(x, y, ventana * 3))
        // Magnitud del desplazamiento cromático en el plano oponente: cuánto
        // CAMBIA el color de un parche del tamaño de un enemigo respecto de
        // su entorno, sin importar en qué dirección del plano lo haga.
        const dRg = mediaRg(x, y, ventana) - mediaRg(x, y, ventana * 3)
        const dAa = mediaAa(x, y, ventana) - mediaAa(x, y, ventana * 3)
        cromas[escritosStd] = Math.sqrt(dRg * dRg + dAa * dAa)
        escritosStd++
      }
    }

    // Una estrella se define acá como un texel bastante más claro que el
    // techo del cielo sin estrellas: sirve sólo para reportar densidad.
    for (let i = 0; i < tamano * tamano; i++) {
      if (lum[i] > LUMINANCIA_TECHO + 0.08) estrellasContadas++
    }
  }

  const lumsOrdenadas = lums.slice(0, escritos).sort()
  const stdsOrdenadas = stds.slice(0, escritosStd).sort()
  const cromasOrdenadas = cromas.slice(0, escritosStd).sort()

  return {
    luminanciaMin: lumsOrdenadas[0],
    luminanciaP999: percentil(lumsOrdenadas, 0.999),
    luminanciaMedia: sumaLum / escritos,
    contrasteLocalP999: percentil(stdsOrdenadas, 0.999),
    contrasteLocalMedio: stdsOrdenadas.reduce((a, b) => a + b, 0) / stdsOrdenadas.length,
    contrasteCromaP999: percentil(cromasOrdenadas, 0.999),
    fraccionEstrellas: estrellasContadas / totalTexels,
  }
}
