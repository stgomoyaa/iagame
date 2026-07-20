/**
 * Forma de colisión de los props de un mapa importado de Source.
 *
 * EL PROBLEMA QUE RESUELVE (y por qué no es "una caja por prop")
 * --------------------------------------------------------------
 * Los props llegan como mallas de render y hay que darles un cuerpo sólido.
 * La respuesta obvia -- una caja envolvente por instancia -- es
 * catastróficamente mala en este mapa, y no por poco: en nuketown las
 * cercas NO son paneles sueltos sino un ÚNICO prop por patio que recorre
 * todo el perímetro. `fence_ph01` mide 14,84 x 1,37 x 45,02 m. Su caja
 * envolvente es una loza maciza de 15 x 45 m a la altura del pecho: tapa el
 * patio entero, el jardín, la casa y la calle. El navgrid la vería como
 * pared y borraría media zona jugable.
 *
 * El otro extremo tampoco sirve. Separando la malla en islas conexas
 * (soldando vértices por posición) esas cercas se abren en TABLAS: 650
 * islas de 0,10 x 1,35 x 0,02 m en `fence_ph01`, 305 en `fence_rear02`.
 * Envolver cada tabla da una forma exactísima -- 2,5 m³ de volumen total
 * contra los 915 m³ de la caja envolvente -- pero son miles de cuerpos
 * convexos por mapa, y peor: deja huecos de 5 cm entre tablas que el
 * navgrid interpreta como pasajes. Un bot pidiendo un camino que atraviesa
 * una cerca por la ranura entre dos tablas es el bug caro que ya costó caro
 * en el búnker.
 *
 * LO QUE SE HACE: VOXELIZAR Y VOLVER A PEGAR
 * ------------------------------------------
 * Punto medio, en tres pasos:
 *
 *  1. Se marcan las celdas de una grilla regular que toca la geometría.
 *     Esto FUSIONA los huecos de 5 cm entre tablas (una celda de 25 cm los
 *     tapa) sin fusionar los 3 m de patio entre dos tramos de cerca
 *     perpendiculares -- que es exactamente la distinción que ni la caja
 *     envolvente ni las islas saben hacer.
 *  2. Cada celda guarda el AABB REAL de los triángulos que la tocan,
 *     recortado a la celda. Así una cerca de 11 cm de espesor conserva sus
 *     11 cm en vez de engordar a los 25 cm de la celda.
 *  3. Las celdas ocupadas se pegan en cajas grandes (greedy meshing: se
 *     estira en X, después en Z, después en Y). Un tramo recto de cerca de
 *     20 m sale como UNA caja, no como 80 celdas.
 *
 * La caja final es la unión de los AABB recortados de sus celdas. Esa unión
 * está SIEMPRE entre la geometría real y la caja de voxels
 * (geometría ⊆ unión ⊆ voxels), porque cada AABB viene recortado a su
 * celda: el resultado nunca es más gordo que voxelizar a secas y casi
 * siempre es bastante más fino. Nunca deja pasar de menos.
 *
 * LO QUE ESTO NO HACE: RELLENAR
 * -----------------------------
 * Sólo se marcan las celdas que TOCAN un triángulo, así que un prop cerrado
 * (un auto, una caja) sale como CÁSCARA de cajas, no como volumen macizo.
 * Para lo que importa da igual -- las paredes de la cáscara son cuerpos
 * sólidos de verdad y la cápsula no las atraviesa, así que un auto frena
 * igual que si fuera macizo -- pero tiene una consecuencia real: alguien
 * que ya estuviera ADENTRO del auto no chocaría con nada. Hoy nadie puede
 * llegar ahí (para entrar habría que atravesar la cáscara), salvo
 * apareciendo adentro; de eso se ocupa el filtro de spawns de
 * map/external-map.ts.
 *
 * No se rellena a propósito. El relleno pide un flood fill desde afuera, y
 * ahí una cerca que cierra un anillo en planta -- que es exactamente la
 * forma de `fence_ph01` alrededor de la casa rosa -- corre el riesgo de que
 * el patio entero quede marcado como "adentro". Volveríamos al bloque de
 * 15 x 45 m por el camino largo. El costo de no rellenar está acotado y es
 * conocido; el de rellenar mal, no.
 *
 * Todo esto es matemática pura sobre una sopa de triángulos: no importa
 * three y se testea sin navegador (mismo criterio que map/source-map.ts).
 */

