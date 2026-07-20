/**
 * Normaliza referencias de material al estilo Source (las que vienen de
 * "include" en un VMT, o de "$basetexture") a una ruta de pakfile completa:
 * con el prefijo "materials/" y la extensión puestos, sin importar si ya
 * venían o no. $basetexture nunca trae extensión ni el prefijo; "include"
 * casi siempre trae ambos (ver ejemplo del brief) — más simple normalizar
 * los dos casos con la misma función que mantener dos funciones casi
 * iguales.
 */
export function resolveMaterialPath(raw: string, extension: '.vmt' | '.vtf'): string {
  let path = raw.replace(/\\/g, '/').toLowerCase().trim()
  if (!path.startsWith('materials/')) path = `materials/${path}`
  if (!path.endsWith(extension)) path = `${path}${extension}`
  return path
}
