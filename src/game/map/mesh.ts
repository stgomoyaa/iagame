import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three'
import type { Box, MapDef } from '@/game/map/types'

const COLOR_PISO = new Color(0x2a2f3a)
const COLOR_COBERTURA_BAJA = new Color(0x4a5568)
const COLOR_COBERTURA_ALTA = new Color(0x39414f)
const COLOR_MURO = new Color(0x1e222b)

function colorPara(b: Box): Color {
  const altura = b.max.y - b.min.y
  if (b.max.y <= 0.01) return COLOR_PISO
  if (altura >= 5) return COLOR_MURO
  if (altura >= 2) return COLOR_COBERTURA_ALTA
  return COLOR_COBERTURA_BAJA
}

/**
 * Fusiona todas las cajas del mapa en una única geometría no indexada.
 * Un mapa entero en 1 draw call, sin luces ni shadow maps: la legibilidad
 * espacial la dan los colores de vértice por tipo de superficie.
 */
export function buildArenaGeometry(map: MapDef): BufferGeometry {
  const totalVertices = map.boxes.length * 36
  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const colors = new Float32Array(totalVertices * 3)

  const matrix = new Matrix4()
  let offset = 0

  for (const b of map.boxes) {
    const sx = b.max.x - b.min.x
    const sy = b.max.y - b.min.y
    const sz = b.max.z - b.min.z

    const geo = new BoxGeometry(sx, sy, sz).toNonIndexed()
    matrix.makeTranslation(
      (b.min.x + b.max.x) * 0.5,
      (b.min.y + b.max.y) * 0.5,
      (b.min.z + b.max.z) * 0.5,
    )
    geo.applyMatrix4(matrix)

    const p = geo.getAttribute('position').array as Float32Array
    const n = geo.getAttribute('normal').array as Float32Array
    positions.set(p, offset * 3)
    normals.set(n, offset * 3)

    const c = colorPara(b)
    for (let i = 0; i < 36; i++) {
      colors[(offset + i) * 3] = c.r
      colors[(offset + i) * 3 + 1] = c.g
      colors[(offset + i) * 3 + 2] = c.b
    }

    offset += 36
    geo.dispose()
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(positions, 3))
  merged.setAttribute('normal', new BufferAttribute(normals, 3))
  merged.setAttribute('color', new BufferAttribute(colors, 3))
  return merged
}
