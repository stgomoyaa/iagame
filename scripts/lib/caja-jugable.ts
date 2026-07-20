/**
 * Dónde termina el mapa: cómo se separa la geometría que el jugador puede
 * pisar de la que Source dejó afuera para decorar el horizonte.
 *
 * EL PROBLEMA QUE ESTO RESUELVE
 * ----------------------------
 * Un .bsp de Source no distingue "mapa" de "no mapa". Todo vive en el mismo
 * espacio de coordenadas: los brushes de las casas de nuketown y los de la
 * maqueta a escala 1/8 que el motor dibuja lejos para simular la ciudad del
 * fondo (el "skybox 3D", marcado por la entidad `sky_camera`). Medido sobre
 * dm_nuketown: la geometría de colisión abarca 200 x 181 m, el mapa que se
 * ve mide 69 x 76, y 9.154 de las 13.989 celdas caminables del navgrid --
 * el 65% -- caen sobre colisión que no tiene ninguna malla debajo.
 *
 * El síntoma es el que reportó el dueño: se camina hacia afuera del mapa
 * sobre "piso negro". No es piso negro, es piso INVISIBLE -- colisión sin
 * malla. Y los bots se paran ahí porque el navgrid se hornea desde la
 * colisión, no desde lo que se ve.
 *
 * DOS COSAS DISTINTAS, DOS MECANISMOS DISTINTOS
 * ---------------------------------------------
 * Medido sobre nuketown, la basura no es toda del mismo tipo:
 *
 * 1. **La maqueta del skybox 3D**: 6 brushes que forman un cuarto hueco de
 *    70 x 70 m alrededor de `sky_camera`, a 70 m del mapa jugable. Está
 *    entera afuera. Se DESCARTA.
 *
 * 2. **La losa de piso sobredimensionada**: UN brush de 70,7 x 136,6 m que
 *    es a la vez el piso real del mapa y 40 m de vereda invisible hacia el
 *    sur. Está a caballo del borde. Descartarla dejaría el mapa sin suelo;
 *    hay que RECORTARLA.
 *
 * Confundir los dos casos es el error caro acá: un filtro que sólo descarta
 * brushes enteros deja la losa (o borra el piso), y un recorte que sólo
 * recorta deja el cuarto del skybox 3D como seis paredes sueltas flotando.
 *
 * POR QUÉ NO SE USA LA CAJA DE LOS SPAWNS
 * ---------------------------------------
 * Es la referencia que usa `bsp-props.ts` para los props, y ahí alcanza
 * porque la maqueta del skybox está a miles de unidades y cualquier margen
 * grosero la separa. Acá NO alcanza: los spawns de nuketown ocupan una
 * franja de 66 x 13 m de un mapa de 69 x 76 m. Tomarlos como "la zona
 * jugable" borraría media casa. Un mapa puede tener zonas jugables sin
 * ningún `info_player_*` cerca, y nuketown ya lo es.
 *
 * LO QUE SÍ SE USA: LA MALLA VISIBLE
 * ----------------------------------
 * La caja jugable sale de la **bounding box de la malla visible** que este
 * mismo pipeline construye. La justificación es directamente el enunciado
 * del bug: el defecto es "hay colisión donde no hay nada que ver", así que
 * el criterio correcto es "que no haya colisión donde no hay nada que ver".
 * No es un número elegido a ojo -- es la geometría dibujable del propio
 * mapa.
 *
 * Con una salvedad, y por eso `esDelSkybox3D` existe aparte: si la maqueta
 * del skybox 3D aportara caras dibujables, contaminaría esa bounding box y
 * el criterio se comería a sí mismo. En nuketown no pasa (la maqueta son
 * paredes de `toolsskybox` más un prop, y las caras de herramienta ya se
 * descartan), pero depender de esa casualidad es exactamente el tipo de
 * suposición que este repo ya pagó caro. Entonces la malla se filtra por
 * `sky_camera` ANTES de medirle la caja.
 */

/** Caja alineada a los ejes, en las unidades que le pasen (metros o Source). */
export interface Caja {
  min: [number, number, number]
  max: [number, number, number]
}

export function cajaVacia(): Caja {
  return {
    min: [Infinity, Infinity, Infinity],
    max: [-Infinity, -Infinity, -Infinity],
  }
}

export function expandirCaja(caja: Caja, p: readonly [number, number, number]): void {
  for (let eje = 0; eje < 3; eje++) {
    if (p[eje] < caja.min[eje]) caja.min[eje] = p[eje]
    if (p[eje] > caja.max[eje]) caja.max[eje] = p[eje]
  }
}

