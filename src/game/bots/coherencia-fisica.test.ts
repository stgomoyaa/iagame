/**
 * EL test de esta parte del motor: **toda arista que el navgrid promete, la
 * puede recorrer stepPlayer de verdad**.
 *
 * Los tres peores bugs de bots de este proyecto fueron el mismo bug: el grafo
 * de navegación ofreciendo un camino que la física no ejecuta. Techos de muro
 * marcados como caminables (51,5% de muestras trabadas en el búnker), y un
 * strafe que aceptaba escalones de 1,2 m que `tryMantle` no podía subir (un
 * bot empujando contra una caja 5,3 segundos). Ninguno lo agarró un test de
 * mecánica: los tres aparecieron midiendo una partida.
 *
 * Un test por mecánica no los agarra porque cada mitad, por separado, está
 * bien: la física sube lo que puede subir y el navgrid conecta lo que decidió
 * conectar. El defecto vive en el CONTRATO entre las dos. Entonces este
 * archivo no prueba ninguna de las dos: agarra el grafo horneado y camina
 * cada arista con el mismo `stepPlayer` que usa el jugador, a ver si llega.
 *
 * Se camina SIN SALTAR a propósito, aunque el bot real sí salte
 * (`steerAlongPath` pide salto al subir de celda). La promesa que hace el
 * bake de un mapa de brushes es "esto se sube caminando" (ver
 * `alturaFranqueable` en navgrid.ts: sin `boxes` no hay mantle, y lo único
 * que queda es el escalón de la colisión convexa). Verificarla con el salto
 * habilitado sería verificar una promesa más débil que la que el bake hace, y
 * dejaría pasar exactamente el tipo de arista marginal que se traduce en un
 * bot moliendo contra la geometría cuando no le sale el salto.
 *
 * Los mapas de CAJAS no entran acá: su conectividad es la regla de mantle de
 * siempre (1,2 m), que sí necesita saltar, y no cambió en esta tarea -- la
 * cubre map/invariants.ts.
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildMainComponentMask,
  buildNavGrid,
  cellCenterX,
  cellCenterZ,
  cellCol,
  cellRow,
  cellsConnected,
  NEIGHBOR_OFFSETS,
  worldToCellIndex,
  type NavGrid,
} from '@/game/bots/navgrid'
import { cajaConvexa, cuna, mapaDeBrushes } from '@/game/map/geometria-de-prueba'
import { esMapaFuenteJson, mapDefDesdeJson } from '@/game/map/source-map'
import type { Convex, MapDef } from '@/game/map/types'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { TICK_DT } from '@/game/engine/constants'

/** Radio de llegada. Es el mismo ARRIVE_RADIUS con el que bots/bot.ts da por
 *  alcanzado un waypoint: llegar "a la celda" significa lo mismo acá que allá. */
const RADIO_LLEGADA = 0.75

/** Ticks de simulación por arista. A velocidad de caminata (5 m/s) cruzar una
 *  celda diagonal (1,41 m) toma ~36 ticks; 192 (1,5 s) deja margen de sobra
 *  para frenar contra un escalón y volver a acelerar, y sigue siendo un techo
 *  bajo comparado con los 5,3 s que estuvo trabado el bot del bug real. */
const TICKS_MAX = 192

const ENTRADA_BASE: PlayerInput = {
  forward: 0,
  right: 0,
  yaw: 0,
  jump: false,
  sprint: false,
  crouch: false,
}

/**
 * ¿Puede la física caminar del centro de la celda `desde` al centro de
 * `hasta`? Arranca la cápsula parada sobre la superficie que el navgrid dice
 * que hay en `desde` -- si esa altura fuera mentira, el arranque ya falla, que
 * es justamente lo que queremos que se note.
 */
