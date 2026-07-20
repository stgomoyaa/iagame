/**
 * Detección de la LÍNEA DE PUNTERÍA de un arma: dónde están sus miras.
 *
 * Por qué existe, y por qué no alcanzaba con el bounding box:
 *
 * Los 40 modelos CC0 del arsenal original no tienen mira — son siluetas
 * estilizadas con un riel vacío arriba. Por eso el ADS se "arregló" varias
 * veces moviendo números y ninguna funcionó: `seed.ts` alineaba el BORDE
 * SUPERIOR de la caja envolvente con el eje de la cámara, que en un modelo
 * sin mira es el techo del cajón de mecanismos y no tiene ninguna relación
 * con hacia dónde apunta el arma. No se puede alinear una geometría que no
 * existe.
 *
 * Los modelos de Source SÍ traen alza y punto de mira modelados. Este
 * archivo los encuentra, y con eso el ADS pasa de ser un ajuste a ojo a ser
 * una medición: la línea que une alza y punto de mira es, por definición del
 * arma real, la línea a la que va a salir la bala. Ponerla sobre el eje de
 * la cámara es literalmente apuntar.
 *
 * Geometría pura, igual que `geometry.ts`: entra un Float32Array de
 * posiciones YA normalizadas (boca hacia -Z, arriba +Y, centrado en el
 * origen por `buildNormalizeMatrix`) y salen números. No toca disco ni glTF,
 * así que se testea sin ningún modelo real.
 */

/**
 * Cómo apunta un arma. Es un dato DECLARADO por arma (ver
 * `src/game/weapons/source-catalog.ts`), no algo que se infiere de la malla,
 * y esa decisión es deliberada:
 *
 * Detectar "esto tiene una mira telescópica" por geometría se puede
 * aproximar (una óptica sobresale mucho más del cajón que un alza de
 * hierro), pero el umbral que las separa depende de la escala a la que se
 * normalizó cada clase, así que en centímetros absolutos las poblaciones se
 * solapan: el riel alto de una PDW sobresale casi tanto como un visor chico.
 * Un umbral que se equivoca no falla ruidosamente — deja el arma apuntando
 * al tubo del visor en vez de a través de él, y eso sólo se descubre
 * mirando. Como el catálogo de armas ya es una tabla explícita escrita a
 * mano, declarar el tipo de mira ahí cuesta una columna y elimina la
 * categoría entera de error.
 */
export type SightType = 'hierros' | 'optica'

export interface SightLine {
  /**
   * Altura (Y) del eje de puntería en el espacio normalizado del modelo.
   * Es lo que `adsOffset.y` tiene que compensar con signo opuesto para que
   * esa línea quede sobre el eje de la cámara.
   */
  height: number
  /** Desplazamiento lateral (X) del eje. En un arma sana es ~0; si sale
   *  grande, el modelo no está centrado sobre su propio cañón. */
  lateral: number
  /**
   * Z del elemento TRASERO de la mira (alza, u ocular del visor) en el
   * espacio del modelo. Es el punto donde se apoya el ojo, así que de acá
   * sale la distancia a la cámara en ADS — no del centro del modelo, que no
   * significa nada anatómicamente.
   */
  rearZ: number
  /** Z del elemento DELANTERO (punto de mira, u objetivo del visor). */
  frontZ: number
  /**
   * 0..1. Qué tan lejos están entre sí los dos elementos de la mira, como
   * fracción del largo del arma. Dos miras reales están separadas: el alza
   * atrás, el punto de mira sobre la boca. Si la detección devuelve los dos
   * en el mismo lugar es que encontró UN solo pico (un asa de transporte, un
   * riel parejo) y no una línea de puntería — confianza baja, revisar a
   * mano. Mismo criterio que `muzzleConfidence` en geometry.ts: el pipeline
   * no adivina en silencio, marca lo dudoso.
   */
  confidence: number
}

/**
 * Ancho de la franja central, como fracción del ancho total del arma, dentro
 * de la cual se busca la cresta de miras.
 *
 * Las miras viven sobre la línea central superior — es lo que las hace
 * miras: si estuvieran corridas de costado, apuntar con ellas desviaría el
 * tiro. Restringir la búsqueda a esa franja es lo que evita que un
 * manubrio de carga, un cargador curvo o un selector de tiro (todos altos,
 * todos descentrados) se hagan pasar por la mira. 20% es angosto para
 * excluir esas piezas y ancho para que ninguna rebanada quede sin vértices
 * en un modelo de ~3.000 triángulos.
 */