export function cajaValida(caja: Caja): boolean {
  for (let eje = 0; eje < 3; eje++) {
    if (!Number.isFinite(caja.min[eje]) || !Number.isFinite(caja.max[eje])) return false
    if (caja.min[eje] > caja.max[eje]) return false
  }
  return true
}

/**
 * ¿Este punto pertenece a la maqueta del skybox 3D?
 *
 * Criterio: está MÁS CERCA de `sky_camera` que de la caja de spawns.
 *
 * Es una partición de Voronoi entre dos referencias que el propio .bsp trae,
 * y por eso no lleva ningún margen elegido a mano -- que es la debilidad del
 * criterio que usa `bsp-props.ts` (4096 unidades, un número que funciona en
 * nuketown y nadie sabe si funciona en el próximo mapa). Verificado sobre
 * dm_nuketown: separa EXACTAMENTE los 6 brushes del cuarto del skybox 3D de
 * los 1499 restantes, con los más cercanos a cada lado a 3220 y 1944
 * unidades de su referencia -- o sea que no es un empate apretado.
 *
 * Si el mapa no trae `sky_camera` (`skyCamera === null`) nada es del skybox
 * 3D: sin la entidad que lo marca no hay maqueta que separar, y adivinarla
 * sería inventar. Falla del lado de no borrar geometría.
 */
export function esDelSkybox3D(
  punto: readonly [number, number, number],
  skyCamera: readonly [number, number, number] | null,
  cajaSpawns: Caja,
): boolean {
  if (skyCamera === null) return false
  if (!cajaValida(cajaSpawns)) return false

  const dSky = Math.hypot(punto[0] - skyCamera[0], punto[1] - skyCamera[1], punto[2] - skyCamera[2])

  let suma = 0
  for (let eje = 0; eje < 3; eje++) {
    const fuera = Math.max(cajaSpawns.min[eje] - punto[eje], 0, punto[eje] - cajaSpawns.max[eje])
    suma += fuera * fuera
  }
  const dSpawns = Math.sqrt(suma)

  return dSky < dSpawns
}

/**
 * Margen, en metros, con el que se agranda la caja de la malla visible antes
 * de recortar la colisión contra ella.
 *
 * No es holgura por las dudas: existe porque las paredes exteriores de un
 * mapa de Source tienen la cara de ADENTRO dibujada y la de AFUERA con
 * textura de herramienta. La bounding box de la malla pasa entonces por la
 * cara interior del muro, y recortar justo ahí dejaría los muros del
 * perímetro con espesor cero -- colisión degenerada exactamente donde más
 * falta hace.
 *
 * 0,5 m está elegido entre dos cotas medidas:
 *  - Piso: los muros de perímetro más gruesos de nuketown miden 16 unidades
 *    de Source (0,30 m). El margen tiene que superarlos para no cortarlos.
 *  - Techo: el DIÁMETRO de la cápsula del jugador es 0,8 m. Mientras el
 *    margen quede por debajo, la repisa invisible que sobra en el peor caso
 *    es más angosta que el propio jugador y no queda dónde pararse.
 */
export const MARGEN_JUGABLE_M = 0.5

/** La caja de la malla visible, agrandada por `MARGEN_JUGABLE_M`. */
export function cajaJugableDesdeMalla(cajaMalla: Caja, margen = MARGEN_JUGABLE_M): Caja {
  return {
    min: [cajaMalla.min[0] - margen, cajaMalla.min[1] - margen, cajaMalla.min[2] - margen],
    max: [cajaMalla.max[0] + margen, cajaMalla.max[1] + margen, cajaMalla.max[2] + margen],
  }
}

/** ¿Las dos cajas se tocan? Un brush que no toca la jugable no aporta nada. */
export function cajasSeTocan(a: Caja, b: Caja): boolean {
  for (let eje = 0; eje < 3; eje++) {
    if (a.max[eje] < b.min[eje]) return false
    if (a.min[eje] > b.max[eje]) return false
  }
  return true
}

/**
 * Planos que hay que AGREGARLE a un brush para recortarlo contra `caja`.
 *
 * Devuelve sólo los que efectivamente cortan (los que el brush ya respeta no
 * cambian nada y sí costarían una iteración por tick en el camino caliente
 * de la colisión: `overlapAndResolveConvex` recorre TODOS los planos de cada
 * convexo cercano, 128 veces por segundo). Medido en nuketown: de 1499
 * brushes que sobreviven, sólo 12 necesitan algún plano nuevo.
 *
 * El formato es el mismo que usa la colisión del motor: normal hacia AFUERA
 * y el interior en `dot(n, p) <= d`. Recortar un convexo con un semiespacio
 * da otro convexo, así que agregar planos es todo lo que hace falta -- no
 * hay que recalcular vértices.
 */