import type { Box, Convex } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

/**
 * Lado de la celda de voxelización, en metros.
 *
 * No es un número redondo elegido a ojo, sale de dos cotas:
 *
 * - PISO: tiene que ser MAYOR que el hueco más grande que queremos tapar.
 *   Las tablas de las cercas de nuketown miden 0,10 m y dejan ~0,05 m entre
 *   sí (650 tablas repartidas en ~100 m de perímetro en `fence_ph01`). Con
 *   celdas de 0,25 m cada celda abarca 2-3 tablas y la cerca sale maciza.
 * - TECHO: el error que introduce es como mucho un lado de celda, y ese
 *   error decide dónde el jugador puede pararse. 0,25 m es menos que el
 *   radio de la cápsula (0,40 m), así que un prop nunca crece lo suficiente
 *   como para cerrar un pasaje por el que el jugador de verdad entraba.
 *
 * Queda además por debajo de MAX_ESCALON x 1 (0,35 m): una caja generada
 * acá no puede aparecer flotando a una altura que el resolvedor de escalón
 * no sepa tratar.
 */
export const LADO_CELDA = 0.25

/**
 * Techo de celdas por prop. `fence_ph01`, el más grande de nuketown, pide
 * 60 x 6 x 181 = 65k celdas con LADO_CELDA; el techo está un orden de
 * magnitud más arriba para que un prop raro de otro mapa no reviente la
 * memoria. Al pasarse, se agranda la celda (peor forma, pero acotada) en
 * vez de fallar: un prop con colisión gruesa es mejor que un mapa que no
 * carga.
 */
const MAX_CELDAS = 600_000

/** 9 floats por triángulo, sin indexar: el mismo formato que come el BVH. */
export interface SopaTriangulos {
  posiciones: Float32Array
  /** Cantidad de floats VÁLIDOS en `posiciones` (puede ser un buffer más
   *  grande reusado por el llamador). */
  largo: number
}

/**
 * Cajas alineadas a los ejes que envuelven una sopa de triángulos de mundo.
 *
 * Devuelve una lista nueva; corre una vez por instancia de prop al cargar el
 * mapa, nunca en el camino de frame.
 */