const SIGHT_STRIP_FRAC = 0.2

/** Semiancho mínimo de la franja, en metros. Una pistola normalizada mide
 *  ~3 cm de ancho y el 20% de eso son 3 mm de semiancho: con una malla de
 *  ~1.500 triángulos eso deja rebanadas sin ningún vértice. 4 mm es el piso
 *  para que la franja siempre agarre geometría sin dejar de ser "el centro". */
const SIGHT_STRIP_MIN_M = 0.004

/**
 * Semiancho de la ventana con la que se BUSCA la posición lateral de la
 * mira, más ancha que la franja con la que se mide su ALTURA. Son dos cosas
 * distintas y por eso son dos números:
 *
 * - La ALTURA se mide con la franja angosta, y tiene que seguir siéndolo:
 *   es lo único que impide que un manubrio de carga o un cargador curvo
 *   —altos y descentrados— se hagan pasar por la mira.
 * - La POSICIÓN lateral se busca con esta ventana más ancha, y no puede ser
 *   angosta: una franja de 6,7 mm de semiancho no puede encontrar una mira
 *   que está a 10 mm del centro de la caja, sencillamente porque no la
 *   contiene. Medido en el AK, esa era exactamente la situación, y la
 *   búsqueda se arrastraba de a poco sin llegar nunca (-2,6 -> -4,2 -> -4,9
 *   -> ... -> -8,0 mm y ahí se clavaba, contra los -10,1 reales).
 *
 * Ensanchar la ventana de búsqueda no reabre el agujero que cierra la franja
 * angosta, porque acá sólo entran vértices que ya están A LA ALTURA de la
 * cresta, y esa cresta la fijó la franja angosta. Una pieza descentrada que
 * no llega a esa altura queda afuera igual.
 */
const LATERAL_SEARCH_FRAC = 0.35

/**
 * Rebanadas a lo largo del cañón. Más que las 12 de `detectMuzzle` porque
 * acá no se mide una tendencia global (cañón vs culata) sino que se localiza
 * una pieza chica: con rebanadas gruesas, el alza y el cajón caen en la
 * misma y no se pueden separar. 24 da rebanadas de ~3,5 cm en un fusil de
 * 0,85 m, más finas que un alza real.
 */
const SIGHT_SLICES = 24

/**
 * Pasadas de refinamiento de la posición lateral de la franja.
 *
 * La franja arranca centrada en la caja envolvente porque no hay nada mejor
 * con qué arrancar, y ahí está la trampa: si la mira está más corrida que el
 * propio semiancho de la franja, la franja NO LA CONTIENE y lo que mide es
 * otra cosa. Medido en el AK: el manubrio de carga sale ~2 cm por la derecha,
 * así que el centro de la caja queda casi 1 cm a la derecha de la línea del
 * cañón, contra una franja de 6,7 mm de semiancho. La primera pasada veía un
 * pedazo del borde de la mira y devolvía -2,6 mm; recentrada ahí, la segunda
 * ya la ve entera.
 *
 * Cinco pasadas alcanzan: medido sobre el AK —el peor caso del lote, con el
 * manubrio de carga corriéndole el centro de la caja casi 1 cm— la
 * corrección se estabiliza en la cuarta (-5,5 -> -8,1 -> -9,6 -> -10,0 ->
 * -10,1 mm y ahí queda). No es un bucle hasta converger a propósito: un
 * número fijo de pasadas no puede quedarse dando vueltas con una malla
 * patológica.
 */
const LATERAL_PASSES = 5

/**
 * Tolerancia, en fracción de la altura del arma, para considerar que una
 * rebanada "está a la altura de la cresta".
 *
 * Alza y punto de mira son co-altos por diseño (si no lo fueran el arma
 * dispararía sistemáticamente alto o bajo), pero no idénticos al milímetro:
 * en los modelos medidos difieren entre 1 y 3 mm. Esta tolerancia es lo que
 * permite reconocer a los DOS como parte de la misma cresta en vez de quedarse
 * sólo con el que ganó por un pelo.
 */
const CREST_TOLERANCE_FRAC = 0.05

