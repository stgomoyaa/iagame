import { describe, expect, it } from 'vitest'
import { resolveMaterialPath } from './source-paths.ts'

describe('resolveMaterialPath', () => {
  it('$basetexture típico (sin prefijo ni extensión) se completa con ambos', () => {
    expect(resolveMaterialPath('PLASTER/WALLPAPER01', '.vtf')).toBe('materials/plaster/wallpaper01.vtf')
  })

  it('un include que ya trae "materials/" y ".vmt" no se duplica', () => {
    expect(resolveMaterialPath('materials/PLASTER/WALLPAPER01.vmt', '.vmt')).toBe(
      'materials/plaster/wallpaper01.vmt',
    )
  })

  it('normaliza backslashes de Windows a forward slashes', () => {
    expect(resolveMaterialPath('PLASTER\\WALLPAPER01', '.vtf')).toBe('materials/plaster/wallpaper01.vtf')
  })

  it('es insensible a mayúsculas', () => {
    expect(resolveMaterialPath('Plaster/WallPaper01', '.vtf')).toBe('materials/plaster/wallpaper01.vtf')
  })
})