export function cajasDeSopaDeTriangulos(
  sopa: SopaTriangulos,
  ladoPedido: number = LADO_CELDA,
): Box[] {
  const pos = sopa.posiciones
  const largo = sopa.largo
  if (largo < 9) return []

  // Extensión total de la sopa.
  let oX = Infinity
  let oY = Infinity
  let oZ = Infinity
  let fX = -Infinity
  let fY = -Infinity
  let fZ = -Infinity
  for (let i = 0; i < largo; i += 3) {
    const x = pos[i]
    const y = pos[i + 1]
    const z = pos[i + 2]
    if (x < oX) oX = x
    if (y < oY) oY = y
    if (z < oZ) oZ = z
    if (x > fX) fX = x
    if (y > fY) fY = y
    if (z > fZ) fZ = z
  }
  if (!Number.isFinite(oX) || !Number.isFinite(fX)) return []

  // El lado se agranda hasta que la grilla entre en MAX_CELDAS. Se calcula
  // con un bucle y no con una fórmula cerrada porque el redondeo hacia
  // arriba de cada eje hace que la cuenta no sea exactamente cúbica.
  let lado = ladoPedido > 0 ? ladoPedido : LADO_CELDA
  let nx = 0
  let ny = 0
  let nz = 0
  for (;;) {
    nx = Math.max(1, Math.ceil((fX - oX) / lado))
    ny = Math.max(1, Math.ceil((fY - oY) / lado))
    nz = Math.max(1, Math.ceil((fZ - oZ) / lado))
    if (nx * ny * nz <= MAX_CELDAS) break
    lado *= 2
  }

  const total = nx * ny * nz
  const ocupado = new Uint8Array(total)
  // minX,minY,minZ,maxX,maxY,maxZ por celda.
  const ajuste = new Float32Array(total * 6)

  // --- Paso 1 y 2: marcar celdas y acumular el AABB recortado ---
  for (let t = 0; t + 8 < largo; t += 9) {
    const ax = pos[t]
    const ay = pos[t + 1]
    const az = pos[t + 2]
    const bx = pos[t + 3]
    const by = pos[t + 4]
    const bz = pos[t + 5]
    const cx = pos[t + 6]
    const cy = pos[t + 7]
    const cz = pos[t + 8]

    const tMinX = Math.min(ax, bx, cx)
    const tMinY = Math.min(ay, by, cy)
    const tMinZ = Math.min(az, bz, cz)
    const tMaxX = Math.max(ax, bx, cx)
    const tMaxY = Math.max(ay, by, cy)
    const tMaxZ = Math.max(az, bz, cz)

    const x0 = celda(tMinX - oX, lado, nx)
    const x1 = celda(tMaxX - oX, lado, nx)
    const y0 = celda(tMinY - oY, lado, ny)
    const y1 = celda(tMaxY - oY, lado, ny)
    const z0 = celda(tMinZ - oZ, lado, nz)
    const z1 = celda(tMaxZ - oZ, lado, nz)

    for (let y = y0; y <= y1; y++) {
      const cMinY = oY + y * lado
      const mnY = Math.max(tMinY, cMinY)
      const mxY = Math.min(tMaxY, cMinY + lado)
      for (let z = z0; z <= z1; z++) {
        const cMinZ = oZ + z * lado
        const mnZ = Math.max(tMinZ, cMinZ)
        const mxZ = Math.min(tMaxZ, cMinZ + lado)
        for (let x = x0; x <= x1; x++) {
          const cMinX = oX + x * lado
          const mnX = Math.max(tMinX, cMinX)
          const mxX = Math.min(tMaxX, cMinX + lado)

          const i = x + nx * (z + nz * y)
          const b = i * 6
          if (ocupado[i] === 0) {
            ocupado[i] = 1
            ajuste[b] = mnX
            ajuste[b + 1] = mnY
            ajuste[b + 2] = mnZ
            ajuste[b + 3] = mxX
            ajuste[b + 4] = mxY
            ajuste[b + 5] = mxZ
          } else {
            if (mnX < ajuste[b]) ajuste[b] = mnX
            if (mnY < ajuste[b + 1]) ajuste[b + 1] = mnY
            if (mnZ < ajuste[b + 2]) ajuste[b + 2] = mnZ
            if (mxX > ajuste[b + 3]) ajuste[b + 3] = mxX
            if (mxY > ajuste[b + 4]) ajuste[b + 4] = mxY
            if (mxZ > ajuste[b + 5]) ajuste[b + 5] = mxZ
          }
        }
      }
    }
  }

  // --- Paso 3: pegar celdas ocupadas en cajas (greedy meshing) ---
  const visto = new Uint8Array(total)
  const out: Box[] = []

  for (let y = 0; y < ny; y++) {
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const i0 = x + nx * (z + nz * y)
        if (ocupado[i0] === 0 || visto[i0] === 1) continue

        // Estirar en X.
        let x1 = x
        while (x1 + 1 < nx && libre(ocupado, visto, x1 + 1 + nx * (z + nz * y))) x1++

        // Estirar en Z: sólo si TODA la fila en X sigue disponible.
        let z1 = z
        while (z1 + 1 < nz) {
          let ok = true
          for (let xx = x; xx <= x1 && ok; xx++) {
            if (!libre(ocupado, visto, xx + nx * (z1 + 1 + nz * y))) ok = false
          }
          if (!ok) break
          z1++
        }

        // Estirar en Y: sólo si TODA la losa en X,Z sigue disponible.
        let y1 = y
        while (y1 + 1 < ny) {
          let ok = true
          for (let zz = z; zz <= z1 && ok; zz++) {
            for (let xx = x; xx <= x1 && ok; xx++) {
              if (!libre(ocupado, visto, xx + nx * (zz + nz * (y1 + 1)))) ok = false
            }
          }
          if (!ok) break
          y1++
        }

        let minX = Infinity
        let minY = Infinity
        let minZ = Infinity
        let maxX = -Infinity
        let maxY = -Infinity
        let maxZ = -Infinity
        for (let yy = y; yy <= y1; yy++) {
          for (let zz = z; zz <= z1; zz++) {
            for (let xx = x; xx <= x1; xx++) {
              const i = xx + nx * (zz + nz * yy)
              visto[i] = 1
              const b = i * 6
              if (ajuste[b] < minX) minX = ajuste[b]
              if (ajuste[b + 1] < minY) minY = ajuste[b + 1]
              if (ajuste[b + 2] < minZ) minZ = ajuste[b + 2]
              if (ajuste[b + 3] > maxX) maxX = ajuste[b + 3]
              if (ajuste[b + 4] > maxY) maxY = ajuste[b + 4]
              if (ajuste[b + 5] > maxZ) maxZ = ajuste[b + 5]
            }
          }
        }

        out.push({ min: vec3(minX, minY, minZ), max: vec3(maxX, maxY, maxZ) })
      }
    }
  }

  return out
}

