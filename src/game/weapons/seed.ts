/**
 * Offsets heurísticos por defecto para `hipOffset` y `adsOffset`, derivados
 * del bounding box de cada modelo en `public/assets/weapons/index.json`.
 *
 * Son puntos de partida, no valores finales. El panel de tuning en vivo
 * (sección 6.4 del spec) los pisa cuando alguien los ajusta a mano, y
 * `weapons_tuning.json` prevalece sobre lo que devuelve este archivo. El
 * objetivo es que las 40 armas sean usables el día que el pipeline las
 * convierte, sin que nadie haya tocado nada todavía.
 */

export interface WeaponBounds {
  min: number[]
  max: number[]
}

/** Forma de una entrada de index.json. Ver scripts/convert-weapons.ts. */
export interface WeaponIndexEntry {
  slug: string
  name: string
  triangles: number
  bounds: WeaponBounds
  muzzleConfidence: number
  upAxisConfidence: number
  needsManualReview: boolean
}

/** Posición (metros) + rotación (radianes) de una pose del viewmodel. */
export interface Transform {
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
}

// El offset de cadera ya NO escala linealmente con el tamaño del arma
// (bug anterior: HIP_BACK_FRAC * size ponía a un rifle de 0.85m a más de un
// metro de la cámara, literalmente flotando lejos en vez de leerse como
// sostenido). Un viewmodel vive a la distancia del brazo del jugador —la
// que fija el hombro/codo/muñeca, no el largo del cañón—, así que esa
// distancia es CASI la misma para una pistola de 0.22m que para un rifle
// de 0.85m. HIP_ARM_* es esa constante: el punto de partida "brazo
// extendido", igual para cualquier arma.
//
// Pero no es EXACTAMENTE la misma, y ahí entra la corrección de tamaño que
// sí depende de `size` — con el signo opuesto al que tenía el código viejo.
// Los modelos están centrados en el origen de su bounding box (ver
// characteristicSize), pero la culata/empuñadura de un arma no vive en ese
// centro: vive corrida hacia +Z (el lado del jugador, porque el cañón
// normalizado apunta a -Z). En una pistola chica esa distancia
// centro-a-culata es de pocos centímetros; en un rifle es varios
// centímetros más. Si el offset fuera constante para todas las armas, la
// culata del rifle (más lejos de su propio centro) quedaría más cerca de
// la cámara que la de la pistola, no a la misma distancia de la mano. Para
// mantener la culata —no el centro del modelo— a una distancia pareja de
// la cámara, el offset del CENTRO tiene que crecer un poco con el tamaño:
// HIP_SIZE_*_FRAC son fracciones chicas de `size` que compensan sólo ese
// desfasaje centro-culata, no el largo completo del arma. Por eso el
// coeficiente de HIP_SIZE_BACK_FRAC (~0.59) es la mitad del HIP_BACK_FRAC
// viejo (1.25) y, a diferencia de aquel, no es la única fuente de la
// distancia: HIP_ARM_BACK aporta la mayor parte incluso a size=0.
//
// Los cuatro números por eje (HIP_ARM_* y HIP_SIZE_*_FRAC) salen de dos
// anclas verificadas a ojo en el navegador con `?debug=1` arrastrando los
// sliders hasta que la pose se lee como sostenida (culata visible abajo a
// la derecha, cañón apuntando hacia el centro de la pantalla, arma entera
// en cuadro): pistol-1 (size 0.22) en x=0.15/y=-0.12/z=0.35 y
// assaultrifle-2 (size 0.85, elegida por tener el perfil limpio de las dos
// AR de referencia — ver rotationOffset más abajo) en x=0.22/y=-0.16/z=0.72,
// más una tercera arma (bullpup-1, size 0.65) usada sólo para confirmar que
// la recta que pasa por esos dos puntos generaliza al tercer tamaño de la
// familia, no para ajustar los coeficientes. Ajuste lineal (offset = ARM +
// size * SIZE_FRAC) resuelto por esos dos puntos:
const HIP_ARM_RIGHT = 0.13
const HIP_ARM_DOWN = 0.11
const HIP_ARM_BACK = 0.22
const HIP_SIZE_RIGHT_FRAC = 0.11
const HIP_SIZE_DOWN_FRAC = 0.06
const HIP_SIZE_BACK_FRAC = 0.59

// ADS_PULL_BACK: cuántos metros se acerca el CENTRO del arma a la cámara al
// pasar de cadera a mira (ver seedAdsOffset.z más abajo). No es una fracción
// de `size` como el heurístico viejo (ADS_FORWARD_FRAC * size, que además
// tenía el signo de adsOffset.y invertido -ver comentario de
// seedAdsOffset-): hombrear el arma es un gesto del brazo -acercar la culata
// a la cara-, y esa distancia es prácticamente la misma sea cual sea el
// arma, igual que HIP_ARM_BACK es constante y no escala con `size` (ver el
// comentario de esas constantes más arriba). El valor sale del único punto
// de datos real y verificado a ojo que existe: Santiago ajustó
// assaultrifle-1 en el navegador hasta que la mira quedó sobre la cruceta,
// y llegó a hipOffset.z = 0.665 / adsOffset.z = 0.495 -> 0.665 - 0.495 =
// 0.17. Si algún día se agrega una segunda arma tuneada a mano, conviene
// repetir esta resta y promediar en vez de confiar en un solo punto.
const ADS_PULL_BACK = 0.17