function caminaEntreCeldas(
  grid: NavGrid,
  convexes: Convex[],
  desde: number,
  hasta: number,
): boolean {
  const x0 = cellCenterX(grid, cellCol(grid, desde))
  const z0 = cellCenterZ(grid, cellRow(grid, desde))
  const x1 = cellCenterX(grid, cellCol(grid, hasta))
  const z1 = cellCenterZ(grid, cellRow(grid, hasta))

  const state = createPlayerState({ x: x0, y: grid.heights[desde] + 0.05, z: z0 })
  const input: PlayerInput = { ...ENTRADA_BASE }

  // Asentar: unos ticks sin intención de moverse para que apoye en el piso.
  for (let i = 0; i < 8; i++) stepPlayer(state, input, [], TICK_DT, convexes)

  for (let tick = 0; tick < TICKS_MAX; tick++) {
    const dx = x1 - state.position.x
    const dz = z1 - state.position.z
    if (Math.hypot(dx, dz) < RADIO_LLEGADA) return true
    // Misma convención que computeWishDir (movement/step.ts) y que el
    // `desiredYaw` de bots/bot.ts: yaw 0 mira hacia -Z.
    input.yaw = Math.atan2(-dx, -dz)
    input.forward = 1
    stepPlayer(state, input, [], TICK_DT, convexes)
  }

  return Math.hypot(x1 - state.position.x, z1 - state.position.z) < RADIO_LLEGADA
}

interface Falla {
  desde: number
  hasta: number
  alturaDesde: number
  alturaHasta: number
}

/** Camina todas las aristas del componente alcanzable (o una muestra, si el
 *  mapa es grande) y devuelve las que la física no pudo hacer. */
function aristasIncumplidas(
  grid: NavGrid,
  convexes: Convex[],
  maximoAristas = Infinity,
): { probadas: number; fallas: Falla[] } {
  const mask = buildMainComponentMask(grid)
  const fallas: Falla[] = []
  let probadas = 0

  const total = grid.cols * grid.rows
  // Paso de muestreo: recorre el mapa entero de punta a punta en vez de
  // quedarse con las primeras N celdas de la esquina superior.
  const candidatas: number[] = []
  for (let i = 0; i < total; i++) if (mask[i] !== 0) candidatas.push(i)
  const paso = Math.max(1, Math.ceil((candidatas.length * 8) / maximoAristas))

  for (let k = 0; k < candidatas.length; k += paso) {
    const idx = candidatas[k]
    const col = cellCol(grid, idx)
    const row = cellRow(grid, idx)
    for (let n = 0; n < NEIGHBOR_OFFSETS.length; n++) {
      if ((grid.links[idx] & (1 << n)) === 0) continue
      const c = col + NEIGHBOR_OFFSETS[n][0]
      const r = row + NEIGHBOR_OFFSETS[n][1]
      const vecino = r * grid.cols + c
      if (mask[vecino] === 0) continue
      probadas++
      if (!caminaEntreCeldas(grid, convexes, idx, vecino)) {
        fallas.push({
          desde: idx,
          hasta: vecino,
          alturaDesde: grid.heights[idx],
          alturaHasta: grid.heights[vecino],
        })
      }
    }
  }

  return { probadas, fallas }
}

/**
 * Banco de pruebas: un mapa chico con las cuatro formas que rompen un bake
 * ingenuo, todas juntas y todas de brushes.
 */
