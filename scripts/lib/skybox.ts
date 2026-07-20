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
  /** Color del núcleo de la banda galáctica. Se SUMA al base. */
  nebulosaCalida: ColorLineal
  /** Color de los bordes de la banda. Se SUMA al base. */
  nebulosaFria: ColorLineal
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
  // sRGB (0.34, 0.13, 0.29) de aporte -- magenta del núcleo.
  nebulosaCalida: { r: srgbALineal(0.34), g: srgbALineal(0.13), b: srgbALineal(0.29) },
  // sRGB (0.06, 0.10, 0.30) de aporte -- azul frío de los bordes. Casi sin
  // rojo: es lo que separa el borde del núcleo por tono en vez de por brillo.
  nebulosaFria: { r: srgbALineal(0.06), g: srgbALineal(0.1), b: srgbALineal(0.3) },
}

export interface ParamsCielo {
  paleta: PaletaCielo
  semilla: number
  /** Inclinación de la banda galáctica en grados sobre el horizonte. Una
   *  banda horizontal se lee como niebla; inclinada se lee como galaxia. */
  inclinacionBandaGrados: number
  /** Giro de la banda alrededor del eje vertical, en grados. */
  giroBandaGrados: number
  /** Ancho angular de la banda (0-1, fracción del hemisferio). */
  anchoBanda: number
  /** Intensidad de la nebulosa. 1 = paleta tal cual. */
  intensidadNebulosa: number
  /** Densidad de estrellas: probabilidad de que una celda de la grilla
   *  estelar tenga una. */
  densidadEstrellas: number
  /** Brillo máximo de una estrella, en sRGB codificado. */
  brilloEstrellas: number
}

export const PARAMS_POR_DEFECTO: ParamsCielo = {
  paleta: PALETA_GALAXIA_PURPURA,
  semilla: 0x9e3779b9,
  // 38 grados: con la banda casi horizontal (el primer intento, 24) el
  // resultado se lee como neblina sobre el horizonte y no como una galaxia.
  // Hace falta que CORTE el encuadre en diagonal para leerse como un disco
  // visto de canto.
  inclinacionBandaGrados: 38,
  giroBandaGrados: 35,
  // 0.30 y no 0.42: a 0.42 la banda cubre casi todo el domo y deja de ser
  // un rasgo -- el cielo entero es "banda" y no se distingue de su fondo.
  anchoBanda: 0.3,
  intensidadNebulosa: 1,
  // 0.035 da ~1600 estrellas en todo el domo, del orden de las ~3000 que se
  // ven a ojo desnudo en un cielo oscuro. El primer intento, 0.16, ponía
  // 7200: más del doble de un cielo real, y a esa densidad no se leen como
  // estrellas sino como estática de televisor. Es además ruido de alta
  // frecuencia justo en el canal de luminancia, o sea el peor tipo de
  // basura visual para distinguir siluetas.
  densidadEstrellas: 0.035,
  brilloEstrellas: 0.85,
}

/** Escala de la grilla estelar: cuántas celdas por radio unitario. Más alto
 *  = estrellas más chicas y más juntas. */
const ESCALA_ESTRELLAS = 46

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
        const radio = 0.16 + ((h >>> 16) & 0xff) / 0xff * 0.22
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
 * Color del cielo para una dirección unitaria, en luz LINEAL.
 *
 * El orden de las capas está elegido para que el piso de luminancia sea una
 * PROPIEDAD ESTRUCTURAL y no un clamp final:
 *
 *   base  = degradado vertical entre horizonte / cenit / nadir  (>= piso)
 *   banda = pertenencia a la banda galáctica, modulada por fBm
 *   polvo = fBm que MULTIPLICA a la banda (nunca al base)
 *   color = base + banda * (1 - polvo) * paletaNebulosa + estrellas
 *
 * La clave es que el polvo multiplica el APORTE de la nebulosa en vez de
 * restarse del total. Restándolo -- que es como se hace normalmente para
 * conseguir las vetas oscuras de la Vía Láctea -- las vetas se comen el
 * base y abren agujeros por debajo del piso, que es exactamente el agujero
 * negro que rompe la lectura de siluetas. Multiplicando, el peor caso del
 * polvo es dejar el base intacto: el piso no se puede violar por
 * construcción, y no hace falta ningún clamp que lo rescate.
 */
