/**
 * Patrones de retroceso REALES, por arma, importados de Counter-Strike.
 *
 * El objetivo acá no es "un patrón propio por arma inspirado en el real": es
 * que disparar el AK-47 de este juego se sienta como disparar el AK-47 de
 * CS:GO. Lo que se adapta es lo visual (nuestra iluminación, los camuflajes);
 * la mecánica no. Por eso este archivo no suaviza, no re-deriva la forma ni la
 * sustituye por una aproximación paramétrica: son los puntos que sale de
 * reproducir el algoritmo del juego, tal cual.
 *
 * Por qué hacía falta: hasta ahora TODAS las armas compartían la misma forma —
 * `generateRecoilPattern()` (archetypes.ts) dibuja una sola silueta (rampa
 * vertical suavizada + serpenteo senoidal + jitter) y sólo cambia su tamaño,
 * su largo y su semilla. Dos armas distintas daban el mismo dibujo con otra
 * escala, así que no había nada propio que aprender.
 *
 * ## De dónde salen los números (no están medidos a ojo sobre un GIF)
 *
 * El retroceso de CS:GO no es una tabla de puntos que Valve publique: se
 * GENERA, de forma determinista, a partir de unos atributos por arma y de un
 * algoritmo que es público. Reproducirlo entero da el patrón exacto, no una
 * aproximación. Las cuatro piezas, todas de fuentes públicas:
 *
 * 1. **Atributos por arma** (`recoil seed`, `recoil angle`, `recoil angle
 *    variance`, `recoil magnitude`, `recoil magnitude variance`, `is full
 *    auto`, `cycletime`): `items_game.txt` del repo SteamDatabase/
 *    GameTracking-CSGO, commit 108f1682 (2023-02-16, la última build de la era
 *    CS:GO). CS2 movió estos valores fuera de `items_game.txt`, por eso el
 *    commit está fijado y no se usa `master`.
 * 2. **Generación de la tabla de retroceso** (64 entradas de ángulo+magnitud
 *    por arma): `WeaponRecoilData::GenerateRecoilTable` en
 *    `cs_weapon_parse.cpp`. El suavizado entre entradas consecutivas
 *    (`Lerp(weapon_recoil_variance = 0.55, ...)`) es lo que convierte ruido
 *    uniforme en una curva continua: es el origen real de la forma.
 * 3. **RNG**: `CUniformRandomStream` de `vstdlib/random.cpp` — `ran1` de
 *    Numerical Recipes (Lehmer 16807 + barajado Bays-Durham de 32 entradas).
 *    Sembrado con `recoil seed`, así que la tabla es idéntica en cada partida.
 * 4. **Aplicación y decaimiento**: `CCSPlayer::KickBack`
 *    (`cs_player_shared.cpp`) suma a la VELOCIDAD del punch angle
 *    (`yaw -= sin(angle) * mag`, `pitch -= cos(angle) * mag`), y
 *    `CCSGameMovement::DecayAimPunchAngle` (`cs_gamemovement.cpp`) integra y
 *    decae esa velocidad cada tick, con los cvars por defecto
 *    (`weapon_recoil_decay2_exp` 8, `..._lin` 18, `..._vel_decay` 4.5,
 *    `weapon_recoil_scale` 2.0). El código del motor sale de
 *    SwagSoftware/Kisak-Strike (el árbol de CS:GO).
 *
 * Simulando eso tick a tick (64 tick) y anotando el ángulo de vista en el
 * instante en que sale cada bala, se obtiene exactamente dónde pega cada tiro.
 * El resultado se validó GRAFICANDO: el AK-47 sube casi recto ~9 balas, hace
 * su pipa marcada a la DERECHA (balas 9-14), vuelve a la izquierda (15-26) y
 * cierra otra vez a la derecha — el diagrama canónico de CS. La ordenación
 * relativa sale sola y coincide con lo que todo el mundo sabe del juego: el AK
 * sube más que la M4A4 (11.77° contra 9.49°), la M4A1-S un pelo menos que la
 * M4A4, y la UMP-45 casi no se mueve en horizontal.
 *
 * ## Conversión de unidades (geométrica, sin recalibrar)
 *
 * La simulación devuelve GRADOS de ángulo de vista de CS. Un grado de ángulo
 * de vista de CS es un grado de ángulo de cámara nuestro: es la misma magnitud
 * física, no una unidad de otro sistema. Así que la conversión es exactamente
 * `degToRad` y nada más — factor 1, sin recalibrado "a ojo para que se sienta
 * bien". Lo único que cambia de convención son los signos (ver "Unidades" más
 * abajo).
 *
 * OJO, brecha conocida y deliberada: con la conversión fiel el AK-47 sube
 * 11.77° sobre el cargador, y `AR_REFERENCE_CLIMB_DEG_MIN/MAX` (archetypes.ts)
 * dice que un fusil sube 15-20°. La banda del spec era una estimación; el dato
 * real del juego es 11.77°. Se eligió la fidelidad, que es lo pedido. Los
 * arquetipos NO se tocaron: siguen con su patrón generado dentro de la banda
 * vieja, y esa banda sólo se testea contra los arquetipos.
 *
 * ## Qué arma NO tiene patrón real acá, y por qué
 *
 * Faltan a propósito 9 entradas: `famas`, `revolver`, `awp`, `awp_scopeless`,
 * `ssg08`, `ssg08_scopeless`, `nova`, `sawedoff` y `mag7`. No es que no se
 * hayan encontrado: la simulación SÍ corre para ellas y da una subida total
 * por debajo de medio grado sobre el cargador entero (el AWP, 0.004°). El
 * motivo es físico y no un bug: en CS el punch angle decae por completo entre
 * disparo y disparo cuando la cadencia es baja, así que un arma de cerrojo o
 * una escopeta de bombeo sencillamente NO acumula un dibujo — patea y ya
 * recuperó cuando sale el siguiente tiro.
 *
 * Un patrón plano no es un dato aprendible, es un cero, y meterlo dejaría a
 * esas armas literalmente SIN retroceso: nuestro motor —a diferencia de CS—
 * lee el patrón como la posición objetivo de la cámara, no como un impulso que
 * después decae, así que no tiene dónde expresar "patea fuerte y ya recuperó".
 * Por eso caen al patrón generado de su arquetipo, que sí les da el golpe seco
 * que su diseño pide. Esa diferencia de modelo es una brecha de fidelidad
 * REAL para las armas lentas y está reportada como tal, no tapada. El umbral
 * (`MIN_LEARNABLE_CLIMB_DEG`) está abajo como constante y hay un test que lo
 * vigila.
 *
 * Las 40 armas CC0 (`public/assets/weapons/`) tampoco tienen contraparte real
 * y se quedan con el patrón generado: es lo correcto, no una deuda.
 *
 * Unidades: RADIANES, en la convención de cámara de nuestro motor — `y`
 * positivo es mirar ARRIBA y `x` positivo es yaw hacia la IZQUIERDA (igual que
 * `applyYaw` en engine/input.ts, que RESTA el movimiento del mouse). CS usa
 * pitch negativo hacia arriba, así que el pitch va invertido acá; el yaw
 * comparte convención con Source y va tal cual.
 */