function bancoDePruebas(): MapDef {
  const brushes: Convex[] = [
    // Piso.
    cajaConvexa(-2, -1, -2, 26, 0, 14),
    // Rampa de 25 grados: caminable, y el perfil tiene que dejarla conectada.
    cuna(2, 8, 0, 5, 0, Math.tan((25 * Math.PI) / 180) * 6),
    // Rampa de 55 grados: pared. Ni caminable ni conectada.
    cuna(11, 13, 0, 5, 0, Math.tan((55 * Math.PI) / 180) * 2),
    // Repisa de 1 m: entra en el mantle de un mapa de cajas, no en el escalón
    // de uno de brushes.
    cajaConvexa(16, -1, 0, 19, 1, 5),
    // Cordón de vereda de 0,2 m: escalón legítimo, tiene que quedar conectado.
    cajaConvexa(21, -1, 0, 25, 0.2, 5),
    // Muro de 3 m: separa el mapa y no se sube por ningún lado.
    cajaConvexa(-2, -1, 8, 26, 3, 9),
    // Escalera de contrahuellas de 0,15 m contra el muro (no llega arriba:
    // sólo existe para que haya un perfil escalonado real en el mapa).
    ...Array.from({ length: 8 }, (_, i) => cajaConvexa(2 + i * 0.3, -1, 6, 26, (i + 1) * 0.15, 8)),
  ]
  return mapaDeBrushes(brushes, { min: [-2, 0, -2], max: [26, 6, 14] })
}

