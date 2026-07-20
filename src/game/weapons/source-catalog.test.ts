import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { weaponIndex } from '@/game/weapons/registry'
import { SOURCE_WEAPONS, SOURCE_WEAPONS_BY_SLUG } from '@/game/weapons/source-catalog'

/**
 * Marcas y designaciones de armas reales que NO pueden aparecer en nada que
 * vea el jugador. La lista es explícita a propósito: "detectar una marca"
 * automáticamente no se puede, y una regla escrita en un comentario se
 * incumple sin que nadie se entere.
 *
 * Los tokens son designaciones COMPLETAS y no fragmentos, y eso es una
 * decisión con una razón concreta: con `mac` a secas este test fallaría
 * contra el pack CC0, cuyos modelos se llaman "SubmachineGun_3" —
 * sub-MAC-hinegun. Un guard que falla por un falso positivo se termina
 * apagando, y ahí sí no protege de nada.
 *
 * Por el mismo motivo NO están acá los nombres de TIPO de arma, aunque
 * suenen a modelo concreto: "shotgun", "revolver" o "sawed-off" describen
 * una categoría, no una marca — cualquiera puede vender una escopeta
 * recortada. El pack CC0 ya trae un "Shotgun SawedOff" perfectamente
 * publicable, y prohibir esos términos habría hecho fallar el guard contra
 * contenido que no tiene ningún problema.
 */
const MARCAS_PROHIBIDAS = [
  'ak47', 'ak-47', 'kalashnikov',
  'm4a1', 'm4a4', 'm16', 'colt',
  'awp', 'arctic warfare',
  'deagle', 'desert eagle',
  'glock', 'famas', 'galil',
  'sg553', 'sg 553', 'aug',
  'mp5', 'mp7', 'mp9', 'mac10', 'mac-10', 'ump45', 'ump-45',
  'p90', 'bizon', 'negev', 'm249', 'minimi',
  'xm1014', 'mag7', 'mag-7', 'nova',
  'tec9', 'tec-9', 'cz75', 'cz-75', 'five-seven', 'fiveseven',
  'usp', 'p2000', 'p250', 'ssg08', 'ssg 08', 'scar20', 'scar-20', 'g3sg1',
  'heckler', 'koch', 'sig sauer', 'steyr', 'benelli', 'ithaca', 'beretta',
  'counter-strike', 'counter strike',
]

/** Sin acentos y en minúscula: "Cárpato" y "carpato" tienen que compararse
 *  igual, o la lista negra se esquiva sola con una tilde. */
function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

describe('catálogo de armas derivadas de Source', () => {
  it('no repite slugs', () => {
    const slugs = SOURCE_WEAPONS.map((e) => e.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('no repite nombres mostrados', () => {
    const nombres = SOURCE_WEAPONS.map((e) => e.name)
    expect(new Set(nombres).size).toBe(nombres.length)
  })

  it('cada arma mapea a un arquetipo que EXISTE: ninguna queda sin estadísticas', () => {
    for (const entry of SOURCE_WEAPONS) {
      expect(ARCHETYPES[entry.archetype], `${entry.slug} -> ${entry.archetype}`).toBeDefined()
      expect(ARCHETYPES[entry.archetype].id).toBe(entry.archetype)
    }
  })

  it('no inventa arquetipos: usa un subconjunto de los 10 calibrados', () => {
    const usados = new Set<ArchetypeId>(SOURCE_WEAPONS.map((e) => e.archetype))
    for (const id of usados) expect(Object.keys(ARCHETYPES)).toContain(id)
    // Y cubre las 7 clases: si el mapeo colapsara todo a una sola clase, el
    // arsenal nuevo serían 39 armas que se juegan igual.
    const clases = new Set(SOURCE_WEAPONS.map((e) => ARCHETYPES[e.archetype].class))
    expect(clases.size).toBe(7)
  })

  it('el índice por slug tiene una entrada por arma', () => {
    expect(SOURCE_WEAPONS_BY_SLUG.size).toBe(SOURCE_WEAPONS.length)
    for (const entry of SOURCE_WEAPONS) {
      expect(SOURCE_WEAPONS_BY_SLUG.get(entry.slug)).toBe(entry)
    }
  })

  it('las variantes sin visor comparten arquetipo con su versión con óptica', () => {
    const variantes = SOURCE_WEAPONS.filter((e) => e.slug.endsWith('_scopeless'))
    // Si esto quedara en cero, el test de abajo pasaría vacío y no probaría
    // nada. Las variantes existen; que sean 6 es el dato del pipeline.
    expect(variantes.length).toBeGreaterThan(0)

    for (const variante of variantes) {
      const base = SOURCE_WEAPONS_BY_SLUG.get(variante.slug.replace('_scopeless', ''))
      expect(base, `falta la versión con visor de ${variante.slug}`).toBeDefined()
      expect(variante.archetype).toBe(base?.archetype)
      expect(variante.sight).toBe('hierros')
      expect(base?.sight).toBe('optica')
    }
  })
})

describe('lista negra de marcas', () => {
  it('ningún nombre mostrado del catálogo de Source contiene una marca', () => {
    for (const entry of SOURCE_WEAPONS) {
      const nombre = normalizar(entry.name)
      for (const marca of MARCAS_PROHIBIDAS) {
        expect(nombre, `"${entry.name}" (${entry.slug}) contiene "${marca}"`).not.toContain(marca)
      }
    }
  })

  it('tampoco lo contiene ningún nombre del catálogo CC0 que ya está en el juego', () => {
    // La regla es sobre TODO lo que se muestra, no sólo sobre lo nuevo: si
    // mañana alguien renombra un arma CC0, este guard también lo agarra.
    for (const entry of weaponIndex()) {
      const nombre = normalizar(entry.name)
      for (const marca of MARCAS_PROHIBIDAS) {
        expect(nombre, `"${entry.name}" (${entry.slug}) contiene "${marca}"`).not.toContain(marca)
      }
    }
  })

  it('la lista negra de verdad detecta una marca (si no, los dos tests de arriba pasan vacíos)', () => {
    // Sin esto, un error de tipeo en `normalizar` o una lista negra vacía
    // dejarían los dos tests anteriores en verde para siempre sin comprobar
    // nada. Acá se le da de comer un nombre prohibido a propósito.
    const nombreMalo = normalizar('AK-47 Redline')
    const detectada = MARCAS_PROHIBIDAS.some((marca) => nombreMalo.includes(marca))
    expect(detectada).toBe(true)
  })
})