/** Perfil superior por rebanada dentro de la franja central. `-Infinity` en
 *  las rebanadas sin vértices (huecos del modelo, no piezas de altura cero). */
function topProfile(
  positions: Float32Array,
  minZ: number,
  spanZ: number,
  stripHalfWidth: number,
  centerX: number,
): Float32Array {
  const profile = new Float32Array(SIGHT_SLICES).fill(-Infinity)
  for (let i = 0; i < positions.length; i += 3) {
    if (Math.abs(positions[i] - centerX) > stripHalfWidth) continue
    const t = spanZ > 0 ? (positions[i + 2] - minZ) / spanZ : 0
    let s = Math.floor(t * SIGHT_SLICES)
    if (s >= SIGHT_SLICES) s = SIGHT_SLICES - 1
    if (s < 0) s = 0
    if (positions[i + 1] > profile[s]) profile[s] = positions[i + 1]
  }
  return profile
}

/**
 * Altura del CUERPO del arma bajo la mira: el techo del cajón de mecanismos,
 * que es contra lo que se mide cuánto sobresale una óptica.
 *
 * Lo obvio sería la mediana de las rebanadas, y fue lo primero que se probó:
 * está mal. Un visor telescópico ocupa un tercio largo del arma, así que en
 * cuanto la mitad de las rebanadas con vértices caen dentro del visor, la
 * mediana ES el visor y "cuánto sobresale" da cero. En el test sintético eso
 * daba el eje de puntería 4 cm arriba de donde va, apuntando al techo del
 * tubo — el mismo error que este archivo existe para evitar.
 *
 * En vez de un estadístico de posición se usa un CORTE: todo lo que esté por
 * encima del punto medio entre la rebanada más baja y la cresta es "la
 * mira", y el cuerpo es lo más alto de lo que queda. Es robusto a que la
 * mira ocupe media arma —que es justamente el caso que rompía la mediana— y
 * no depende de cuántas rebanadas tenga cada zona.
 */
function bodyTopBelowSight(profile: Float32Array, crest: number): number {
  let lowest = Infinity
  for (const v of profile) if (v !== -Infinity && v < lowest) lowest = v
  if (lowest === Infinity) return 0

  const corte = (lowest + crest) / 2
  let top = lowest
  for (const v of profile) if (v !== -Infinity && v <= corte && v > top) top = v
  return top
}

/**
 * Encuentra la línea de puntería de un modelo ya normalizado.
 *
 * Para HIERROS: la línea pasa por la cresta. El punto de mira y el alza son
 * los dos puntos más altos de la franja central, uno cerca de la boca y otro
 * cerca del cajón, y son co-altos; la altura de esa cresta ES la altura del
 * ojo. Poner la cresta en el eje de la cámara deja todo el cuerpo del arma
 * por debajo — que es exactamente el criterio de "no tapar el punto al que
 * apuntás".
 *
 * Para ÓPTICA: el ojo no mira POR ENCIMA del visor sino A TRAVÉS del tubo,
 * así que la línea no es la cresta sino el EJE del tubo, y se lo estima como
 * el punto medio entre la cresta y el techo del cuerpo (ver el detalle abajo,
 * en la propia rama). Usar la cresta acá sería el mismo error que este
 * archivo vino a corregir, sólo que 3 cm más arriba: la cruceta terminaría
 * apoyada sobre el techo del visor en vez de dentro de él.
 */
