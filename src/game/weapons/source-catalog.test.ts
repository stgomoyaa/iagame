import { describe, expect, it } from 'vitest'
import { ARCHETYPES, type ArchetypeId } from '@/game/weapons/archetypes'
import { weaponIndex } from '@/game/weapons/registry'
import {
  SOURCE_WEAPONS,
  SOURCE_WEAPONS_BY_SLUG,
  sourceWeaponDisplayName,
} from '@/game/weapons/source-catalog'

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
  'r8 revolver',
  'tec9', 'tec-9', 'cz75', 'cz-75', 'five-seven', 'fiveseven',
  'usp', 'p2000', 'p250', 'ssg08', 'ssg 08', 'scar20', 'scar-20', 'g3sg1',
  'heckler', 'koch', 'sig sauer', 'steyr', 'benelli', 'ithaca', 'beretta',
  'counter-strike', 'counter strike',

  // Marcas que entraron con el pack de COD. Sumarlas acá no es sólo para que
  // el conteo del catálogo local dé: la lista es la MISMA que usa el guard de
  // las publicables, así que cada nombre agregado acá le pone un diente más a
  // ese guard. Si mañana un arma CC0 se llamara "Barrett", ahora falla.
  'acr', 'masada', 'g36', 'f2000', 'tar-21', 'tavor', 'stg-44', 'stg44',
  'scar-l', 'scar-h', 'scar', 'fad', 'cm901', 'm16a4', 'type 95', 'qbz',
  'fn fal', 'fnfal', 'fal', 'g3', 'm14', 'hbar',
  'ak-74', 'ak74', 'uzi', 'skorpion', 'vector', 'kriss',
  'pp-2000', 'pp2000', 'pp90', 'fmg9', 'pm-9',
  'w1200', 'winchester', 'm1014', 'spas-12', 'spas12', 'striker', 'aa-12',
  'ksg', 'usas', 'model 1887', '1887',
  'm40a3', 'm40', 'r700', 'remington', 'intervention', 'cheytac',
  'l118a', 'accuracy international', 'msr', 'barrett', '.50cal', 'as50',
  'dragunov', 'svd', 'rsass', 'mk14', 'ebr',
  // Ojo: acá NO va 'saw' suelto. El M249 SAW ya lo cubre 'm249', y 'saw' como
  // subcadena matchea "Sawed-Off", que es una escopeta CC0 de nombre genérico
  // y no una marca. Ese falso positivo lo detectó este mismo guard.
  'm60', 'rpd', 'm240', 'mg4', 'mk46', 'pkp', 'pecheneg', 'l86',
  'lsw', 'mg36',
  'm1911', '1911', 'm9', 'p99', '.44 magnum', 'magnum', 'mp-412', 'mp412',
  'rex', 'anaconda',
  'fn herstal', 'herstal', 'walther', 'izhmash', 'iwi',
  'call of duty', 'modern warfare',
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

  // El nombre real SÍ se repite entre packs, y tiene que poder repetirse: el
  // AK-47 de CS y el de COD se llaman los dos AK-47 porque son la misma arma
  // real vista por dos autores. Lo que no puede repetirse es dentro de UN
  // pack, que sí sería un error de tipeo o una fila duplicada.
  //
  // Este test reemplaza a uno anterior que exigía el nombre único en toda la
  // tabla. Esa invariante era correcta mientras hubo un solo pack y dejó de
  // serlo al entrar COD; la que la sustituye no es más débil, porque el caso
  // que aquélla atrapaba (dos filas iguales) lo sigue atrapando, y el de
  // "nombre+juego repetido" lo cubre el test de nombres mostrados de abajo.
  it('no repite nombres DENTRO de un mismo pack', () => {
    const porJuego = new Map<string, string[]>()
    for (const e of SOURCE_WEAPONS) {
      porJuego.set(e.game, [...(porJuego.get(e.game) ?? []), e.name])
    }
    expect(porJuego.size).toBeGreaterThan(1) // si no, no está probando nada
    for (const [juego, nombres] of porJuego) {
      const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i)
      expect(repetidos, `nombres repetidos en ${juego}`).toEqual([])
    }
  })

  // Y el complemento: que el cruce entre packs de verdad ocurra. Si mañana
  // alguien "arreglara" la colisión renombrando el AK-47 de COD a
  // "AK-47 COD", el test de arriba seguiría verde y la etiqueta de juego
  // habría dejado de servir para lo único que existe.
  it('hay armas homónimas entre packs: es el caso que la etiqueta resuelve', () => {
    const nombres = SOURCE_WEAPONS.map((e) => e.name)
    const repetidos = [...new Set(nombres.filter((n, i) => nombres.indexOf(n) !== i))]
    expect(repetidos.sort()).toEqual(['AK-47', 'Desert Eagle', 'FAMAS', 'MP7', 'MP9', 'P90'])
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

describe('lista negra de marcas: la separación publicable / local', () => {
  /**
   * La regla YA NO es "ninguna marca en ningún lado": las 39 locales llevan su
   * nombre real a propósito (ver el encabezado de source-catalog.ts). Lo que
   * este bloque protege es la SEPARACIÓN, que es lo que de verdad importa y lo
   * único que puede erosionarse en silencio:
   *
   * - Lo PUBLICABLE (las CC0 de public/assets/weapons/, que se commitean) no
   *   puede tener ni una marca. Acá el guard sigue teniendo los mismos dientes
   *   que antes.
   * - Lo LOCAL (gitignoreado, nunca publicado) tiene que tener nombre real y
   *   etiqueta de juego. Se afirma en positivo: si alguien "arreglara" el
   *   catálogo volviendo a nombres inventados, este test lo agarra igual que
   *   agarraría una marca del lado publicable.
   */

  it('ningún nombre PUBLICABLE (CC0) contiene una marca', () => {
    // `origin` es el filtro, no "las que no están en SOURCE_WEAPONS": si otro
    // test de la misma corrida ya cargó el índice local, weaponIndex() trae
    // las 79 y este test tiene que seguir mirando sólo las publicables.
    const publicables = weaponIndex().filter((e) => e.origin === 'cc0')
    expect(publicables.length).toBeGreaterThan(0)

    for (const entry of publicables) {
      const nombre = normalizar(entry.name)
      for (const marca of MARCAS_PROHIBIDAS) {
        expect(nombre, `"${entry.name}" (${entry.slug}) contiene "${marca}"`).not.toContain(marca)
      }
    }
  })

  it('el catálogo LOCAL sí está lleno de marcas reales', () => {
    // El complemento del test de arriba, y la mitad que impide que alguien
    // "arregle" esto volviendo a los nombres inventados. No se exige una marca
    // por arma: unas cuantas se llaman de verdad con una palabra genérica
    // ("Nova", "Sawed-Off"), y ésas no son marca ni acá ni en el pack CC0 — es
    // la misma razón por la que la lista negra no las incluye.
    const conMarca = SOURCE_WEAPONS.filter((entry) => {
      const nombre = normalizar(entry.name)
      return MARCAS_PROHIBIDAS.some((marca) => nombre.includes(marca))
    })
    expect(conMarca.length).toBeGreaterThan(SOURCE_WEAPONS.length * 0.75)

    // Y las emblemáticas, uno por uno: si el AK-47 dejara de llamarse AK-47,
    // el porcentaje de arriba podría seguir dando bien y el pedido estaría
    // igualmente incumplido.
    const esperados: Record<string, string> = {
      ak47: 'ak-47',
      m4a4: 'm4a4',
      m4a1s: 'm4a1',
      awp: 'awp',
      deagle: 'desert eagle',
      famas: 'famas',
      glock18: 'glock',
    }
    for (const [slug, marca] of Object.entries(esperados)) {
      const entry = SOURCE_WEAPONS_BY_SLUG.get(slug)
      expect(entry, slug).toBeDefined()
      expect(normalizar(entry!.name), `${slug} perdió su nombre real`).toContain(marca)
    }
  })

  it('no sobrevive ninguno de los nombres inventados viejos', () => {
    // La tabla anterior usaba nombres propios ("Cárpato" para el AK-47). Si
    // alguno reapareciera sería una fila revertida a mano.
    const inventados = ['carpato', 'halcon', 'mazo', 'chispa', 'sirocco', 'alud', 'penasco']
    const nombres = SOURCE_WEAPONS.map((e) => normalizar(e.name))
    for (const viejo of inventados) {
      expect(nombres, `volvió el nombre inventado "${viejo}"`).not.toContain(viejo)
    }
  })

  it('toda arma local lleva etiqueta de juego, y el nombre mostrado la incluye', () => {
    // La lista de etiquetas válidas se escribe acá a mano, en vez de leerse
    // del tipo: si alguien agrega un pack nuevo, este test tiene que obligarlo
    // a pasar por acá y decidir la etiqueta, no aceptarla sola.
    const ETIQUETAS = ['CS', 'COD']
    for (const entry of SOURCE_WEAPONS) {
      expect(ETIQUETAS, `${entry.slug} con etiqueta desconocida`).toContain(entry.game)
      expect(sourceWeaponDisplayName(entry)).toBe(`${entry.name} (${entry.game})`)
      expect(sourceWeaponDisplayName(entry)).toContain(`(${entry.game})`)
    }
    // Y que las DOS etiquetas estén realmente pobladas: un pack que quedara
    // con cero filas dejaría el bucle de arriba verde sin probar nada de él.
    for (const etiqueta of ETIQUETAS) {
      expect(
        SOURCE_WEAPONS.filter((e) => e.game === etiqueta).length,
        `el pack ${etiqueta} quedó vacío`,
      ).toBeGreaterThan(0)
    }
  })

  it('nombre + etiqueta es único: es lo que distingue armas homónimas de dos packs', () => {
    // El nombre real solo PUEDE repetirse entre juegos (un M4 de CS y uno de
    // COD). Lo que no puede repetirse es la combinación, que es lo que se
    // muestra.
    const mostrados = SOURCE_WEAPONS.map(sourceWeaponDisplayName)
    expect(new Set(mostrados).size).toBe(mostrados.length)
  })

  it('la lista negra de verdad detecta una marca (si no, el test de las CC0 pasa vacío)', () => {
    // Sin esto, un error de tipeo en `normalizar` o una lista negra vacía
    // dejarían el guard de las publicables en verde para siempre sin comprobar
    // nada. Acá se le da de comer un nombre prohibido a propósito.
    const nombreMalo = normalizar('AK-47 Redline')
    const detectada = MARCAS_PROHIBIDAS.some((marca) => nombreMalo.includes(marca))
    expect(detectada).toBe(true)
  })

  it('normalizar esquiva el truco de la tilde (una marca con acento sigue siendo una marca)', () => {
    expect(normalizar('Á')).toBe('a')
    expect(normalizar('AK-47').includes('ak-47')).toBe(true)
  })
})
