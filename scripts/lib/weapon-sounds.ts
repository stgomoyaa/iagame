/**
 * Lógica pura del preparador de sonidos de disparo (ver
 * scripts/prepare-weapon-sounds.ts). Acá vive todo lo que se puede decidir
 * mirando sólo nombres de archivo: qué archivo de un pack es un disparo, a
 * qué arma del pack pertenece, y a cuál de nuestras 79 armas se le asigna.
 * El script driver hace el I/O y llama a ffmpeg.
 *
 * POR QUÉ LA REGLA DE "QUÉ ES UN DISPARO" ES POR PACK Y NO GLOBAL
 * Los tres packs guardan el sonido de disparo con convenciones distintas, y
 * una regla única se equivoca en los tres:
 *
 *  - **M9k Remastered**: NO marca el disparo en el nombre. Lo que separa el
 *    disparo del resto es la EXTENSIÓN: dentro de `sound/weapons/<arma>/`,
 *    los .wav son los disparos y los .mp3 son la mecánica (magin, magout,
 *    boltpull, clipin, draw, cloth...). Esto invierte lo que uno esperaría
 *    del conteo crudo del .gma —465 mp3 contra 126 wav— y es la razón por la
 *    que "casi todo M9k ya viene en mp3" NO significa "los disparos no hay
 *    que transcodificarlos": los 465 mp3 son recargas. Verificado sobre los
 *    111 .wav bajo `weapons/`: todos son disparos.
 *
 *  - **MW Classic** y **Black Ops Classic** (ambos ARC9): sí marcan el
 *    disparo en el nombre (`fire.wav`, `fire1..N.wav`), pero conviven con
 *    `fire_dist*` (la versión LEJANA, que suena apagada y no sirve como
 *    disparo en primera persona) y con `fire_loop/_start/_stop` (minigun y
 *    lanzallamas, que son un loop y no un disparo suelto). Los tres se
 *    excluyen a propósito.
 *
 * POR QUÉ LA IDENTIDAD DEL ARMA ES LA CARPETA Y NO EL NOMBRE DEL ARCHIVO
 * En M9k el nombre del archivo MIENTE: `hk_g3/galil-1.wav` es el disparo de
 * un G3 guardado en un archivo que se llama "galil", porque el pack reusa el
 * mismo asset entre varios SWEP. Lo mismo con `svt40/g3sg1-1.wav`. La
 * carpeta es la única señal confiable de qué arma es. Confiar en el nombre
 * del archivo daría un mapeo silenciosamente equivocado, que es justo el
 * tipo de bug que no se ve hasta que alguien juega y el G3 suena a Galil.
 */

/** Los tres packs del Workshop de los que salen los disparos. */
export type PackId = 'm9k' | 'mwclassic' | 'blackops'

export const PACK_IDS: readonly PackId[] = ['m9k', 'mwclassic', 'blackops']

/**
 * Subcarpeta, dentro del pack extraído, bajo la cual vive UNA carpeta por
 * arma. Todo lo que esté fuera de ahí se ignora: en M9k, `sound/` a secas
 * trae voces y memes (`wilhelm.wav`, `we_suck_again.wav`) que no son armas.
 */
const RAIZ_DE_ARMAS: Record<PackId, string> = {
  m9k: 'sound/weapons',
  mwclassic: 'sound/weapons/arc9',
  blackops: 'sound/weapons/arc9',
}

/** Sufijos de ARC9 que llevan "fire" en el nombre pero no son un disparo
 *  utilizable en primera persona. Ver el encabezado. */
const ARC9_NO_ES_DISPARO = /(^|[_-])(dist|loop|start|stop)([_-]|\d|$)/

export interface ArchivoDePack {
  /** Carpeta del arma dentro del pack, p. ej. `bo1_ak47` o `hk_g3`. */
  readonly arma: string
  /** Nombre del archivo con extensión. */
  readonly archivo: string
}

