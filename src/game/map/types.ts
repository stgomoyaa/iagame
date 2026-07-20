import type { Vec3 } from '@/game/math/vec3'

export interface Box {
  min: Vec3
  max: Vec3
}

/**
 * Poliedro convexo como intersección de semiespacios, para brushes de Source
 * que no son cajas alineadas a los ejes (rampas, muros en ángulo). Ver la
 * derivación completa en physics/capsule.ts.
 */
export interface Convex {
  /** Planos empaquetados (nx, ny, nz, d), 4 floats por plano. Normales hacia
   *  AFUERA: el interior del cuerpo es donde dot(n, p) <= d. */
  planes: Float32Array
  count: number
  /** Caja envolvente, para descarte rápido antes de mirar los planos. */
  min: Vec3
  max: Vec3
}

export interface MapDef {
  name: string
  /** Geometría sólida. Alimenta tanto la colisión como el mesh visual. */
  boxes: Box[]
  /**
   * Geometría sólida que NO es una caja alineada a los ejes: los brushes de
   * un mapa importado de Source (rampas, techos inclinados, muros en
   * ángulo). Opcional porque los tres mapas escritos en código no tienen
   * ninguno -- ahí la lista va indefinida y todo el motor sigue viendo
   * exactamente el mismo mapa de antes.
   *
   * Convive con `boxes` en vez de reemplazarla: una AABB se resuelve con
   * tres restas y un brush con N planos no, así que a los mapas de código
   * les sale gratis seguir por la ruta rápida.
   */
  convexes?: Convex[]
  spawns: Vec3[]
  /**
   * Hacia dónde mira quien aparece en `spawns[i]`, en radianes y en la MISMA
   * convención que `PlayerState.yaw` (la que consume `camera.rotation.y`).
   * Paralelo a `spawns`: mismo largo, mismo orden.
   *
   * Opcional porque los mapas escritos en código no la traen: ahí aparecer
   * mirando a -Z es tan bueno como cualquier otra cosa, porque sus spawns
   * están repartidos alrededor de un centro y no hay un "frente" del mapa.
   * En un mapa de Source sí lo hay: el mapper puso los 32 `info_player_*`
   * de nuketown con `angles` enfrentados (los 16 de un bando a 0°, los 16
   * del otro a 180°), que es lo que hace que el jugador aparezca mirando la
   * calle por donde viene el enemigo. Sin esto todos aparecen mirando a -Z,
   * que en nuketown es perpendicular al eje del mapa: 27 de los 32 spawns
   * quedan mirando al vacío fuera de la zona jugable.
   */
  spawnYaws?: number[]
  bounds: Box
  /**
   * Triángulos de la malla visible, no indexados, en metros y ejes de
   * three.js (9 floats por triángulo). Sólo la traen los mapas importados:
   * su geometría de colisión son brushes convexos, de los que no se puede
   * derivar la malla que ve el jugador. El BVH de hitscan
   * (combat/hitscan.ts) la usa en lugar de `boxes` cuando está presente --
   * si no, dispararle a una rampa no acertaría a nada.
   */
  triangles?: Float32Array
  /**
   * Altura de las superficies que el mapa declara MURO: no plataformas, no
   * se suben, se rodean. Las usa el chequeo de alcanzabilidad
   * (map/invariants.ts) para no exigir un escalón de apoyo debajo de algo
   * que por diseño nadie debería pisar. Sólo es honesto si el número está
   * de verdad fuera del alcance de cualquier cadena de saltos posible en
   * ese mapa -- invariants.test.ts lo verifica por separado.
   */
  wallHeight?: number
  /**
   * Subconjunto de `boxes` (las MISMAS referencias, se comparan por
   * identidad) que existe para romper líneas de vista de pie y que por lo
   * tanto NO debe quedar parable ni encadenando saltos con mantle. Nació de
   * un bug real en la arena: una caja mantleable de 1m cerca de un
   * separador de 2.2m lo convertía en una escalera de dos pasos hasta un
   * lugar que el mapa documenta como "bloquea línea de vista".
   */
  blockingCover?: Box[]
}