import type { WeaponArchetype } from '@/game/weapons/archetypes'
import type { SourceGame } from '@/game/weapons/source-catalog'

/** Un patrón: offsets [x, y] acumulados, indexados por número de disparo.
 *  Mismo contrato que `RecoilSpec.pattern` (archetypes.ts). */
export type RecoilPattern = readonly (readonly [number, number])[]

/**
 * Un patrón real con su procedencia. El `game` no es metadato de adorno: cada
 * juego de origen tiene su propio formato de dato crudo y su propia conversión
 * a nuestras unidades, y de qué juego viene un patrón es lo que dice cuál de
 * esas derivaciones hay que mirar para auditarlo. Hoy sólo hay `'CS'`; están
 * en camino ~92 armas de Call of Duty (COD4/MW2/MW3), y esa tanda va a entrar
 * en esta misma tabla con su `game` propio, sin tocar la forma del dato ni a
 * quien la consume.
 *
 * La tabla se indexa por SLUG y no por juego+nombre porque el slug ya es único
 * en todo el catálogo (`source-catalog.test.ts` lo verifica) y es la misma
 * clave con la que el registry resuelve el modelo. Dos armas homónimas de dos
 * packs distintos son dos slugs distintos, así que no chocan acá.
 */
export interface RealRecoilPattern {
  readonly game: SourceGame
  readonly points: RecoilPattern
}