export function detectSightLine(positions: Float32Array, sight: SightType): SightLine {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let i = 0; i < positions.length; i += 3) {
    if (positions[i] < minX) minX = positions[i]
    if (positions[i] > maxX) maxX = positions[i]
    if (positions[i + 1] < minY) minY = positions[i + 1]
    if (positions[i + 1] > maxY) maxY = positions[i + 1]
    if (positions[i + 2] < minZ) minZ = positions[i + 2]
    if (positions[i + 2] > maxZ) maxZ = positions[i + 2]
  }

  // Piso absoluto además de la fracción: en un arma angosta (una pistola
  // normalizada mide ~3 cm de ancho) el 20% son 3 mm de semiancho, y con una
  // malla de ~1.500 triángulos eso deja rebanadas enteras sin ningún vértice.
  const stripHalfWidth = Math.max(((maxX - minX) * SIGHT_STRIP_FRAC) / 2, SIGHT_STRIP_MIN_M)
  const searchHalfWidth = Math.max(((maxX - minX) * LATERAL_SEARCH_FRAC) / 2, SIGHT_STRIP_MIN_M)
  const spanZ = maxZ - minZ
  const spanY = maxY - minY
  const tolerance = spanY * CREST_TOLERANCE_FRAC
  const sliceZ = (s: number): number => minZ + ((s + 0.5) / SIGHT_SLICES) * spanZ

  // Arranca en el centro de la caja y se va corrigiendo hacia la mira real.
  // Ver LATERAL_PASSES.
  let centerX = (minX + maxX) / 2
  let profile = topProfile(positions, minZ, spanZ, stripHalfWidth, centerX)
  let crest = -Infinity

  for (let pass = 0; pass < LATERAL_PASSES; pass++) {
    profile = topProfile(positions, minZ, spanZ, stripHalfWidth, centerX)
    crest = -Infinity
    for (const v of profile) if (v > crest) crest = v
    if (crest === -Infinity) break

    // X de la mira: promedio de los vértices que están A LA ALTURA de la
    // cresta. NO es el centro de la caja envolvente, y la diferencia se ve en
    // pantalla: un arma real es asimétrica de costado (el manubrio de carga
    // de un AK sale por la derecha, la ventana de expulsión también), así que
    // el centro de la caja queda corrido hacia ese lado y la línea del cañón
    // NO pasa por él. Alineando el ADS al centro de la caja el arma entera
    // queda a la izquierda de la cruceta — medido en el navegador antes de
    // este cambio: ~9 px sobre 1280, chico pero perfectamente visible cuando
    // estás mirando justo ahí. El punto de mira, en cambio, sí está sobre el
    // eje del cañón por definición: para eso es el punto de mira.
    let sum = 0
    let count = 0
    for (let i = 0; i < positions.length; i += 3) {
      if (Math.abs(positions[i] - centerX) > searchHalfWidth) continue
      if (positions[i + 1] < crest - tolerance) continue
      sum += positions[i]
      count++
    }
    if (count === 0) break
    centerX = sum / count
  }

  // Sin ningún vértice en la franja central no hay nada que medir: se cae al
  // borde superior de la caja (el comportamiento viejo) con confianza 0, que
  // es la señal de "revisar a mano", no un valor que aparente ser bueno.
  if (crest === -Infinity) {
    return { height: maxY, lateral: 0, rearZ: 0, frontZ: 0, confidence: 0 }
  }

  // Delantero y trasero de la cresta. El modelo normalizado apunta a -Z, así
  // que la rebanada 0 es la BOCA y la última es la culata: "delante" es el
  // índice más chico.
  let frontSlice = -1
  let rearSlice = -1
  for (let s = 0; s < SIGHT_SLICES; s++) {
    if (profile[s] === -Infinity) continue
    if (profile[s] >= crest - tolerance) {
      if (frontSlice === -1) frontSlice = s
      rearSlice = s
    }
  }

  const frontZ = sliceZ(frontSlice)
  const rearZ = sliceZ(rearSlice)
  // Separación entre los dos elementos como fracción del largo. Ver el
  // comentario de `confidence` en la interfaz.
  const confidence = spanZ > 0 ? (rearZ - frontZ) / spanZ : 0

  if (sight === 'hierros') {
    return { height: crest, lateral: centerX, rearZ, frontZ, confidence }
  }

  // Óptica: el ojo mira A TRAVÉS del tubo, así que la línea es su eje, no su
  // techo. El eje se estima como el punto medio entre la cresta (techo del
  // tubo) y el techo del cuerpo del arma (base sobre la que se monta): en un
  // visor real esos dos puntos son el techo y el piso de "todo lo que
  // sobresale", y su centro cae dentro del tubo. No es exacto —la montura
  // ocupa parte de ese espacio, así que el eje estimado queda un poco por
  // debajo del real— y no hace falta que lo sea: lo que tiene que garantizar
  // es que la cruceta caiga DENTRO del tubo y no encima, y eso lo cumple con
  // margen para cualquier montura que no sea más alta que el propio visor.
  return {
    height: (crest + bodyTopBelowSight(profile, crest)) / 2,
    lateral: centerX,
    rearZ,
    frontZ,
    confidence,
  }
}
