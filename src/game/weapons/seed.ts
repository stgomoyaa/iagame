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

/**
 * De dónde salió el modelo de un arma. No es cosmético: decide de qué
 * carpeta se baja el .glb y qué armas existen en un build publicado (ver
 * `registry.ts` y docs/WORKSHOP.md).
 *
 * - `cc0`: pack CC0, vive en `public/assets/weapons/`, se commitea, se
 *   publica.
 * - `local`: derivado del Workshop, vive en `public/assets/weapons-local/`,
 *   gitignoreado, nunca se publica.
 */
export type WeaponOrigin = 'cc0' | 'local'

/** Forma de una entrada de index.json. Ver scripts/convert-weapons.ts. */
export interface WeaponIndexEntry {
  slug: string
  name: string
  triangles: number
  bounds: WeaponBounds
  muzzleConfidence: number
  upAxisConfidence: number
  needsManualReview: boolean
  /** Procedencia. Los índices CC0 en disco no la traen (son anteriores a que
   *  existiera la distinción); el registry se la pone al cargarlos. */
  origin: WeaponOrigin
  /**
   * Altura (Y, espacio del modelo) de la línea de puntería real del arma:
   * alza y punto de mira, o el eje del tubo si tiene óptica. La produce
   * `scripts/lib/sight.ts` y SÓLO existe en los modelos que tienen mira
   * modelada. Su ausencia no es un dato faltante que haya que rellenar: es
   * la afirmación "este modelo no tiene mira", que es literalmente el caso
   * de las 40 armas CC0. Ver `seedAdsOffset`.
   */
  sightHeight?: number
  /** Desplazamiento lateral de esa línea. Mismo origen y misma condición. */
  sightLateral?: number
  /**
   * Profundidad (Z, espacio del modelo) del elemento TRASERO de la mira: el
   * alza, por donde entra el ojo. El modelo apunta a -Z, así que el alza cae
   * hacia +Z (lado del jugador). La mide el pipeline (`SightLine.rearZ`) y
   * SÓLO existe en los modelos de mundo con mira medida (el pack de COD). En
   * un modelo con la caja simétrica —todos los `c_` de COD salen centrados de
   * `buildNormalizeMatrix`— el `bounds` no dice dónde está el alza; este campo
   * sí. Ver `seedAdsOffset`: es lo que ancla el alza cerca del ojo en ADS.
   */
  sightRearZ?: number
  /** Profundidad del elemento DELANTERO de la mira (punto de mira, hacia -Z).
   *  Mismo origen. La usa `vfx.ts` como boca de cañón cuando no hay tag_flash. */
  sightFrontZ?: number
  /**
   * Boca de cañón en el espacio del modelo: de dónde nace el fogonazo. La mide
   * el pipeline (`muzzleFromGeometry`, centroide del frente del arma) y SÓLO
   * existe en los modelos de mundo del pack de COD. Su ausencia (CS y CC0) hace
   * que el renderer caiga a su heurístico de caja, que en esos casos —CS son
   * viewmodels con brazos, donde el centroide del frente no es confiable— es lo
   * correcto. Ver `feedback/vfx-renderer.ts`. El fogonazo salía "desde abajo"
   * porque el heurístico ponía la boca en el CENTRO vertical de la caja, y el
   * cañón no vive ahí.
   */
  muzzleX?: number
  muzzleY?: number
  muzzleZ?: number
  /**
   * El `.glb` es un VIEWMODEL de Source (`v_`): trae esqueleto, brazos
   * modelados y las secuencias originales del juego.
   *
   * Cambia de raíz cómo se posa el arma, y por eso vive acá y no sólo en el
   * renderer. Un modelo de mundo (`w_`) es un objeto suelto centrado en su
   * bounding box, y las poses de cadera y mira son la respuesta a "dónde
   * pondría un brazo este objeto". Un `v_` ya viene POSADO en espacio de
   * vista: su origen es el ojo del jugador y el arma cuelga de ahí exactamente
   * donde el juego original la muestra, con manos incluidas. La pose que hay
   * que sumarle es cero, y toda la heurística de `seedHipOffset` —pensada para
   * el otro caso— sólo la movería de donde ya está bien.
   */
  viewmodel?: boolean
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

// Distancia (metros) del OJO al ALZA cuando el arma está en la mira. Es la
// pieza que le faltaba al ADS del pack de COD.
//
// El problema: las 69 de COD salen de `buildNormalizeMatrix` CENTRADAS en su
// caja (min = -max en los tres ejes), así que su `bounds` es simétrico y no
// dice DÓNDE dentro del arma está el alza. La rama vieja ponía el arma a
// `hipZ - ADS_PULL_BACK` del ojo —0,55 m para casi todo el pack—, y a 0,55 m el
// alza de un fusil de 0,85 m queda a más de 30 cm del ojo: el arma llena media
// pantalla, mirás el TECHO del cajón y no ves a través del alza. Es exactamente
// la foto que mandó el dueño.
//
// El arreglo no adivina: `sightRearZ` (medido por el pipeline) dice en qué Z
// del modelo está el alza, y el arma se corre para dejar ese alza a
// EYE_TO_REAR_SIGHT del ojo, como cuando pegás la cara al arma de verdad. El
// punto de mira delantero, más lejos sobre el mismo eje, cae detrás; el ojo
// mira a través del alza hacia él, que es el sight picture de Call of Duty.
//
// El valor sale de mirar: con el alza del ACR (sightRearZ 0,239) a esta
// distancia el punto de mira queda centrado dentro del anillo del alza, igual
// que en la referencia. Un solo número sirve para las 69 porque cada arma trae
// su propio `sightRearZ`: un bullpup (alza casi en el hombro, rearZ negativo)
// se acerca; un sniper largo (rearZ grande) se aleja. Lo que es constante entre
// armas es la distancia ojo-alza, no la posición del arma, igual que
// HIP_ARM_BACK y ADS_PULL_BACK son constantes por la misma razón.
const EYE_TO_REAR_SIGHT = 0.11

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
/** Pose neutra. Es la semilla de los viewmodels de Source: ver
 *  `WeaponIndexEntry.viewmodel`. */
const POSE_NEUTRA: Transform = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 }