/** ¿La celda `i` está ocupada y todavía sin asignar a ninguna caja? */
function libre(ocupado: Uint8Array, visto: Uint8Array, i: number): boolean {
  return ocupado[i] === 1 && visto[i] === 0
}

/** Índice de celda de una coordenada RELATIVA al origen de la grilla,
 *  saturado al rango válido: un vértice justo en el borde superior daría
 *  `n` y escribiría fuera del array. */
function celda(rel: number, lado: number, n: number): number {
  const c = Math.floor(rel / lado)
  if (c < 0) return 0
  if (c >= n) return n - 1
  return c
}

/**
 * Caja alineada a los ejes -> cuerpo convexo de 6 planos.
 *
 * POR QUÉ CONVEX Y NO `MapDef.boxes`: `resolveMove` recorre `boxes` LINEAL,
 * sin ninguna broadphase -- alcanza porque los mapas escritos en código
 * tienen ~20. La lista de convexos, en cambio, ya pasa por la grilla
 * espacial de physics/convex-grid.ts (la que bajó los 1467 brushes de
 * nuketown de 3,58 ms a 1,60 ms por substep). Metiendo los props ahí, las
 * cajas nuevas entran a la misma grilla y el costo por tick queda
 * proporcional a lo que el jugador tiene al lado, no al total del mapa.
 *
 * De regalo vienen dos cosas que `boxes` no da: el resolvedor de ESCALÓN
 * (physics/capsule.ts) sólo existe en el camino convexo, así que un prop
 * bajo -- un cajón, un tronco -- se sube caminando en vez de ser un muro; y
 * el navgrid hornea desde `convexes`, así que los bots ven los props sin
 * tocar una línea de bots/navgrid.ts.
 *
 * Convención de planos (ver map/types.ts): normales hacia AFUERA, interior
 * donde `dot(n, p) <= d`.
 */
export function convexDeCaja(b: Box): Convex {
  const planes = new Float32Array([
    1, 0, 0, b.max.x,
    -1, 0, 0, -b.min.x,
    0, 1, 0, b.max.y,
    0, -1, 0, -b.min.y,
    0, 0, 1, b.max.z,
    0, 0, -1, -b.min.z,
  ])
  return {
    planes,
    count: 6,
    min: vec3(b.min.x, b.min.y, b.min.z),
    max: vec3(b.max.x, b.max.y, b.max.z),
  }
}

/**
 * Triángulos de las caras de una caja, en el formato del BVH (9 floats por
 * triángulo, 12 triángulos por caja).
 *
 * Existe para el caso en que la colisión de un prop TAMBIÉN tenga que parar
 * balas con esta misma forma aproximada. Hoy el hitscan usa los triángulos
 * reales del prop (ver map/external-map.ts) porque una calcomanía flotando
 * a 20 cm de la reja se ve peor que una bala que pasa por una ranura de
 * 5 cm; esto queda para un mapa cuyos props sean cajas de verdad.
 */
export function triangulosDeCaja(b: Box, out: Float32Array, offset: number): number {
  const x0 = b.min.x
  const y0 = b.min.y
  const z0 = b.min.z
  const x1 = b.max.x
  const y1 = b.max.y
  const z1 = b.max.z
  const v = [
    x0, y0, z0, x0, y1, z0, x0, y1, z1,
    x0, y0, z0, x0, y1, z1, x0, y0, z1,
    x1, y0, z0, x1, y1, z1, x1, y1, z0,
    x1, y0, z0, x1, y0, z1, x1, y1, z1,
    x0, y0, z0, x1, y0, z1, x1, y0, z0,
    x0, y0, z0, x0, y0, z1, x1, y0, z1,
    x0, y1, z0, x1, y1, z0, x1, y1, z1,
    x0, y1, z0, x1, y1, z1, x0, y1, z1,
    x0, y0, z0, x1, y1, z0, x1, y0, z0,
    x0, y0, z0, x0, y1, z0, x1, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1,
    x0, y0, z1, x1, y1, z1, x0, y1, z1,
  ]
  out.set(v, offset)
  return offset + v.length
}
