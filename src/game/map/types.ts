import type { Vec3 } from '@/game/math/vec3'

export interface Box {
  min: Vec3
  max: Vec3
}

export interface MapDef {
  name: string
  /** Geometría sólida. Alimenta tanto la colisión como el mesh visual. */
  boxes: Box[]
  spawns: Vec3[]
  bounds: Box
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