/**
 * Decide si una ruta relativa a la raíz del pack es un disparo, y de qué
 * arma. Devuelve null cuando no lo es (mecánica, voces, subcarpetas
 * anidadas, extensión desconocida).
 *
 * `rutaRelativa` usa siempre `/` como separador.
 */
export function clasificarArchivo(pack: PackId, rutaRelativa: string): ArchivoDePack | null {
  const raiz = `${RAIZ_DE_ARMAS[pack]}/`
  if (!rutaRelativa.startsWith(raiz)) return null

  const resto = rutaRelativa.slice(raiz.length)
  const partes = resto.split('/')
  // Exactamente `<arma>/<archivo>`: ni suelto en la raíz ni más anidado.
  if (partes.length !== 2) return null

  const [arma, archivo] = partes
  if (arma.length === 0 || archivo.length === 0) return null

  const punto = archivo.lastIndexOf('.')
  if (punto <= 0) return null
  const base = archivo.slice(0, punto).toLowerCase()
  const ext = archivo.slice(punto + 1).toLowerCase()

  if (pack === 'm9k') {
    // La extensión ES la señal: .wav = disparo, .mp3 = mecánica.
    return ext === 'wav' ? { arma, archivo } : null
  }

  // ARC9 (mwclassic y blackops).
  if (ext !== 'wav' && ext !== 'ogg') return null
  if (!base.startsWith('fire')) return null
  if (ARC9_NO_ES_DISPARO.test(base.slice('fire'.length))) return null

  // Ojo: acá `arma` es SIEMPRE la carpeta. Repartir una carpeta en varias
  // fuentes (pozos `*generic*`, calibres del Deagle) necesita ver la carpeta
  // completa y es trabajo de `clasificarCarpeta`, no de esta función.
  return { arma, archivo }
}

/** Identificador estable de una fuente de sonido: pack + carpeta del arma. */
export function idDeFuente(pack: PackId, arma: string): string {
  return `${pack}__${arma}`
}

/** Nombre canónico de variante en ARC9: `fire.wav`, `fire1.wav`, `fire2.wav`... */
const ARC9_VARIANTE_CANONICA = /^fire\d*$/

/**
 * Agrupa los archivos de UNA carpeta de arma en fuentes de sonido. Devuelve
 * `arma -> archivos`, donde `arma` puede ser la carpeta o una subdivisión de
 * ella.
 *
 * POR QUÉ ESTO NO SE PUEDE DECIDIR ARCHIVO POR ARCHIVO
 * En ARC9 conviven dos convenciones dentro de la misma carpeta y significan
 * cosas opuestas:
 *
 *   - `fire.wav` / `fire1..N.wav` son VARIANTES de la misma arma: el juego
 *     alterna entre ellas para que ráfagas seguidas no suenen calcadas. Son
 *     lo que queremos agrupar bajo un arma.
 *   - `fire_<algo>.wav` es OTRA arma (o el arma con otro cañón/calibre)
 *     guardada de prestado en esa carpeta: `bo1_python` trae `fire_judge` y
 *     `fire_nma`, que no son un Python; `mw3e_deagle` trae `fire_357`,
 *     `fire_44` y `fire_50`, que son tres calibres distintos.
 *
 * Meterlas todas juntas haría que un revólver disparara a veces como una
 * escopeta-pistola, que es exactamente lo contrario del objetivo de la tarea
 * (que se pueda distinguir de oído qué arma te dispara). Y descartar sin más
 * las `fire_<algo>` tampoco sirve: hay carpetas —el Deagle— donde son las
 * ÚNICAS que hay, y el arma quedaría muda.
 *
 * La regla que sale de eso necesita ver la carpeta entera, no un archivo:
 * si hay variantes canónicas, ésas mandan y las `fire_<algo>` se ignoran; si
 * no hay ninguna, cada `fire_<algo>` pasa a ser su propia fuente. Es también
 * lo que resuelve las carpetas `*generic*`, que son un pozo de armas sueltas
 * y nunca traen variante canónica.
 */