describe('coherencia entre navegación y física (mapas de brushes)', () => {
  it('toda arista del banco de pruebas la puede caminar stepPlayer', () => {
    const map = bancoDePruebas()
    const grid = buildNavGrid(map)
    const { probadas, fallas } = aristasIncumplidas(grid, map.convexes ?? [])

    expect(probadas, 'el banco de pruebas tiene que producir aristas que probar').toBeGreaterThan(200)
    const detalle = fallas
      .slice(0, 10)
      .map(
        (f) =>
          `celda ${f.desde} (y=${f.alturaDesde.toFixed(2)}) -> ${f.hasta} (y=${f.alturaHasta.toFixed(2)})`,
      )
      .join('; ')
    expect(fallas.length, `${fallas.length}/${probadas} aristas que la física no puede hacer: ${detalle}`).toBe(0)
  })

  it('el umbral de pendiente del navgrid es el que la física ejecuta', () => {
    // La verificación de la decisión de diseño de esta tarea. El umbral
    // (45 grados) está DESPEJADO, no elegido: es lo que sale de la propia
    // clasificación piso/pared de la colisión (physics/capsule.ts
    // esNormalPisable). Pero "despejado" no es "cierto": esto lo mide.
    //
    // Para cada inclinación se hornea la rampa, se le pregunta al navgrid si
    // es caminable, y por separado se sube con stepPlayer a ver si la física
    // deja. Las dos respuestas tienen que coincidir SIEMPRE. Si el navgrid
    // dice que sí y la física que no, los bots se muelen contra la rampa; al
    // revés, se privan de medio mapa.
    const desacuerdos: string[] = []
    const ALTO = 2

    for (const grados of [10, 20, 30, 40, 44, 46, 50, 60, 70]) {
      // Rampa de altura fija y carrera variable: así la geometría no se
      // dispara a 22 m de alto en las inclinaciones grandes y las nueve
      // pruebas son comparables entre sí. Termina en una meseta, para que
      // "llegó arriba" sea un lugar donde quedarse parado y no un borde por
      // el que uno se cae apenas lo pisa.
      const carrera = ALTO / Math.tan((grados * Math.PI) / 180)
      const map = mapaDeBrushes(
        [
          cajaConvexa(-8, -1, -4, carrera + 8, 0, 8),
          cuna(0, carrera, -4, 8, 0, ALTO),
          cajaConvexa(carrera, -1, -4, carrera + 8, ALTO, 8),
        ],
        { min: [-8, 0, -4], max: [carrera + 8, ALTO + 4, 8] },
      )
      const grid = buildNavGrid(map)
      const convexes = map.convexes ?? []

      // Pregunta al navgrid: ¿la meseta quedó en el mismo componente
      // alcanzable que el piso? (No "¿es caminable la rampa?": en las
      // inclinaciones grandes la rampa mide menos de una celda, y lo que de
      // verdad decide si un bot puede subir es si el grafo los conecta.)
      const mask = buildMainComponentMask(grid)
      const abajo = worldToCellIndex(grid, -4, 2)
      const arriba = worldToCellIndex(grid, carrera + 4, 2)
      const navegable = mask[abajo] === 1 && mask[arriba] === 1

      // Pregunta a la física: caminando hacia la rampa, sin saltar, ¿se llega
      // a la meseta?
      const state = createPlayerState({ x: -4, y: 0.05, z: 2 })
      const input: PlayerInput = { ...ENTRADA_BASE }
      for (let i = 0; i < 8; i++) stepPlayer(state, input, [], TICK_DT, convexes)
      input.yaw = Math.atan2(-1, 0)
      input.forward = 1
      let maxY = state.position.y
      for (let t = 0; t < 512; t++) {
        stepPlayer(state, input, [], TICK_DT, convexes)
        if (state.position.y > maxY) maxY = state.position.y
      }
      const fisicaSube = maxY >= ALTO - 0.1

      if (navegable !== fisicaSube) {
        desacuerdos.push(
          `${grados}°: navgrid=${navegable ? 'conecta' : 'no conecta'} física=${fisicaSube ? 'sube' : 'no sube'} (llegó a ${maxY.toFixed(2)} de ${ALTO})`,
        )
      }
    }

    expect(desacuerdos, `navegación y física no coinciden: ${desacuerdos.join('; ')}`).toEqual([])
  })

  it('un desnivel grande entre celdas vecinas no se conecta', () => {
    // Un pozo de 2 m. Las dos celdas del borde son caminables por separado, y
    // la de arriba se ve perfectamente desde la de abajo -- lo único que dice
    // que no se puede ir de una a la otra es la geometría entre medio.
    const piso = cajaConvexa(-10, -1, -6, 0, 0, 6)
    const fondo = cajaConvexa(0, -4, -6, 10, -2, 6)
    const map = mapaDeBrushes([piso, fondo], { min: [-10, -4, -6], max: [10, 4, 6] })
    const grid = buildNavGrid(map)

    const arriba = worldToCellIndex(grid, -0.5, 0)
    const abajo = worldToCellIndex(grid, 0.5, 0)
    expect(grid.walkable[arriba]).toBe(1)
    expect(grid.walkable[abajo]).toBe(1)
    expect(grid.heights[arriba] - grid.heights[abajo]).toBeCloseTo(2, 4)
    expect(cellsConnected(grid, arriba, abajo)).toBe(false)
  })

  const NUKETOWN = 'public/assets/maps/dm_nuketown.json'

  // nuketown no está en el repo (docs/WORKSHOP.md: los archivos derivan del
  // Steam Workshop y `public/assets/maps/` está gitignoreado). Cuando está,
  // esta es la versión que vale: geometría que nadie diseñó pensando en este
  // motor, 1467 brushes, la que encontró los dos bugs que el banco sintético
  // no tenía forma de tener.
  it.skipIf(!existsSync(NUKETOWN))(
    'toda arista de nuketown la puede caminar stepPlayer',
    () => {
      const crudo: unknown = JSON.parse(readFileSync(NUKETOWN, 'utf8'))
      expect(esMapaFuenteJson(crudo)).toBe(true)
      const map = mapDefDesdeJson(crudo as never, 'nuketown')
      const grid = buildNavGrid(map)
      const { probadas, fallas } = aristasIncumplidas(grid, map.convexes ?? [], 4000)

      expect(probadas).toBeGreaterThan(1000)
      const detalle = fallas
        .slice(0, 10)
        .map(
          (f) =>
            `celda ${f.desde} (y=${f.alturaDesde.toFixed(2)}) -> ${f.hasta} (y=${f.alturaHasta.toFixed(2)})`,
        )
        .join('; ')
      expect(
        fallas.length,
        `${fallas.length}/${probadas} aristas que la física no puede hacer: ${detalle}`,
      ).toBe(0)
    },
    60_000,
  )
})