export function seedHipOffset(entry: WeaponIndexEntry): Transform {
  // Cualquier arma de procedencia LOCAL termina siendo un viewmodel POSADO con
  // brazos, y para todas la semilla correcta es no moverlas: cero.
  //
  // Las de CS ya llegan así (viewmodel === true). A las 69 de COD el renderer
  // les injerta los brazos de un donante de CS (viewmodel/graft.ts) y pasan a
  // colgar del ojo del jugador EXACTAMENTE como aquéllas —el arma queda asentada
  // en las manos del donante—. La heurística de más abajo está pensada para el
  // otro caso: un modelo de MUNDO suelto (las 40 CC0, sin brazos) al que hay que
  // empujar abajo/derecha/atrás para fingir que un brazo lo sostiene. Aplicada a
  // un viewmodel que YA viene posado, ese empujón sólo lo corre de donde estaba
  // bien: era lo que estiraba los brazos de las de COD y las dejaba chicas y
  // lejos (arrancaban a ~0.72 m del ojo, abajo y a la derecha, con los brazos
  // largándose desde el borde inferior para alcanzarlas). Ver docs foto del
  // dueño (brazos-largos-ak). El injerto usa `origin === 'local'` como
  // discriminante (viewmodel/renderer.ts → graftedModel), así que la pose usa el
  // mismo: lo que se injerta con brazos se posa como viewmodel.
  if (entry.viewmodel === true || entry.origin === 'local') return { ...POSE_NEUTRA }

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
  // Los viewmodels de Source arrancan también en cero, y NO con la medición de
  // `sightHeight` de la rama de abajo, aunque el índice la traiga.
  //
  // El motivo es que esa medición no significa lo mismo acá. El pipeline mide
  // la línea de puntería sobre la geometría en pose de BIND —el esqueleto sin
  // animar—, y en un `v_` la pose de bind es una pose de referencia, no la de
  // sostener el arma: la que se ve en pantalla la produce el clip `idle`.
  // Alinear la cámara contra un número medido en una pose que nunca se dibuja
  // sería peor que no alinear nada, porque parecería derivado.
  //
  // Así que el ADS de estas armas se mide MIRANDO, con el panel de tuning, y
  // queda guardado en `weapons_tuning.json`. Cero es el punto de partida
  // honesto: el arma se queda donde CS la pone.
  if (entry.viewmodel === true) return { ...POSE_NEUTRA }

  const { bounds } = entry
  const sizeY = bounds.max[1] - bounds.min[1]
  const hipZ = seedHipOffset(entry).z

  // Rama para modelos CON mira modelada (las armas derivadas de Source, ver
  // WeaponIndexEntry.sightHeight). Acá no hace falta aproximar nada: el
  // pipeline MIDIÓ dónde está la línea de puntería, así que el offset es esa
  // medición con el signo dado vuelta, y punto.
  //
  // La diferencia con la rama de abajo no es de precisión, es de qué se
  // alinea. Abajo se alinea el BORDE SUPERIOR del modelo; acá, la MIRA. En
  // un arma con hierros esos dos no son lo mismo y la distancia entre ellos
  // es justamente lo que hace que el ADS se vea bien: el punto de mira
  // sobresale del cuerpo, así que poner el punto de mira en el eje de la
  // cámara deja el cajón de mecanismos uno o dos centímetros POR DEBAJO del
  // eje, y ese par de centímetros -vistos desde 10 cm, que es donde queda la
  // parte trasera del arma- son media pantalla de separación entre el cuerpo
  // del arma y el punto al que estás apuntando. Alinear el borde superior
  // deja en cambio el techo del arma pegado a la cruceta a lo largo de todo
  // el cañón, que es exactamente el síntoma que se veía: "el arma tapa el
  // centro".
  if (entry.sightHeight !== undefined) {
    // Z: si el pipeline midió dónde está el alza (`sightRearZ`), se ancla el
    // alza a EYE_TO_REAR_SIGHT del ojo (ver la constante). Esto es lo que
    // arregla el ADS del pack de COD: `hipZ - ADS_PULL_BACK` dejaba el arma a
    // ~0,55 m y se veía el techo del cajón, no la mira. El fallback a la
    // fórmula vieja cubre un índice sin `sightRearZ` (p.ej. anterior a este
    // arreglo): no rompe, sólo no corrige.
    const z =
      entry.sightRearZ !== undefined
        ? entry.sightRearZ + EYE_TO_REAR_SIGHT
        : hipZ - ADS_PULL_BACK
    return {
      x: -(entry.sightLateral ?? 0),
      y: -entry.sightHeight,
      z,
      rx: 0,
      ry: 0,
      rz: 0,
    }
  }

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