export function clasificarCarpeta(
  pack: PackId,
  arma: string,
  archivos: readonly string[],
): Map<string, string[]> {
  const raiz = RAIZ_DE_ARMAS[pack]
  const disparos = archivos.filter((a) => clasificarArchivo(pack, `${raiz}/${arma}/${a}`) !== null)
  const salida = new Map<string, string[]>()
  if (disparos.length === 0) return salida

  if (pack === 'm9k') {
    salida.set(arma, [...disparos].sort())
    return salida
  }

  const sinExt = (a: string) => a.slice(0, a.lastIndexOf('.')).toLowerCase()
  const canonicas = disparos.filter((a) => ARC9_VARIANTE_CANONICA.test(sinExt(a)))
  if (canonicas.length > 0) {
    salida.set(arma, [...canonicas].sort())
    return salida
  }

  for (const a of [...disparos].sort()) {
    const sufijo = sinExt(a).slice('fire'.length).replace(/^[_-]/, '')
    salida.set(sufijo.length > 0 ? `${arma}__${sufijo}` : arma, [a])
  }
  return salida
}

/**
 * Asignación explícita de cada una de nuestras 79 armas a un arma de pack.
 *
 * POR QUÉ ESTA TABLA ES A MANO Y NO SE INFIERE
 * Nuestro catálogo tiene dos mitades con problemas opuestos, y ninguna se
 * resuelve sola:
 *
 *  1. Las 39 armas derivadas de CS:GO (`ak47`, `awp`, `deagle`...) SÍ tienen
 *     nombre real, así que un match por token acierta varias. Pero falla en
 *     todas las que el pack guarda bajo otro nombre real: nuestro `ssg08` es
 *     el Scout, `sg553` es el SG552 del pack, `p250` es el P228, `negev` es
 *     un PKP, `sawedoff` es un `dbarrel`, `mag7` es un Striker. Ningún
 *     algoritmo de strings sabe que un SSG08 y un Scout son la misma arma:
 *     eso es conocimiento del mundo, no de los nombres.
 *
 *  2. Las 40 armas CC0 (`assaultrifle-3`, `pistol-5`, `bullpup-2`...) NO
 *     tienen identidad real NINGUNA. El nombre sólo dice la clase. No existe
 *     dato en "assaultrifle-3" que permita derivar qué fusil real es, porque
 *     no es ninguno. Para éstas la asignación es necesariamente ARBITRARIA:
 *     lo único que se puede garantizar es que sea de la clase correcta,
 *     distinta de sus hermanas y ESTABLE entre corridas. Eso es exactamente
 *     lo que da una tabla escrita, y es lo que un algoritmo no puede
 *     "acertar" porque no hay nada que acertar.
 *
 * Es el mismo razonamiento que ya documenta `registry.ts` para los
 * arquetipos, en espejo: allá los slugs genéricos se infieren y los reales
 * necesitan tabla; acá los reales se pueden inferir a medias y los genéricos
 * necesitan tabla.
 *
 * Las variantes `_scopeless` comparten fuente con su arma con mira A
 * PROPÓSITO: son la misma arma con y sin óptica, y deben sonar igual.
 * Compartir ahí no es un agujero de cobertura.
 */