export function planosDeRecorte(brush: Caja, caja: Caja): number[] {
  const planos: number[] = []
  const ejes: ReadonlyArray<readonly [number, number, number]> = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ]
  for (let eje = 0; eje < 3; eje++) {
    const n = ejes[eje]
    if (brush.max[eje] > caja.max[eje]) {
      planos.push(n[0], n[1], n[2], caja.max[eje])
    }
    if (brush.min[eje] < caja.min[eje]) {
      planos.push(-n[0], -n[1], -n[2], -caja.min[eje])
    }
  }
  return planos
}

/** La bbox del brush ya recortada: la intersección de las dos cajas. */
export function recortarCaja(brush: Caja, caja: Caja): Caja {
  return {
    min: [
      Math.max(brush.min[0], caja.min[0]),
      Math.max(brush.min[1], caja.min[1]),
      Math.max(brush.min[2], caja.min[2]),
    ],
    max: [
      Math.min(brush.max[0], caja.max[0]),
      Math.min(brush.max[1], caja.max[1]),
      Math.min(brush.max[2], caja.max[2]),
    ],
  }
}

/**
 * Espesor, en metros, de los muros de cierre que sellan la caja jugable.
 *
 * POR QUÉ HAY QUE SELLAR Y NO ALCANZA CON RECORTAR
 * ------------------------------------------------
 * El mapa YA venía sellado: los 5 brushes de la cáscara exterior (4 muros +
 * techo, con textura `toolsskybox`) son los que impedían caerse del mundo.
 * Sólo que estaban dimensionados para la losa vieja -- a 40 m del borde
 * visible -- así que sellaban un recinto que incluía toda la vereda
 * invisible. Al recortar la colisión a la caja jugable esos muros quedan
 * afuera y desaparecen, y el jugador que camina hasta el borde deja de
 * pisar piso invisible para pasar a caerse al vacío: un defecto peor que el
 * que vinimos a arreglar.
 *
 * Estos muros NO son geometría inventada: son los mismos muros de la
 * cáscara del mapa, reemitidos en el borde que corresponde. Son invisibles
 * por el mismo motivo que los originales (la malla se construye aparte, de
 * LUMP_FACES, y esto no toca ninguna cara) y frenan al jugador igual que un
 * `tools/toolsplayerclip`, que este pipeline ya importa como colisión sin
 * malla.
 *
 * 0,5 m de espesor: más que el paso máximo que la cápsula recorre en un
 * tick a 128 Hz incluso corriendo (0,05 m), con dos órdenes de margen, así
 * que ningún substep puede atravesarlos.
 */
export const ESPESOR_CIERRE_M = 0.5

/**
 * Los 4 muros laterales + el techo que cierran la caja jugable, como cajas
 * listas para convertirse en brushes.
 *
 * El PISO no se cierra a propósito: el suelo del mapa ya existe y es la
 * geometría real; taparlo por abajo sólo agregaría un convexo enorme que la
 * colisión tiene que mirar sin que nunca cambie un resultado.
 */
export function murosDeCierre(caja: Caja, espesor = ESPESOR_CIERRE_M): Caja[] {
  const [x0, y0, z0] = caja.min
  const [x1, y1, z1] = caja.max
  return [
    // Oeste / este: cubren todo el alto y todo el largo en Z.
    { min: [x0 - espesor, y0, z0 - espesor], max: [x0, y1, z1 + espesor] },
    { min: [x1, y0, z0 - espesor], max: [x1 + espesor, y1, z1 + espesor] },
    // Norte / sur: entre los dos anteriores, para no solaparse con ellos.
    { min: [x0, y0, z0 - espesor], max: [x1, y1, z0] },
    { min: [x0, y0, z1], max: [x1, y1, z1 + espesor] },
    // Techo.
    { min: [x0 - espesor, y1, z0 - espesor], max: [x1 + espesor, y1 + espesor, z1 + espesor] },
  ]
}

/** Los 6 planos (normal afuera, interior `dot(n,p) <= d`) de una caja. */
export function planosDeCaja(caja: Caja): number[] {
  return [
    1, 0, 0, caja.max[0],
    -1, 0, 0, -caja.min[0],
    0, 1, 0, caja.max[1],
    0, -1, 0, -caja.min[1],
    0, 0, 1, caja.max[2],
    0, 0, -1, -caja.min[2],
  ]
}