export function colorDelCielo(dir: Vec3, params: ParamsCielo, out: ColorLineal): ColorLineal {
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

  // --- banda galáctica ----------------------------------------------------
  // La banda es un gran círculo: la pertenencia depende de la distancia al
  // PLANO cuya normal es `ejeBanda`. Inclinación y giro sólo orientan esa
  // normal.
  const inc = (params.inclinacionBandaGrados * Math.PI) / 180
  const giro = (params.giroBandaGrados * Math.PI) / 180
  const nx = Math.sin(inc) * Math.cos(giro)
  const ny = Math.cos(inc)
  const nz = Math.sin(inc) * Math.sin(giro)
  const distanciaPlano = Math.abs(dir.x * nx + dir.y * ny + dir.z * nz)

  // Deformar la distancia con ruido de baja frecuencia ANTES del falloff:
  // así el borde de la banda ondula en vez de ser un círculo perfecto.
  const ondulacion = fbm(dir.x * 1.7, dir.y * 1.7, dir.z * 1.7, params.semilla + 31, 3) * 0.16
  const dBanda = Math.max(0, distanciaPlano + ondulacion)
  // Falloff suave (smoothstep invertido) del centro de la banda al borde.
  const bordeBanda = Math.max(0.001, params.anchoBanda)
  const u = Math.min(1, dBanda / bordeBanda)
  const pertenencia = 1 - suavizar(u)

  // Estructura interna: filamentos. El fBm ridged sale con la masa apiñada
  // alrededor de 0.5; elevarlo al cuadrado abre esa distribución y separa
  // los filamentos del gas de fondo, que es lo que hace que la banda se lea
  // como estructura y no como una mancha uniforme.
  const filamentosBrutos = fbmFilamentos(dir.x * 3.1, dir.y * 3.1, dir.z * 3.1, params.semilla + 91, 4)
  const filamentos = filamentosBrutos * filamentosBrutos
  // Polvo: manchas de baja frecuencia que ATENÚAN la nebulosa (ver el
  // comentario del bloque de arriba: multiplica, no resta).
  const polvoBruto = fbm(dir.x * 2.4, dir.y * 2.4, dir.z * 2.4, params.semilla + 173, 4)
  const polvo = Math.min(0.85, Math.max(0, polvoBruto * 0.5 + 0.42))

  const nucleo = pertenencia * pertenencia * filamentos * (1 - polvo) * params.intensidadNebulosa
  const halo = pertenencia * 0.5 * (1 - polvo * 0.6) * params.intensidadNebulosa

  r += nucleo * p.nebulosaCalida.r + halo * p.nebulosaFria.r
  g += nucleo * p.nebulosaCalida.g + halo * p.nebulosaFria.g
  b += nucleo * p.nebulosaCalida.b + halo * p.nebulosaFria.b

  // --- estrellas ----------------------------------------------------------
  // Se suman en lineal a partir de un brillo objetivo en sRGB: sumar
  // directo en lineal hace que una estrella "media" desaparezca, porque el
  // ojo no es lineal.
  const e = estrellas(dir, params)
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

  for (let y = 0; y < tamano; y++) {
    for (let x = 0; x < tamano; x++) {
      direccionDeTexel(cara, x, y, tamano, dir)
      normalizar(dir)
      colorDelCielo(dir, params, color)
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
  let max = 0
  for (const dir of direccionesFibonacci(muestras)) {
    colorDelCielo(dir, sinEstrellas, color)
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
  let escritos = 0
  let escritosStd = 0
  let sumaLum = 0
  let estrellasContadas = 0

  for (const rgba of caras.values()) {
    // Luminancia por texel.
    const lum = new Float64Array(tamano * tamano)
    for (let i = 0; i < tamano * tamano; i++) {
      const l = luminanciaSrgb(rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255)
      lum[i] = l
      lums[escritos++] = l
      sumaLum += l
    }

    // Summed-area table de la luminancia, con una fila/columna de ceros
    // adelante para no tener que ramificar en los bordes.
    const ancho = tamano + 1
    const sat = new Float64Array(ancho * (tamano + 1))
    for (let y = 0; y < tamano; y++) {
      for (let x = 0; x < tamano; x++) {
        const l = lum[y * tamano + x]
        const idx = (y + 1) * ancho + (x + 1)
        sat[idx] = l + sat[idx - 1] + sat[idx - ancho] - sat[idx - ancho - 1]
      }
    }

    /** Media de la ventana cuadrada de lado `lado` centrada en (x, y),
     *  recortada al borde de la cara. O(1) gracias a la SAT. */
    const mediaVentana = (x: number, y: number, lado: number): number => {
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

    for (let y = 0; y < tamano; y++) {
      for (let x = 0; x < tamano; x++) {
        const parche = mediaVentana(x, y, ventana)
        const fondo = mediaVentana(x, y, ventana * 3)
        stds[escritosStd++] = Math.abs(parche - fondo)
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

  return {
    luminanciaMin: lumsOrdenadas[0],
    luminanciaP999: percentil(lumsOrdenadas, 0.999),
    luminanciaMedia: sumaLum / escritos,
    contrasteLocalP999: percentil(stdsOrdenadas, 0.999),
    contrasteLocalMedio: stdsOrdenadas.reduce((a, b) => a + b, 0) / stdsOrdenadas.length,
    fraccionEstrellas: estrellasContadas / totalTexels,
  }
}