export const ASIGNACION: Readonly<Record<string, string>> = {
  // --- Fusiles de asalto, derivados de CS:GO ---
  ak47: 'blackops__bo1_ak47',
  m4a4: 'blackops__bo1_m16',
  m4a1s: 'mwclassic__mw3e_m4m16__m4',
  galil: 'blackops__bo1_galil',
  famas: 'blackops__bo1_famas',
  aug: 'blackops__bo1_aug',
  aug_scopeless: 'blackops__bo1_aug',
  sg553: 'm9k__hksl8',
  sg553_scopeless: 'm9k__hksl8',

  // --- Fusiles de asalto, CC0 (asignación arbitraria pero estable) ---
  'assaultrifle-1': 'mwclassic__cod4_ak47',
  'assaultrifle-2': 'mwclassic__cod4_m4m16',
  'assaultrifle-3': 'mwclassic__cod4_g3',
  'assaultrifle-4': 'mwclassic__mw2e_acr',
  'assaultrifle-5': 'mwclassic__mw3e_g36',
  'assaultrifle2-1': 'mwclassic__mw2e_famas',
  'assaultrifle2-2': 'mwclassic__mw2e_fnfal',
  'assaultrifle2-3': 'mwclassic__mw3e_scarl',
  'assaultrifle2-4': 'mwclassic__mw2e_tavor',
  'bullpup-3': 'mwclassic__mw2e_f2000',

  // --- Ametralladoras ---
  m249: 'mwclassic__cod4_m249__mn',
  negev: 'mwclassic__mw3e_pkp',

  // --- Semiautomáticos de precisión ---
  scar20: 'mwclassic__mw2e_scarh',
  scar20_scopeless: 'mwclassic__mw2e_scarh',
  g3sg1: 'blackops__bo1_psg1',
  g3sg1_scopeless: 'blackops__bo1_psg1',

  // --- Pistolas, derivadas de CS:GO ---
  deagle: 'mwclassic__mw3e_deagle__50',
  glock18: 'mwclassic__mw3e_glock',
  usps: 'm9k__fokku_tc_usp',
  p2000: 'm9k__hk45',
  p250: 'm9k__sig_p228',
  fiveseven: 'mwclassic__mw3e_fiveseven',
  cz75: 'blackops__bo1_cz75',
  revolver: 'blackops__bo1_python',
  tec9: 'm9k__tec9',

  // --- Pistolas y revólveres, CC0 ---
  'pistol-1': 'blackops__bo1_m1911',
  'pistol-2': 'mwclassic__cod4_m9',
  'pistol-3': 'blackops__bo1_makarov',
  'pistol-4': 'mwclassic__mw3e_p99',
  'pistol-5': 'blackops__waw_p38',
  'pistol-6': 'blackops__bo1_asp',
  'revolver-1': 'mwclassic__mw3e_anaconda',
  'revolver-2': 'blackops__waw_357',
  'revolver-3': 'mwclassic__mw3e_mp412',
  'revolver-4': 'm9k__model500',
  'revolver-5': 'm9k__model3',

  // --- Escopetas, derivadas de CS:GO ---
  nova: 'mwclassic__cod4_w1200',
  xm1014: 'mwclassic__cod4_m1014',
  sawedoff: 'm9k__dbarrel',
  mag7: 'mwclassic__mw3e_striker',

  // --- Escopetas, CC0 ---
  'shotgun-1': 'blackops__bo1_generic_shotgun__ithaca',
  'shotgun-2': 'blackops__bo2_generic_shotgun__870',
  'shotgun-3': 'mwclassic__mw3e_ksg',
  'shotgun-4': 'blackops__bo2_generic_shotgun__1216',
  'shotgun-sawedoff': 'm9k__1887winchester',
  'shotgun-shortstock': 'm9k__1897trench',

  // --- Subfusiles, derivados de CS:GO ---
  mp5sd: 'm9k__hkmp5sd',
  ump45: 'mwclassic__mw3e_ump45',
  mp7: 'mwclassic__mw3e_mp7',
  mp9: 'mwclassic__mw3e_mp9',
  mac10: 'blackops__bo1_mac11',
  p90: 'mwclassic__cod4_p90',
  bizon: 'blackops__bo1_pm63',

  // --- Subfusiles, CC0 ---
  'bullpup-1': 'mwclassic__mw2e_vector',
  'bullpup-2': 'blackops__bo1_spectre',
  'submachinegun-1': 'mwclassic__cod4_uzi',
  'submachinegun-2': 'mwclassic__cod4_skorpion',
  'submachinegun-3': 'blackops__bo1_kiparis',
  'submachinegun-4': 'blackops__waw_thompson',
  'submachinegun-5': 'blackops__waw_mp40',

  // --- Francotiradores, derivados de CS:GO ---
  awp: 'mwclassic__mw3e_awm',
  awp_scopeless: 'mwclassic__mw3e_awm',
  ssg08: 'mwclassic__cod4_m40',
  ssg08_scopeless: 'mwclassic__cod4_m40',

  // --- Francotiradores, CC0 ---
  'sniperrifle-1': 'mwclassic__cod4_dragunov',
  'sniperrifle-2': 'mwclassic__cod4_m82',
  'sniperrifle-3': 'blackops__bo1_l96',
  'sniperrifle-4': 'mwclassic__mw3e_msr',
  'sniperrifle-5': 'blackops__waw_kar98k',
  'sniperrifle-6': 'mwclassic__mw3e_barrett',

  // =======================================================================
  // PACK DE CALL OF DUTY (ARC9): las 69 armas de `game: 'COD'`.
  // =======================================================================
  //
  // Estas armas son un TERCER caso, distinto de los dos que documenta el
  // encabezado de la tabla, y conviene decirlo porque invita a un atajo que
  // está mal.
  //
  // El atajo: los modelos salen del MISMO pack ARC9 que los sonidos, así que
  // el slug del modelo y la carpeta de sonido se llaman igual
  // (`cod4_ak47.mdl` <-> `sound/weapons/arc9/cod4_ak47/`). Acá la identidad
  // no es una inferencia de strings: es el mismo autor y el mismo pack. Uno
  // pensaría entonces que estas 69 filas se pueden generar solas.
  //
  // Por qué NO se generaron solas, medido y no supuesto:
  //
  //  1. **46 de las 69 tienen su carpeta propia ya TOMADA** por un arma de
  //     CS o CC0 que la reclamó primero (`assaultrifle-1` se quedó con
  //     `cod4_ak47`, `mp7` con `mw3e_mp7`, `nova` con `cod4_w1200`). El test
  //     `sólo comparte fuente entre un arma y su variante sin mira` prohíbe
  //     que dos armas distintas compartan fuente, así que la carpeta obvia
  //     no está disponible y hay que elegir otra a mano.
  //
  //  2. **7 no tienen disparo en su carpeta propia**, aunque la carpeta
  //     exista: `cod4_mp44` (el StG-44) trae `chamber.wav` e `in.wav` y nada
  //     más, y `mw3e_spas12` sólo trae `back/fwd/lift/loop`. Asignarlas a su
  //     carpeta homónima las dejaría MUDAS, y el nombre coincidiendo es
  //     justo lo que haría que nadie lo revisara.
  //
  //  3. **El match por token miente feo acá.** `normalizarToken` borra el
  //     sufijo numérico, así que `mw2e_m16` y `waw_m1919` colapsan los dos a
  //     `"m"` y matchean entre sí; lo mismo `cod4_m1911` con `waw_m1919`, y
  //     `mw2e_g17` con `waw_g43`. Un generador por tokens le habría puesto a
  //     un M16 el sonido de una ametralladora Browning de 1919 sin que nada
  //     fallara. Es la misma razón por la que `medirAutomatch` sólo mide.
  //
  // El criterio con el que se eligió cada fila, en este orden:
  //   a. la carpeta propia del arma, si tiene disparo y está libre (23 casos);
  //   b. si no, LA MISMA ARMA REAL en otro sub-pack — el pack trae el AK-47 en
  //      `cod4`, `mw2e` y `mw3e`, y M9k trae media OTAN con su nombre real
  //      (`m9k__fnscarh`, `m9k__hk_g3`, `m9k__beretta92`, `m9k__svd`,
  //      `m9k__kriss` para el Vector, `m9k__masadamagpul` para el ACR);
  //   c. sólo si no existe la misma arma, el pariente real más cercano, y en
  //      esos casos el comentario dice cuál es el parentesco.
  //
  // No hay ninguna asignación arbitraria en este bloque: a diferencia de las
  // 40 CC0, estas 69 SÍ son armas reales identificadas, así que "de la clase
  // correcta" no era suficiente.

  // --- COD: fusiles de asalto ---
  cod4_ak47: 'mwclassic__mw3e_ak47', // el mismo AK-47 del pack, sub-pack MW3
  mw3e_m4a1: 'm9k__dmg_m4a1',
  mw2e_acr: 'mwclassic__mw3e_acr', // el mismo ACR, sub-pack MW3
  cod4_g36c: 'mwclassic__cod4_g36c', // carpeta propia, libre
  mw3e_g36: 'm9k__g36',
  mw2e_f2000: 'm9k__fokku_tc_f2000',
  mw2e_tavor: 'm9k__tavor',
  // El StG-44 propio no trae disparo (ver punto 2). Se le da el AK-47 de
  // MW2E: el AK es el descendiente directo del StG-44 y comparte cartucho
  // intermedio, que es lo que define el timbre.
  cod4_mp44: 'mwclassic__mw2e_ak47',
  mw3e_scarl: 'blackops__bo2_generic_ar__scar',
  mw3e_fad: 'mwclassic__mw3e_fad', // carpeta propia, libre
  mw3e_cm901: 'mwclassic__mw3e_cm901', // carpeta propia, libre
  mw2e_m16: 'm9k__dmg_m16a4',
  mw2e_famas: 'm9k__fokku_tc_famas',
  mw3e_qbz97: 'mwclassic__mw3e_qbz97', // carpeta propia, libre
  mw2e_scar: 'm9k__fnscarh',
  mw2e_fnfal: 'm9k__fn_fal',
  cod4_g3: 'm9k__hk_g3',
  cod4_m14: 'mwclassic__cod4_m14', // carpeta propia, libre
  mw2e_aug: 'mwclassic__mw2e_aug', // carpeta propia, libre

  // --- COD: subfusiles ---
  cod4_mp5: 'mwclassic__cod4_mp5', // carpeta propia, libre
  mw3e_ump45: 'm9k__hk_ump45',
  mw3e_ak74u: 'mwclassic__mw3e_ak74u', // carpeta propia, libre
  mw2e_mp5k: 'blackops__bo2_mp5', // el MP5K es un MP5 de cañón corto
  cod4_uzi: 'm9k__uzi',
  cod4_p90: 'mwclassic__mw3e_p90', // el mismo P90, sub-pack MW3
  cod4_skorpion: 'blackops__bo1_skorpion',
  mw2e_vector: 'm9k__kriss', // el Vector ES el KRISS Vector
  mw2e_pp2000: 'mwclassic__mw2e_pp2000', // carpeta propia, libre
  mw3e_pp90m1: 'mwclassic__mw3e_pp90m1', // carpeta propia, libre
  mw3e_mp7: 'm9k__mp7',
  mw3e_mp9: 'm9k__mp9',
  mw3e_fmg9: 'mwclassic__mw3e_fmg9', // carpeta propia, libre
  mw3e_pm9: 'mwclassic__mw3e_pm9', // carpeta propia, libre

  // --- COD: escopetas ---
  cod4_w1200: 'm9k__m37', // W1200 y M37 son las dos de corredera del mismo porte
  cod4_m1014: 'm9k__benellim3', // el M1014 ES el Benelli M4
  mw2e_spas12: 'm9k__spas_12', // la carpeta propia no trae disparo (punto 2)
  mw3e_striker: 'm9k__striker12',
  mw3e_aa12: 'm9k__jackhammer', // las dos son escopeta automática de tambor
  mw3e_ksg12: 'blackops__bo2_generic_shotgun__ksg',
  mw3e_usas12: 'm9k__usas12',
  mw3e_m1887: 'm9k__winchester73', // las dos son de palanca Winchester

  // --- COD: francotiradores ---
  cod4_m40a3: 'm9k__dmg_m24', // el M24 es la versión Army del mismo M40/R700
  cod4_r700: 'm9k__remington',
  mw2e_cheytac: 'mwclassic__mw2e_cheytac', // carpeta propia, libre
  mw3e_awm: 'blackops__bo2_generic_sniper__ballista',
  mw3e_msr: 'blackops__bo2_generic_sniper__dsr',
  cod4_m82: 'm9k__m82',
  mw3e_as50: 'mwclassic__mw3e_as50', // carpeta propia, libre
  cod4_dragunov: 'm9k__svd', // el Dragunov ES el SVD
  mw3e_rsass: 'mwclassic__mw3e_rsass', // carpeta propia, libre
  mw3e_mk14: 'mwclassic__mw3e_mk14', // carpeta propia, libre

  // --- COD: ametralladoras ---
  // La carpeta `cod4_m249` no tiene disparo canónico y se parte en variantes:
  // `__mn` ya la tomó el M249 de CS, así que acá va `__sl`. Es la MISMA arma
  // grabada distinto, no otra.
  cod4_m249: 'mwclassic__cod4_m249__sl',
  cod4_m60: 'mwclassic__cod4_m60', // carpeta propia, libre
  cod4_rpd: 'mwclassic__cod4_rpd', // carpeta propia, libre
  mw2e_m240: 'mwclassic__mw2e_m240', // carpeta propia, libre
  mw2e_mg4: 'mwclassic__mw2e_mg4', // carpeta propia, libre
  mw3e_mk46: 'mwclassic__mw3e_mk46', // carpeta propia, libre
  mw3e_pkp: 'm9k__pkm', // el Pecheneg es un PKM modernizado
  mw3e_l86: 'mwclassic__mw3e_l86', // carpeta propia, libre
  mw3e_mg36: 'mwclassic__mw3e_mg36', // carpeta propia, libre

  // --- COD: pistolas y revólveres ---
  cod4_m1911: 'mwclassic__cod4_1911', // carpeta propia, libre
  cod4_m9: 'm9k__beretta92', // la M9 ES la Beretta 92
  cod4_usp: 'blackops__bo2_generic_pistol__heavy', // no hay USP libre; .45 pesada
  mw2e_g17: 'm9k__dmg_glock',
  mw3e_deagle: 'mwclassic__mw3e_deagle__44', // el mismo Deagle, calibre .44
  mw3e_fiveseven: 'blackops__bo2_generic_pistol__kard',
  mw3e_p99: 'blackops__bo2_generic_pistol__light',
  mw3e_anaconda: 'm9k__coltpython', // la Anaconda es la Python en .44
  mw3e_mp412: 'm9k__r_bull', // los dos son revólver de armazón grande
}

