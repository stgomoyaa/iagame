import { describe, expect, it } from 'vitest'

import { esDelSkybox3D, nombreGlbDeModelo } from './bsp-props.ts'

describe('nombreGlbDeModelo', () => {
  it('aplana la ruta del modelo a un nombre de archivo único', () => {
    expect(nombreGlbDeModelo('models/props/nuketown/fence_gh01.mdl')).toBe('props__nuketown__fence_gh01.glb')
  })

  it('no colapsa dos modelos con el mismo basename en distinta carpeta', () => {
    // `props_c17/fence01a` y `nuketown/fence01a` tienen el mismo nombre de
    // archivo. Aplanar quedándose sólo con el basename los pisaría, y uno
    // de los dos props aparecería con el modelo del otro.
    const a = nombreGlbDeModelo('models/props_c17/fence01a.mdl')
    const b = nombreGlbDeModelo('models/props/nuketown/fence01a.mdl')
    expect(a).not.toBe(b)
  })

  it('normaliza mayúsculas y barras invertidas como las escribe Hammer', () => {
    expect(nombreGlbDeModelo('models\\Props\\Nuketown\\Fence_GH01.mdl')).toBe('props__nuketown__fence_gh01.glb')
  })
})

/**
 * El filtro de skybox 3D es lo único que separa la maqueta del horizonte de
 * la geometría real del mapa. Si deja pasar un prop, aparece una casa a
 * escala flotando al lado del área jugable; si filtra de más, desaparecen
 * props del borde del mapa. Los dos casos se ven raro y ninguno rompe nada,
 * así que no hay forma de que un test de carga los note.
 */
describe('esDelSkybox3D', () => {
  // Caja de spawns de nuketown, redondeada.
  const min: [number, number, number] = [-1216, 16, -62]
  const max: [number, number, number] = [2240, 688, -60]
  const MARGEN = 4096

  it('deja pasar un prop en el medio del área jugable', () => {
    expect(esDelSkybox3D([500, 300, -60], min, max, MARGEN)).toBe(false)
  })

  it('deja pasar un prop del borde del mapa, bien afuera de la caja de spawns', () => {
    // Los spawns no cubren el mapa entero: hay props (cercas, sobre todo)
    // más allá del último spawn que son geometría real. Por eso el margen
    // es grande.
    expect(esDelSkybox3D([-3000, 100, -60], min, max, MARGEN)).toBe(false)
  })

  it('filtra el sky_base de nuketown, que está en x=-6272', () => {
    expect(esDelSkybox3D([-6272, 112, -676], min, max, MARGEN)).toBe(true)
  })

  it('filtra por cualquiera de los tres ejes, no sólo por X', () => {
    // El skybox de nuketown cae en X, pero en otro mapa puede estar en
    // cualquier dirección: filtrar sólo por X funcionaría acá y fallaría en
    // el mapa siguiente.
    expect(esDelSkybox3D([500, 300, 90000], min, max, MARGEN)).toBe(true)
    expect(esDelSkybox3D([500, 90000, -60], min, max, MARGEN)).toBe(true)
    expect(esDelSkybox3D([500, -90000, -60], min, max, MARGEN)).toBe(true)
  })

  it('es exacto en el límite del margen', () => {
    expect(esDelSkybox3D([max[0] + MARGEN, 300, -60], min, max, MARGEN)).toBe(false)
    expect(esDelSkybox3D([max[0] + MARGEN + 1, 300, -60], min, max, MARGEN)).toBe(true)
  })
})
