import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { buscarModelosDeMundo, extraerResultados, nombreDeSalida } from './mdl-to-glb'

describe('nombreDeSalida', () => {
  it('saca el prefijo w_ y la extensión', () => {
    expect(nombreDeSalida('/x/models/weapons/rif_ak47/w_ak47.mdl')).toBe('ak47')
  })

  it('no toca un nombre que ya viene limpio', () => {
    expect(nombreDeSalida('/x/ak47.mdl')).toBe('ak47')
  })
})

describe('buscarModelosDeMundo', () => {
  it('encuentra w_*.mdl en subdirectorios y descarta viewmodels y hermanos', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'buscar-'))
    const dir = join(raiz, 'models/weapons/rif_ak47')
    mkdirSync(dir, { recursive: true })
    // El .vvd y el .vtx son los hermanos que traen la geometría real; el .mdl
    // sólo tiene header y huesos. Sólo se listan los .mdl.
    for (const n of ['w_ak47.mdl', 'w_ak47.vvd', 'w_ak47.dx90.vtx', 'v_ak47.mdl']) {
      writeFileSync(join(dir, n), '')
    }

    const encontrados = buscarModelosDeMundo(raiz)

    expect(encontrados).toHaveLength(1)
    expect(encontrados[0].endsWith('w_ak47.mdl')).toBe(true)
  })
})

describe('extraerResultados', () => {
  // Blender escribe decenas de líneas propias en stdout, y hasta un traceback
  // de su logging al cerrar. La línea de resultados tiene que sobrevivir a eso.
  it('aísla la línea marcada entre el ruido de Blender', () => {
    const salida = [
      'Blender 5.2.0 LTS',
      'Registered nodes',
      'RESULTADOS_JSON:[{"mdl":"/x/w_ak47.mdl","ok":true,"tris":3250}]',
      'ReferenceError: StructRNA of type Text has been removed',
    ].join('\n')

    const resultados = extraerResultados(salida)

    expect(resultados).toHaveLength(1)
    expect(resultados[0].tris).toBe(3250)
  })

  it('falla fuerte si Blender no emitió resultados', () => {
    // Sin esto, un import roto se leería como "0 modelos convertidos, todo bien".
    expect(() => extraerResultados('Blender 5.2.0\nsegfault')).toThrow(/no emitió/)
  })
})