/**
 * Normaliza un nombre a un token comparable: minúsculas, sin prefijo de pack
 * (`cod4_`, `mw2e_`, `mw3e_`, `bo1_`, `bo2_`, `waw_`...), sin separadores y
 * sin sufijos numéricos de variante. Sólo se usa para MEDIR cuántas armas
 * habrían matcheado solas (ver `medirAutomatch`), nunca para decidir la
 * asignación real: la tabla manda.
 */
export function normalizarToken(nombre: string): string {
  return nombre
    .toLowerCase()
    .replace(/^(cod4|cod|mw2e|mw3e|mwc|bo1|bo2|boc|bocw|waw|cde|dmg|fokku_tc|jen|schmung)[._-]/, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/\d+$/, '')
}

/**
 * Cuántos de nuestros slugs habrían encontrado su fuente por comparación de
 * tokens, sin la tabla. Es el número honesto que responde "¿esto se puede
 * automatizar?"; se reporta, no se usa para asignar.
 */
export function medirAutomatch(slugs: readonly string[], fuentes: readonly string[]): string[] {
  const porToken = new Map<string, string>()
  for (const f of fuentes) {
    const arma = f.slice(f.indexOf('__') + 2)
    const t = normalizarToken(arma)
    if (t.length > 0 && !porToken.has(t)) porToken.set(t, f)
  }
  return slugs.filter((s) => porToken.has(normalizarToken(s)))
}