/**
 * Subida total del AK-47 sobre su cargador, en grados, tal como la da el
 * juego. Es el número de referencia de todo este archivo: el test de escala lo
 * RE-DERIVA del patrón del AK que está en la tabla de abajo en vez de confiar
 * en una constante copiada a mano, así que si alguien re-escala los datos sin
 * actualizar esto, falla.
 */
export const AK47_CS_CLIMB_DEG = 11.771068

/**
 * Subida total mínima (grados) para que un patrón real se considere una FORMA
 * y no un cero. Ver el bloque "Qué arma NO tiene patrón real" del encabezado.
 */
export const MIN_LEARNABLE_CLIMB_DEG = 0.5

/**
 * Patrones reales por slug de arma. El slug es el del catálogo de armas
 * derivadas del Workshop (source-catalog.ts) y nunca se muestra.
 *
 * El largo de cada patrón es el `magazine` del arquetipo al que el slug mapea,
 * no el cargador que el arma tiene en CS: el invariante de nuestro motor es
 * "el patrón cubre el cargador entero, sin wrap" (ver recoilOffsetForShot en
 * archetypes.ts), y nuestros cargadores no son los de CS. La tabla de
 * retroceso de CS tiene 64 entradas y envuelve por módulo — exactamente como
 * hace el juego con la M249 de 100 balas —, así que simular más disparos que
 * esas 64 es lo que CS hace de verdad, no una extrapolación inventada.
 */