/**
 * Tamaño característico del modelo: el eje más largo de su bounding box.
 * Usar un solo número (en vez de escalar cada eje por su propia
 * dimensión) evita offsets asimétricos raros cuando un modelo es más ancho
 * que alto o viceversa; lo que importa para la pose es "cuán grande es
 * este objeto en general", y el eje más largo lo resume bien porque en
 * armas siempre es el largo del cañón.
 */
function characteristicSize(bounds: WeaponBounds): number {
  const sizeX = bounds.max[0] - bounds.min[0]
  const sizeY = bounds.max[1] - bounds.min[1]
  const sizeZ = bounds.max[2] - bounds.min[2]
  return Math.max(sizeX, sizeY, sizeZ)
}

/**
 * Pose de cadera: abajo y a la derecha del centro del modelo, tirada hacia
 * la cámara (+Z, porque el cañón normalizado apunta a -Z, así que +Z es
 * "hacia el jugador"). Es la pose de "cargar el arma a la cadera" clásica
 * de un shooter en primera persona: el arma no tapa el centro de la
 * pantalla y queda visible en el cuadrante inferior derecho.
 *
 * Cada eje es "distancia de brazo" (HIP_ARM_*, igual para toda arma) más
 * una corrección chica proporcional al tamaño (HIP_SIZE_*_FRAC, ver el
 * comentario de las constantes) — no un escalado puro por tamaño como
 * antes, que alejaba un rifle grande de la cámara muy por encima de lo que
 * el brazo del jugador podría sostener.
 */
export function seedHipOffset(entry: WeaponIndexEntry): Transform {
  const { bounds } = entry
  const centerX = (bounds.min[0] + bounds.max[0]) / 2
  const centerY = (bounds.min[1] + bounds.max[1]) / 2
  const centerZ = (bounds.min[2] + bounds.max[2]) / 2
  const size = characteristicSize(bounds)

  return {
    x: centerX + HIP_ARM_RIGHT + size * HIP_SIZE_RIGHT_FRAC,
    y: centerY - HIP_ARM_DOWN - size * HIP_SIZE_DOWN_FRAC,
    z: centerZ + HIP_ARM_BACK + size * HIP_SIZE_BACK_FRAC,
    rx: 0,
    ry: 0,
    rz: 0,
  }
}

/**
 * Pose de apuntado (ADS): el modelo se centra en el eje de la cámara, tanto
 * horizontal (x = 0) como VERTICALMENTE -y ahí está la corrección de esta
 * función. Los modelos están centrados en el origen de su bounding box (ver
 * el comentario de arriba del archivo), pero las miras -postas de hierro o
 * punto rojo- viven montadas ARRIBA del cuerpo del arma, no en ese centro:
 * están a `sizeY / 2` por encima del centro, en el borde superior del
 * bounding box o cerca de él. Si el CENTRO del modelo se pusiera en el eje
 * de la cámara (y = 0, que es lo que hacía la versión vieja de esta
 * función, con signo positivo), la mira -que cuelga por encima de ese
 * centro- queda por ENCIMA de la cruceta, y es el CUERPO del arma el que
 * quedó centrado y tapando el punto de mira. Exactamente el bug que motivó
 * este fix: el arma "apuntando" con la cruceta enterrada en el cajón de
 * mecanismos, no en la mira.
 *
 * La corrección es bajar el centro del modelo esa misma distancia: para que
 * la mira -no el centro del modelo- caiga en el eje de la cámara, el centro
 * tiene que quedar `sizeY / 2` por DEBAJO de ese eje, es decir
 * y = -(sizeY / 2). Verificado con el único punto de datos real que hay:
 * Santiago ajustó assaultrifle-1 a mano en el navegador hasta que la mira
 * se leía centrada en la cruceta, y llegó a adsOffset.y = -0.175. La mitad
 * de la altura de ese modelo (sizeY = 0.345m, ver bounds en index.json) da
 * -0.1725: 1.4% de diferencia, dentro de lo esperable porque la mira real
 * no vive exactamente en el borde superior del bounding box sino un poco
 * por debajo. Este valor geométrico es el punto de partida; el panel de
 * tuning (o weapons_tuning.json) sigue siendo quien corrige ese margen a
 * mano por arma si hace falta -por eso "roughly", no "exactamente".
 *
 * En Z, ADS acerca el arma a la cámara -se hombrea, en vez de sostenerse
 * con el brazo extendido- así que se resta ADS_PULL_BACK (constante, ver
 * arriba) de la Z DE CADERA de esta misma arma, no de una fracción de
 * `size` independiente de esa pose como hacía la versión vieja. Un rifle
 * con la culata más lejos en cadera también la tiene más lejos en ADS, en
 * la misma proporción de "se acercó al hombro" que cualquier otra arma.
 */
export function seedAdsOffset(entry: WeaponIndexEntry): Transform {
  const { bounds } = entry
  const sizeY = bounds.max[1] - bounds.min[1]
  const hipZ = seedHipOffset(entry).z

  return {
    x: 0,
    y: -(sizeY / 2),
    z: hipZ - ADS_PULL_BACK,
    rx: 0,
    ry: 0,
    rz: 0,
  }
}

/** Conveniencia: ambas poses de una sola pasada sobre el bounding box. */
export function seedWeaponOffsets(entry: WeaponIndexEntry): {
  hipOffset: Transform
  adsOffset: Transform
} {
  return { hipOffset: seedHipOffset(entry), adsOffset: seedAdsOffset(entry) }
}
