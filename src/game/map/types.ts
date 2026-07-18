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
}