export const REAL_RECOIL_PATTERNS: Readonly<Record<string, RealRecoilPattern>> = {
  ak47: { game: 'CS', points: [[0, 0], [-0.00357, 0.006907], [0.00098, 0.030215], [-0.002381, 0.065804], [-0.003423, 0.100585], [0.009902, 0.134276], [0.018322, 0.159561], [0.031097, 0.175088], [0.014354, 0.184666], [-0.027255, 0.177705], [-0.049583, 0.183111], [-0.036957, 0.189307], [-0.052375, 0.189438], [-0.077102, 0.179295], [-0.0798, 0.183624], [-0.044867, 0.191195], [-0.022698, 0.195318], [-0.00892, 0.200946], [0.017436, 0.198301], [0.049715, 0.190288], [0.032039, 0.194846], [0.036626, 0.194931], [0.029096, 0.200264], [0.020363, 0.202481], [0.038901, 0.199916], [0.045575, 0.205312], [0.025286, 0.205444], [-0.006353, 0.202759], [-0.050606, 0.183413], [-0.064628, 0.183653]] },
  m4a4: { game: 'CS', points: [[0, 0], [0.001365, 0.006248], [0.001683, 0.019266], [-0.005256, 0.040172], [0.001629, 0.064867], [-0.006541, 0.089698], [-0.011704, 0.114802], [0.004991, 0.127406], [0.015398, 0.136773], [0.037132, 0.139228], [0.032974, 0.147458], [0.015855, 0.151454], [-0.013585, 0.146117], [-0.036924, 0.145113], [-0.062413, 0.139017], [-0.062425, 0.142028], [-0.053811, 0.146837], [-0.064466, 0.147229], [-0.078758, 0.144072], [-0.076038, 0.146101], [-0.042574, 0.14617], [-0.032726, 0.152446], [-0.006711, 0.154764], [0.002039, 0.156763], [0.013299, 0.157087], [0.003417, 0.161455], [0.008222, 0.165035], [0.01147, 0.165615], [0.014508, 0.165063], [0.01877, 0.163949]] },
  m4a1s: { game: 'CS', points: [[0, 0], [0.0014, 0.006914], [0.001994, 0.024201], [-0.006074, 0.049463], [0.001695, 0.074859], [-0.007252, 0.10226], [-0.011864, 0.122685], [0.006055, 0.134105], [0.01742, 0.144509], [0.041264, 0.14567], [0.034508, 0.153721], [0.014402, 0.156873], [-0.014323, 0.150944], [-0.038167, 0.14128], [-0.057771, 0.131599], [-0.056485, 0.134518], [-0.046504, 0.137698], [-0.056502, 0.134945], [-0.067076, 0.127371], [-0.064588, 0.13386], [-0.03389, 0.142356], [-0.024225, 0.149241], [-0.000704, 0.150617], [0.006249, 0.150666], [0.016337, 0.155818], [0.0045, 0.160994], [0.009411, 0.160123], [0.011901, 0.16052], [0.01463, 0.161131], [0.018814, 0.164282]] },
  galil: { game: 'CS', points: [[0, 0], [0.004058, 0.004394], [0.001641, 0.009827], [0.009978, 0.02493], [0.024776, 0.042374], [0.023865, 0.065628], [0.024291, 0.089726], [0.029788, 0.104308], [0.039624, 0.110665], [0.034902, 0.121874], [0.01271, 0.12888], [-0.017527, 0.123445], [-0.046081, 0.111316], [-0.055173, 0.116937], [-0.06675, 0.119338], [-0.072619, 0.119062], [-0.073098, 0.119842], [-0.068947, 0.126975], [-0.044465, 0.133598], [-0.031018, 0.136574], [-0.006844, 0.133328], [0.023211, 0.125563], [0.028994, 0.12787], [0.017749, 0.131467], [0.029834, 0.12943], [0.040349, 0.132322], [0.057401, 0.128403], [0.045979, 0.129734], [0.014136, 0.123689], [-0.009747, 0.120975]] },
  aug: { game: 'CS', points: [[0, 0], [0.003735, 0.004973], [0.003565, 0.017103], [-0.000975, 0.038993], [-0.007869, 0.063558], [-0.001897, 0.090598], [0.005796, 0.110611], [0.017523, 0.122856], [0.022835, 0.131245], [0.033377, 0.135779], [0.017899, 0.142694], [0.013346, 0.145188], [0.02583, 0.144837], [0.025257, 0.145021], [0.004902, 0.144937], [-0.025128, 0.13982], [-0.050105, 0.129618], [-0.048111, 0.133795], [-0.049568, 0.135124], [-0.055974, 0.136214], [-0.036218, 0.142584], [-0.005901, 0.140264], [0.001588, 0.143389], [-0.005509, 0.14387], [0.008495, 0.144381]] },
  aug_scopeless: { game: 'CS', points: [[0, 0], [0.003735, 0.004973], [0.003565, 0.017103], [-0.000975, 0.038993], [-0.007869, 0.063558], [-0.001897, 0.090598], [0.005796, 0.110611], [0.017523, 0.122856], [0.022835, 0.131245], [0.033377, 0.135779], [0.017899, 0.142694], [0.013346, 0.145188], [0.02583, 0.144837], [0.025257, 0.145021], [0.004902, 0.144937], [-0.025128, 0.13982], [-0.050105, 0.129618], [-0.048111, 0.133795], [-0.049568, 0.135124], [-0.055974, 0.136214], [-0.036218, 0.142584], [-0.005901, 0.140264], [0.001588, 0.143389], [-0.005509, 0.14387], [0.008495, 0.144381]] },
  sg553: { game: 'CS', points: [[0, 0], [-0.002968, 0.006475], [-0.017257, 0.022966], [-0.025747, 0.050154], [-0.031973, 0.079479], [-0.037894, 0.107907], [-0.041063, 0.130255], [-0.058308, 0.135082], [-0.040967, 0.145509], [-0.048311, 0.147985], [-0.060886, 0.147514], [-0.063138, 0.14995], [-0.056481, 0.154522], [-0.062924, 0.155485], [-0.058769, 0.161562], [-0.072844, 0.157061], [-0.091054, 0.142151], [-0.103334, 0.133169], [-0.105036, 0.131407], [-0.06437, 0.136643], [-0.015751, 0.132771], [0.019075, 0.129029], [0.023179, 0.138428], [0.031502, 0.148658], [0.033213, 0.156477]] },
  sg553_scopeless: { game: 'CS', points: [[0, 0], [-0.002968, 0.006475], [-0.017257, 0.022966], [-0.025747, 0.050154], [-0.031973, 0.079479], [-0.037894, 0.107907], [-0.041063, 0.130255], [-0.058308, 0.135082], [-0.040967, 0.145509], [-0.048311, 0.147985], [-0.060886, 0.147514], [-0.063138, 0.14995], [-0.056481, 0.154522], [-0.062924, 0.155485], [-0.058769, 0.161562], [-0.072844, 0.157061], [-0.091054, 0.142151], [-0.103334, 0.133169], [-0.105036, 0.131407], [-0.06437, 0.136643], [-0.015751, 0.132771], [0.019075, 0.129029], [0.023179, 0.138428], [0.031502, 0.148658], [0.033213, 0.156477]] },
  mp5sd: { game: 'CS', points: [[0, 0], [0.000136, 0.004359], [-0.001196, 0.008057], [-0.005696, 0.015102], [-0.013178, 0.027849], [-0.023621, 0.043343], [-0.022067, 0.060246], [-0.031084, 0.071634], [-0.033263, 0.082858], [-0.042621, 0.084053], [-0.048014, 0.085977], [-0.039371, 0.093085], [-0.019999, 0.09614], [-0.001913, 0.096994], [0.012673, 0.096987], [0.013595, 0.101464], [0.007703, 0.106334], [0.00395, 0.107373], [0.0004, 0.108859], [0.003899, 0.111506], [0.001928, 0.115297], [-0.01293, 0.112252], [-0.032191, 0.103185], [-0.036084, 0.10295], [-0.045045, 0.100561]] },
  ump45: { game: 'CS', points: [[0, 0], [-0.000874, 0.006335], [-0.0057, 0.017985], [-0.0076, 0.040281], [-0.013159, 0.065771], [-0.023515, 0.089776], [-0.025346, 0.114463], [-0.013561, 0.129064], [-0.017028, 0.13764], [-0.007669, 0.148172], [0.011276, 0.153968], [0.025035, 0.156362], [0.024732, 0.158456], [0.029431, 0.163701], [0.029133, 0.168259], [0.038084, 0.164691], [0.043597, 0.162245], [0.031093, 0.16696], [0.012688, 0.168973], [0.013282, 0.166694], [0.026232, 0.161217], [0.042322, 0.159055], [0.038571, 0.161219], [0.017675, 0.16015], [0.013939, 0.158844]] },
  mp7: { game: 'CS', points: [[0, 0], [0.000136, 0.004359], [-0.001196, 0.008057], [-0.005696, 0.015102], [-0.013178, 0.027849], [-0.023621, 0.043343], [-0.022067, 0.060246], [-0.031084, 0.071634], [-0.033263, 0.082858], [-0.042621, 0.084053], [-0.048014, 0.085977], [-0.039371, 0.093085], [-0.019999, 0.09614], [-0.001913, 0.096994], [0.012673, 0.096987], [0.013595, 0.101464], [0.007703, 0.106334], [0.00395, 0.107373], [0.0004, 0.108859], [0.003899, 0.111506], [0.001928, 0.115297], [-0.01293, 0.112252], [-0.032191, 0.103185], [-0.036084, 0.10295], [-0.045045, 0.100561], [-0.044602, 0.102113], [-0.044916, 0.099108], [-0.044066, 0.098733], [-0.048349, 0.098296], [-0.048818, 0.10091]] },
  mp9: { game: 'CS', points: [[0, 0], [-0.000593, 0.005454], [-0.00433, 0.012138], [-0.000184, 0.026909], [-0.002012, 0.047837], [0.009004, 0.071559], [0.007866, 0.09238], [-0.000448, 0.112784], [0.009757, 0.124871], [0.030382, 0.131956], [0.052152, 0.130328], [0.077024, 0.122512], [0.076025, 0.130713], [0.076586, 0.140206], [0.053682, 0.146766], [0.040613, 0.154563], [0.022879, 0.161121], [0.00909, 0.166649], [-0.011462, 0.165317], [-0.040719, 0.155226], [-0.035745, 0.157399], [-0.019735, 0.160004], [0.000451, 0.160942], [0.003359, 0.162999], [-0.013579, 0.161061], [-0.037236, 0.158674], [-0.045899, 0.161397], [-0.055589, 0.162674], [-0.045962, 0.166167], [-0.041008, 0.170614]] },
  mac10: { game: 'CS', points: [[0, 0], [-0.004329, 0.002854], [-0.005844, 0.0071], [-0.003406, 0.017301], [0.001839, 0.03455], [0.0137, 0.052941], [0.025942, 0.076699], [0.034216, 0.095786], [0.02801, 0.110843], [0.035844, 0.118211], [0.039231, 0.127523], [0.043174, 0.136767], [0.040421, 0.142633], [0.037925, 0.14576], [0.028434, 0.148018], [0.00822, 0.147888], [-0.019919, 0.141438], [-0.021777, 0.14053], [-0.032932, 0.136832], [-0.026539, 0.136603], [-0.032581, 0.138062], [-0.045813, 0.136609], [-0.054377, 0.135771], [-0.038281, 0.135788], [-0.025489, 0.137076], [-0.012241, 0.141454], [0.011801, 0.139596], [0.01232, 0.140823], [-0.008597, 0.135149], [-0.006331, 0.134141]] },
  p90: { game: 'CS', points: [[0, 0], [-0.002953, 0.003485], [-0.002318, 0.008084], [-0.000401, 0.01734], [-0.004346, 0.03191], [-0.01685, 0.048547], [-0.029933, 0.060265], [-0.039806, 0.075918], [-0.030596, 0.088624], [-0.019892, 0.100082], [-0.0173, 0.109954], [-0.013739, 0.119831], [-0.016486, 0.125913], [-0.028652, 0.125138], [-0.033676, 0.127707], [-0.040236, 0.129485], [-0.050261, 0.129083], [-0.038292, 0.130398], [-0.022493, 0.131687], [-0.012412, 0.132594], [-0.00252, 0.133775], [0.011301, 0.132763], [0.025353, 0.12963], [0.021227, 0.129105], [0.02547, 0.130092], [0.015764, 0.133704], [-0.001098, 0.132762], [-0.019843, 0.128482], [-0.022209, 0.129051], [-0.01681, 0.132054]] },
  bizon: { game: 'CS', points: [[0, 0], [-0.001137, 0.004623], [-0.003984, 0.007754], [-0.008856, 0.019353], [-0.018757, 0.034817], [-0.03293, 0.050484], [-0.029248, 0.070491], [-0.018338, 0.088002], [-0.016632, 0.102562], [0.002392, 0.10591], [0.016669, 0.108866], [0.022522, 0.115669], [0.036598, 0.11704], [0.030426, 0.12319], [0.005521, 0.121809], [0.005092, 0.12449], [0.017525, 0.124334], [0.023196, 0.123964], [0.019438, 0.126562], [0.025993, 0.129319], [0.038049, 0.128868], [0.052367, 0.12487], [0.0602, 0.124773], [0.066763, 0.123948], [0.073367, 0.121917], [0.075559, 0.122305], [0.070598, 0.121706], [0.066361, 0.122164], [0.064342, 0.124285], [0.04369, 0.12769]] },
  deagle: { game: 'CS', points: [[0, 0], [0.007318, 0.004503], [0.052327, 0.060946], [-0.006479, 0.039289], [-0.00825, 0.039124], [-0.013406, 0.052886], [0.011629, 0.097159], [-0.019637, 0.083479], [-0.01898, 0.080368], [-0.059233, 0.088318], [-0.021951, 0.088305], [-0.013995, 0.11998]] },
  glock18: { game: 'CS', points: [[0, 0], [-0.00032, 0.005027], [0.000846, 0.007424], [0.003633, 0.014796], [0.000667, 0.019605], [0.001644, 0.02603], [0.004383, 0.027858], [0.000045, 0.027105], [-0.004347, 0.029183], [0.002499, 0.027424], [0.004964, 0.029992], [0.000561, 0.029778]] },
  usps: { game: 'CS', points: [[0, 0], [0, 0.007564], [0, 0.034284], [0, 0.05382], [0, 0.065071], [0, 0.070829], [0, 0.073628], [0, 0.074956], [0, 0.075578], [0, 0.081194], [0, 0.081354], [0, 0.079265]] },
  p2000: { game: 'CS', points: [[0, 0], [0, 0.006782], [0, 0.024571], [0, 0.040235], [0, 0.049855], [0, 0.054898], [0, 0.057378], [0, 0.058562], [0, 0.059117], [0, 0.064152], [0, 0.064295], [0, 0.062422]] },
  p250: { game: 'CS', points: [[0, 0], [-0.000535, 0.007003], [-0.002461, 0.025668], [0.00109, 0.053884], [0.005622, 0.0646], [0.004851, 0.075652], [-0.002294, 0.07785], [-0.002336, 0.0727], [-0.004832, 0.080634], [0.001071, 0.082693], [-0.003317, 0.090123], [-0.001915, 0.085117]] },
  fiveseven: { game: 'CS', points: [[0, 0], [0.000164, 0.007849], [0.000358, 0.038072], [0.000101, 0.055851], [0.001273, 0.065538], [0.001557, 0.072853], [0.000481, 0.082354], [-0.002049, 0.072852], [-0.003023, 0.072115], [-0.002107, 0.0765], [-0.003234, 0.071004], [-0.00066, 0.076127]] },
  cz75: { game: 'CS', points: [[0, 0], [-0.005995, 0.004617], [-0.02795, 0.016529], [-0.021287, 0.049079], [0.016484, 0.052991], [0.047923, 0.07828], [0.013863, 0.102431], [-0.012865, 0.121449], [-0.051568, 0.130568], [-0.027909, 0.150393], [-0.045053, 0.171136], [-0.048554, 0.185697]] },
  tec9: { game: 'CS', points: [[0, 0], [0.001789, 0.006637], [0.017279, 0.021073], [0.033353, 0.041544], [-0.0005, 0.04145], [-0.021386, 0.047688], [-0.030443, 0.060547], [-0.03376, 0.069583], [-0.014786, 0.08423], [-0.006154, 0.091792], [-0.021286, 0.091466], [0.001768, 0.0835]] },
  scar20: { game: 'CS', points: [[0, 0], [-0.001259, 0.003766], [-0.000113, 0.005972], [0.001529, 0.008865], [-0.000709, 0.018914], [-0.006213, 0.025342], [-0.000717, 0.025213], [-0.001193, 0.024337], [-0.000361, 0.026495], [0.004232, 0.027628]] },
  scar20_scopeless: { game: 'CS', points: [[0, 0], [-0.001259, 0.003766], [-0.000113, 0.005972], [0.001529, 0.008865], [-0.000709, 0.018914], [-0.006213, 0.025342], [-0.000717, 0.025213], [-0.001193, 0.024337], [-0.000361, 0.026495], [0.004232, 0.027628]] },
  g3sg1: { game: 'CS', points: [[0, 0], [0.001823, 0.004255], [0.000653, 0.006381], [-0.000551, 0.006924], [-0.002986, 0.014461], [-0.001914, 0.018881], [-0.000767, 0.017125], [-0.002193, 0.019372], [-0.00501, 0.020268], [-0.000825, 0.0188]] },
  g3sg1_scopeless: { game: 'CS', points: [[0, 0], [0.001823, 0.004255], [0.000653, 0.006381], [-0.000551, 0.006924], [-0.002986, 0.014461], [-0.001914, 0.018881], [-0.000767, 0.017125], [-0.002193, 0.019372], [-0.00501, 0.020268], [-0.000825, 0.0188]] },
  xm1014: { game: 'CS', points: [[0, 0], [0.002468, 0.010572], [0.005254, 0.043054], [-0.00428, 0.056529], [-0.011977, 0.073539], [0.001149, 0.087648]] },
  m249: { game: 'CS', points: [[0, 0], [-0.004748, 0.004922], [-0.014004, 0.020451], [-0.02912, 0.044961], [-0.049485, 0.073227], [-0.068057, 0.10025], [-0.057339, 0.126969], [-0.031668, 0.147495], [-0.005182, 0.162153], [0.019652, 0.172208], [0.031175, 0.179618], [0.039728, 0.190796], [0.021563, 0.198714], [0.022321, 0.20667], [0.029597, 0.213322], [0.035099, 0.220093], [0.045524, 0.223669], [0.044674, 0.219552], [0.041035, 0.216895], [0.024569, 0.217841], [-0.006106, 0.214377], [-0.010759, 0.216451], [-0.020051, 0.219945], [-0.03887, 0.219789], [-0.054978, 0.219548], [-0.06284, 0.220982], [-0.049967, 0.217284], [-0.01853, 0.210918], [-0.00806, 0.211064], [-0.011615, 0.212944], [0.002207, 0.21287], [0.027834, 0.20852], [0.032327, 0.211065], [0.02278, 0.216461], [0.005184, 0.216916], [0.012249, 0.217629], [0.008628, 0.219997], [-0.011563, 0.219523], [-0.024252, 0.22207], [-0.01452, 0.225949], [0.00172, 0.229261], [0.015392, 0.233643], [-0.000526, 0.229248], [0.009193, 0.226842], [0.032017, 0.220815], [0.042035, 0.220419], [0.035795, 0.224708], [0.03393, 0.229958], [0.025826, 0.232527], [0.001195, 0.228189], [-0.015355, 0.224428], [-0.002918, 0.214128], [0.004743, 0.210656], [0.017369, 0.213214], [0.027581, 0.217663], [0.014434, 0.219663], [0.016903, 0.221274], [0.035859, 0.219727], [0.056818, 0.215955], [0.053455, 0.213397], [0.039567, 0.213796], [0.045411, 0.215208], [0.053195, 0.217788], [0.053509, 0.221974], [0.045504, 0.226433], [0.014188, 0.208867], [-0.013384, 0.193764], [-0.03772, 0.17655], [-0.057749, 0.169232], [-0.074813, 0.16923], [-0.061693, 0.176977], [-0.033429, 0.18432], [-0.004913, 0.189287], [0.019518, 0.195905], [0.033486, 0.202074], [0.042587, 0.209687], [0.021599, 0.207818], [0.022738, 0.208281], [0.029987, 0.211904], [0.035371, 0.217739], [0.045681, 0.221294], [0.046027, 0.223769], [0.043142, 0.225492], [0.026595, 0.226911], [-0.007377, 0.215387], [-0.010063, 0.212524], [-0.018856, 0.21469], [-0.037659, 0.214752], [-0.053891, 0.21529], [-0.061928, 0.217609], [-0.051758, 0.220913], [-0.020513, 0.219167], [-0.008434, 0.213571], [-0.012248, 0.210647], [0.001615, 0.20908], [0.027302, 0.204686], [0.031854, 0.207744], [0.022405, 0.213789], [0.00662, 0.220651], [0.012711, 0.226146]] },
  negev: { game: 'CS', points: [[0, 0], [0, 0.006346], [0, 0.016194], [0, 0.036441], [0, 0.060739], [0, 0.083484], [0, 0.109449], [0, 0.128138], [0, 0.141297], [0, 0.151738], [0, 0.161203], [0, 0.170949], [0, 0.173589], [0, 0.172959], [0, 0.172369], [0, 0.17599], [0, 0.181518], [0, 0.181655], [0, 0.181273], [0, 0.178855], [0, 0.180165], [0, 0.181098], [0, 0.178937], [0, 0.176285], [0, 0.176331], [0, 0.181247], [0, 0.184567], [0, 0.183974], [0, 0.182061], [0, 0.180926], [0, 0.185438], [0, 0.190318], [0, 0.190726], [0, 0.190868], [0, 0.191749], [0, 0.196673], [0, 0.19933], [0, 0.197127], [0, 0.191876], [0, 0.186239], [0, 0.186823], [0, 0.188828], [0, 0.189065], [0, 0.189569], [0, 0.187885], [0, 0.189031], [0, 0.191668], [0, 0.190385], [0, 0.187995], [0, 0.184043], [0, 0.186795], [0, 0.191426], [0, 0.193155], [0, 0.192355], [0, 0.189514], [0, 0.190851], [0, 0.191002], [0, 0.190039], [0, 0.188714], [0, 0.186361], [0, 0.18861], [0, 0.1927], [0, 0.193094], [0, 0.193317], [0, 0.194053], [0, 0.190182], [0, 0.182226], [0, 0.174696], [0, 0.169489], [0, 0.16659], [0, 0.17052], [0, 0.175629], [0, 0.177131], [0, 0.178246], [0, 0.177551], [0, 0.181588], [0, 0.183871], [0, 0.181689], [0, 0.179313], [0, 0.177145], [0, 0.181358], [0, 0.184303], [0, 0.184613], [0, 0.181996], [0, 0.178209], [0, 0.179252], [0, 0.180193], [0, 0.178536], [0, 0.178646], [0, 0.179212], [0, 0.182167], [0, 0.184875], [0, 0.184082], [0, 0.18309], [0, 0.183164], [0, 0.18757], [0, 0.191549], [0, 0.192922], [0, 0.193985], [0, 0.194334]] },
}

/**
 * Patrón que le toca a un arma: el suyo real si lo tiene, y si no el de su
 * arquetipo. El respaldo por arquetipo es la razón por la que las 40 CC0 y las
 * 9 armas sin forma real siguen funcionando sin ninguna entrada acá.
 */
export function resolveRecoilPattern(
  slug: string | null,
  archetype: WeaponArchetype,
): RecoilPattern {
  if (slug !== null) {
    const real = REAL_RECOIL_PATTERNS[slug]
    if (real) return real.points
  }
  return archetype.recoil.pattern
}

/** Juego del que salió el patrón de un arma, o `null` si usa el generado. */
export function recoilPatternGame(slug: string | null): SourceGame | null {
  if (slug === null) return null
  return REAL_RECOIL_PATTERNS[slug]?.game ?? null
}
