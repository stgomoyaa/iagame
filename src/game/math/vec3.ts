export type Vec3 = { x: number; y: number; z: number }

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x
  out.y = a.y
  out.z = a.z
  return out
}

export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s
  out.y = a.y + b.y * s
  out.z = a.z + b.z * s
  return out
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s
  out.y = a.y * s
  out.z = a.z * s
  return out
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function lengthHorizontal(a: Vec3): number {
  return Math.hypot(a.x, a.z)
}

export function normalizeHorizontal(out: Vec3, a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.z)
  if (len < 1e-6) return set(out, 0, 0, 0)
  out.x = a.x / len
  out.y = 0
  out.z = a.z / len
  return out
}
