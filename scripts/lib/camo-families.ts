/**
 * Las seis familias de camuflaje teselable, generadas proceduralmente.
 *
 * Por qué generadas y no copiadas: una tesela generada es nuestra (se puede
 * publicar sin arrastrar la licencia de nadie), se regenera con otra paleta
 * cambiando un parámetro, y sobre todo **es periódica por construcción** (ver
 * lib/tileable-noise.ts). Una captura de un camo de otro juego no es ninguna
 * de las tres cosas: casi siempre está pintada sobre el UV de un arma
 * específica, así que ni siquiera se repite.
 *
 * Cada familia devuelve un lienzo cuadrado que cierra consigo mismo en los
 * cuatro bordes. Las tres técnicas usadas para garantizarlo:
 *
 *   1. **Campo periódico** (multicam, damasco, cebra): todo sale de fbmP /
 *      ridgedP, que ya son periódicos, y de senos con número entero de ciclos
 *      por tesela.
 *   2. **Sellos envolventes** (follaje): los sellos se pintan con WrapCanvas,
 *      así la hoja que cae en el borde reaparece partida del otro lado y al
 *      repetir queda entera cruzando la costura.
 *   3. **Celosía entera** (filigrana): se evalúa sobre pmod((u±v)*N, 1) con N
 *      entero, así el ornamento tiene su propio ritmo, más chico que la
 *      tesela y cruzándole los bordes. Ver la nota en la función: el plegado
 *      especular |2u-1| también tesela, pero deja un marco por tesela.
 *
 * La retícula del gema es el cuarto caso, trivial: un número entero de celdas
 * por tesela con desfase de media celda en filas alternas y cantidad par de
 * filas.
 */

import {
  clamp01,
  fbmP,
  hashCell,
  hex,
  hsv,
  lerp,
  mixRgb,
  noise2p,
  pmod,
  ridgedP,
  type Rgb,
  scaleRgb,
  smoothstep,
  WrapCanvas,
} from './tileable-noise.ts'

/** Grano fino común a varias familias: rompe el aspecto de vector plano. */
function grain(u: number, v: number, seed: number, amount: number): number {
  return 1 + (noise2p(u * 256, v * 256, 256, seed) - 0.5) * amount
}

/* ------------------------------------------------------------------ *
 * 1. MULTICAM — manchas orgánicas en cuatro tonos.
 * ------------------------------------------------------------------ */

/**
 * El camuflaje clásico no es un campo posterizado en cuatro niveles: eso da
 * bandas concéntricas, como un mapa topográfico. Es **capas independientes
 * que se tapan**, que es como se imprime de verdad — y por eso las manchas
 * se solapan con bordes que se cruzan en vez de anidarse.
 */
export function multicam(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)

  const claro = hex('#dcdcd6')
  const gris = hex('#8b8b89')
  const rojo = hex('#8f5350')
  const negro = hex('#2b2827')

  // Cada capa tiene su propio warp para que los bordes no queden paralelos.
  // Las celdas son altas (5-6 por tesela, no 3-4) por una razón que sólo se
  // ve en el mosaico: con manchas grandes cada tesela tiene 3 o 4 siluetas
  // memorables, y al repetirse el ojo las reconoce y lee la retícula. Con
  // manchas chicas ninguna silueta es memorable y el mosaico se lee como
  // campo continuo. La resolución de la mancha es un parámetro de
  // teselabilidad, no sólo de estilo.
  const capas: readonly { color: Rgb; umbral: number; seed: number; celdas: number }[] = [
    { color: gris, umbral: 0.46, seed: seed + 11, celdas: 9 },
    { color: rojo, umbral: 0.52, seed: seed + 37, celdas: 8 },
    { color: negro, umbral: 0.54, seed: seed + 71, celdas: 9 },
  ]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      let c = claro

      for (const capa of capas) {
        // Domain warp: sin esto las manchas salen redondeadas y regulares;
        // con esto agarran los entrantes y salientes que las hacen leer como
        // camuflaje impreso.
        const wu = u + (fbmP(u, v, 2, 3, capa.seed + 5) - 0.5) * 0.35
        const wv = v + (fbmP(u, v, 2, 3, capa.seed + 9) - 0.5) * 0.35
        const f = fbmP(wu, wv, capa.celdas, 4, capa.seed, 0.45)
        // Umbral casi duro: el camuflaje real tiene borde de imprenta, no
        // degradado. Los ~1.5px de transición son sólo antialias.
        if (f > capa.umbral + 0.004) c = capa.color
        else if (f > capa.umbral - 0.004) c = mixRgb(c, capa.color, (f - capa.umbral + 0.004) / 0.008)
      }

      cv.set(x, y, scaleRgb(c, grain(u, v, seed + 3, 0.07)))
    }
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * 2. FOLLAJE — hojas palmadas sobre fondo oscuro.
 * ------------------------------------------------------------------ */

/**
 * Una hoja palmada: N folíolos lanceolados que salen del mismo peciolo. Se
 * dibuja por cobertura analítica (distancia al eje del folíolo contra un
 * ancho que se afina en las puntas) en vez de por máscara de ruido, porque
 * una hoja tiene silueta reconocible y el ruido nunca la da.
 *
 * Se pinta con WrapCanvas a propósito: una hoja centrada en el borde queda
 * partida entre los dos lados y al repetir la tesela se rearma. Sin eso, la
 * costura se ve como un pasillo de hojas cortadas.
 */
function dibujarHoja(cv: WrapCanvas, cx: number, cy: number, radio: number, seed: number): void {
  const rot = hashCell(seed, 1, 17) * Math.PI * 2
  const cos = Math.cos(rot)
  const sin = Math.sin(rot)
  const folios = 5 + Math.floor(hashCell(seed, 2, 17) * 4)
  const abanico = 1.9 + hashCell(seed, 3, 17) * 1.0

  // Verde propio de la hoja. El rango de tono es angosto (hoja verde, no
  // hoja de cualquier color) pero el de valor es ancho: la profundidad del
  // follaje se lee por diferencia de luminosidad, no de color.
  const tono = 0.245 + hashCell(seed, 4, 17) * 0.055
  const sat = 0.55 + hashCell(seed, 5, 17) * 0.32
  const val = 0.30 + hashCell(seed, 6, 17) * 0.48
  const verde = hsv(tono, sat, val)

  const R = Math.ceil(radio) + 3
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const lx = dx * cos + dy * sin
      const ly = -dx * sin + dy * cos

      let mejor = -1
      let mejorT = 0
      let mejorLat = 0
      let mejorW = 1
      let borde = false

      for (let j = 0; j < folios; j++) {
        const a = -abanico / 2 + (abanico * j) / (folios - 1)
        const dirx = Math.sin(a)
        const diry = -Math.cos(a)
        // Los folíolos del centro son los largos: eso es lo que hace que la
        // hoja lea como estrella y no como abanico parejo.
        const largo = radio * (0.55 + 0.45 * Math.sin((Math.PI * (j + 0.5)) / folios))

        const t = (lx * dirx + ly * diry) / largo
        if (t <= 0.02 || t >= 1) continue
        const lat = Math.abs(-lx * diry + ly * dirx)

        // Ancho lanceolado: se abre rápido y se afina largo hacia la punta.
        let w = largo * 0.135 * Math.pow(Math.sin(Math.PI * t), 0.55)
        // Dentado del borde. Es el detalle que separa "hoja" de "pétalo".
        w *= 1 + 0.11 * Math.sin(t * 34 + j * 2.1)

        if (lat < w) {
          if (t > mejor) {
            mejor = t
            mejorT = t
            mejorLat = lat
            mejorW = w
          }
        } else if (lat < w * 1.35) {
          borde = true
        }
      }

      if (mejor < 0) {
        // Contorno oscuro: separa hojas superpuestas del mismo verde. Sin
        // esto el follaje se funde en una masa verde ilegible.
        if (borde) {
          const i = cv.index(cx + dx, cy + dy)
          cv.data[i] *= 0.62
          cv.data[i + 1] *= 0.62
          cv.data[i + 2] *= 0.62
        }
        continue
      }

      // Sombreado: nervadura central clara, borde del folíolo oscuro, y la
      // punta más clara que la base (le da volumen sin normal map).
      const haciaBorde = mejorLat / mejorW
      let k = 1 - 0.42 * haciaBorde * haciaBorde + 0.14 * mejorT
      const nervadura = smoothstep(0.16, 0.0, haciaBorde)
      k += nervadura * 0.16
      // Nervios laterales.
      k += 0.07 * Math.sin(mejorT * 26 + haciaBorde * 9)

      cv.set(cx + dx, cy + dy, scaleRgb(verde, clamp01(k * 1.05)))
    }
  }
}

export function follaje(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)

  // Fondo violeta oscuro, como la referencia: un fondo neutro haría que el
  // verde se lea plano, y un fondo verde borraría la silueta de las hojas.
  const fondoA = hex('#2e2440')
  const fondoB = hex('#181228')
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size
      cv.set(x, y, mixRgb(fondoA, fondoB, fbmP(u, v, 3, 3, seed + 91)))
    }
  }

  // Dos pasadas: primero hojas grandes de fondo más oscuras, después las de
  // adelante. La densidad está calibrada para tapar ~90% y dejar que el
  // violeta respire en los huecos, igual que la referencia.
  const total = 46
  for (let i = 0; i < total; i++) {
    const s = seed * 7919 + i * 131
    const cx = Math.floor(hashCell(s, 10, 3) * size)
    const cy = Math.floor(hashCell(s, 20, 3) * size)
    const escala = i < total * 0.4 ? 0.20 : 0.15
    const radio = size * escala * (0.72 + hashCell(s, 30, 3) * 0.6)
    dibujarHoja(cv, cx, cy, radio, s)
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * 3. DAMASCO — vetas metálicas marmoladas con contornos.
 * ------------------------------------------------------------------ */

/**
 * El acero de Damasco se ve como curvas de nivel de un terreno muy plegado.
 * Se reproduce igual: un campo con **domain warp iterado** (warp del warp),
 * que es lo que produce los remolinos apretados, y después `fract(t*N)` para
 * sacar las bandas. Las bandas son el patrón; el color sólo las viste.
 */
export function damasco(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)

  const linea = hex('#e0409a')
  const relleno = hex('#e8542a')
  const campoA = hex('#12736a')
  const campoB = hex('#3fd08a')
  const campoC = hex('#1b3f8f')

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size

      // Warp de dos pasos. Con uno solo salen ondas suaves; el segundo paso
      // es el que dobla el campo sobre sí mismo y genera los ojos y remolinos
      // que son la firma del damasco.
      const q1 = fbmP(u, v, 2, 4, seed + 1)
      const q2 = fbmP(u, v, 2, 4, seed + 2)
      const wu = u + (q1 - 0.5) * 0.70
      const wv = v + (q2 - 0.5) * 0.70
      const r1 = fbmP(wu, wv, 3, 4, seed + 3)
      const r2 = fbmP(wu, wv, 3, 4, seed + 4)
      const su = u + (r1 - 0.5) * 0.50
      const sv = v + (r2 - 0.5) * 0.50

      // Campo SUAVE con MUCHAS bandas. Los dos extremos fallan y por razones
      // distintas: con campo rugoso (5 octavas) el detalle fino pica las
      // curvas de nivel y quedan moteado; con pocas bandas (4) quedan islas
      // enormes con contorno, como un mapa. El damasco son curvas de nivel
      // MUY juntas de un terreno MUY liso: la densidad la ponen las bandas,
      // el remolino lo pone el warp, y las octavas no tienen que aportar nada.
      const t = fbmP(su, sv, 2, 3, seed + 5, 0.45)

      const c = pmod(t * 14, 1)

      let color: Rgb
      if (c < 0.055) {
        color = linea
      } else if (c < 0.125) {
        // El naranja va SIEMPRE pegado a la línea magenta, nunca suelto: en
        // la referencia el relleno cálido es el interior del contorno.
        color = mixRgb(relleno, linea, smoothstep(0.125, 0.055, c) * 0.3)
      } else {
        // El campo teal ocupa el ~85% restante. La proporción importa: con la
        // línea y el relleno cubriendo un tercio, el resultado se veía
        // psicodélico en vez de metálico.
        const k = smoothstep(0.125, 1, c)
        color = mixRgb(mixRgb(campoA, campoB, k), campoC, smoothstep(0.55, 0.95, t) * 0.5)
      }

      // Grano pulido direccional: el damasco es metal cepillado, y sin esta
      // veta fina se ve como plástico impreso.
      //
      // Los periodos NO son libres. La veta es diagonal, así que al cruzar el
      // borde de abajo (v -> v+1) el argumento x salta 0.25*220 = 55 celdas:
      // el periodo en x tiene que DIVIDIR a 55 para que ese salto caiga en la
      // misma celda, y 220 no lo hace. Con 220 la tesela no cerraba en
      // vertical (costura medida 3.5x) aunque cada eje pareciera periódico
      // por separado. 55 divide a 55 y también a 220 (el salto de u -> u+1),
      // así que cierra en los dos ejes.
      const cepillo =
        1 + (noise2p((u + v * 0.25) * 220, v * 12, 55, seed + 8, 12) - 0.5) * 0.18
      cv.set(x, y, scaleRgb(color, cepillo))
    }
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * 4. GEMA — retícula de octógonos facetados.
 * ------------------------------------------------------------------ */

/**
 * Retícula de octógonos con filas desfasadas media celda. Tesela por
 * aritmética: número entero de celdas y cantidad **par** de filas, así el
 * desfase alternado cierra (con filas impares el borde superior tendría el
 * desfase cambiado respecto del inferior).
 *
 * Lo que hace que se lea como gema y no como sello hexagonal es el
 * facetado: sectores angulares con brillo propio y grietas radiales. Una
 * gema es una superficie que refleja distinto en cada cara, no un degradado.
 */
export function gema(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)

  // 6x6 y no 8x8: con 64 gemas por tesela cada piedra caía en ~60px y las
  // facetas no tenían lugar para leerse, así que el patrón se veía como una
  // grilla de botones. Una gema necesita tamaño para mostrar que está
  // tallada; si no, es un lunar.
  const cols = 6
  const filas = 6 // par, obligatorio para que el desfase alternado cierre
  const cw = size / cols
  const ch = size / filas
  const fondo = hex('#2a0d3d')

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size

      const fy = y / ch
      const gy = Math.floor(fy)
      const desfase = gy % 2 === 0 ? 0 : 0.5
      const fx = x / cw - desfase
      const gx = Math.floor(fx)

      // Coordenadas dentro de la celda, centradas en [-1,1].
      const px = (fx - gx - 0.5) * 2
      const py = (fy - gy - 0.5) * 2

      // SDF de octógono regular: el max de las cuatro familias de semiplanos.
      const ax = Math.abs(px)
      const ay = Math.abs(py)
      const oct = Math.max(ax, ay, (ax + ay) * 0.7071)
      const radio = 0.97

      const gs = Math.imul(pmod(gx, cols) + 1, 7331) ^ Math.imul(gy + 1, 9173)

      let color = mixRgb(fondo, hex('#160522'), fbmP(u, v, 6, 3, seed + 55))

      if (oct < radio) {
        const rr = Math.hypot(px, py) / radio
        const th = Math.atan2(py, px) / (Math.PI * 2)

        // Talla real, no porciones de torta. Un brillante tiene una mesa
        // plana en el centro y DOS coronas de facetas hacia el canto; la
        // primera versión usaba un solo abanico radial y por eso se veía
        // como una rueda de quesos. La corona (anillo) entra en el id de la
        // faceta, así que cada corona tiene sus propias caras.
        const giro = hashCell(gs, 2, seed)

        // Los límites entre coronas se ondulan con el ángulo, y los límites
        // entre caras se corren con el radio. Sin estos dos jitters, las
        // coronas son circunferencias perfectas y las aristas son radios
        // perfectos: la piedra sale como un TABLERO DE DARDOS, un engranaje
        // de anillos concéntricos. Una gema tallada a mano no tiene ninguna
        // arista que cierre un círculo exacto; la irregularidad es la que
        // hace leer "cristal" en vez de "pieza torneada".
        const ondaAng = (hashCell(gs, Math.floor(pmod(th + giro, 1) * 11) + 700, seed) - 0.5) * 0.16
        const rj = rr + ondaAng
        const corona = rj < 0.42 ? 0 : rj < 0.74 ? 1 : 2
        // Las coronas de afuera tienen más caras, como en una talla real.
        const sectores = [6, 9, 13][corona] + Math.floor(hashCell(gs, corona + 40, seed) * 3)
        // Cada corona gira distinto y además se corre con el radio: las
        // aristas dejan de alinearse y aparecen caras romboidales.
        const corrimiento = (hashCell(gs, corona * 53 + 900, seed) - 0.5) * 0.5
        const s = pmod(th + giro + corona * 0.37 + corrimiento * rr, 1) * sectores
        const si = Math.floor(s)
        const sf = s - si

        // Rango de brillo ANCHO (0.34..1.06). Con un rango angosto las caras
        // salen todas parecidas, el ojo no distingue la talla y la gema se
        // lee como un círculo claro: es lo que pasó al subir el piso a 0.58.
        // Una piedra tallada tiene caras casi negras al lado de caras que
        // destellan; ese contraste ES el efecto.
        let k = 0.46 + hashCell(gs, si * 17 + corona * 131, seed) * 0.62
        // La mesa central es siempre la cara más clara: es la que devuelve
        // la luz de frente.
        if (corona === 0) k = 0.86 + hashCell(gs, si * 17, seed) * 0.26

        // Aristas: la grieta entre caras y el escalón entre coronas.
        const arista = Math.min(sf, 1 - sf)
        k *= 1 - smoothstep(0.045, 0.0, arista) * 0.5
        k *= 1 - smoothstep(0.035, 0.0, Math.abs(rj - 0.42)) * 0.45
        k *= 1 - smoothstep(0.035, 0.0, Math.abs(rj - 0.74)) * 0.45
        // Bisel del canto, medido sobre la distancia al OCTOGONO y no sobre
        // el radio. Con el radio, el oscurecimiento del canto es un viñeteo
        // circular y la piedra se lee como una perla esferica: la silueta
        // octogonal desaparece justo donde tendria que definirse. Siguiendo
        // `oct` el bisel corre paralelo a las ocho aristas y la forma vuelve.
        k *= 1 - smoothstep(0.82, 1.0, oct / radio) * 0.38

        const lila = hsv(0.76 + (hashCell(gs, 3, seed) - 0.5) * 0.06, 0.34, 1)
        color = scaleRgb(lila, clamp01(k))
        // Antialias del canto contra el fondo.
        const bordeSuave = smoothstep(radio, radio - 0.03, oct)
        color = mixRgb(mixRgb(fondo, hex('#160522'), 0.5), color, bordeSuave)
      }

      cv.set(x, y, color)
    }
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * 5. FILIGRANA — ornamento dorado sobre fondo oscuro.
 * ------------------------------------------------------------------ */

/**
 * Un ornamento no es ruido: es **estructura**. Acá se construye como un
 * damasco textil: una celosía diagonal, rosetas en los cruces, motivos
 * chicos en el centro de cada rombo, y volutas finas rellenando el fondo.
 *
 * Historia de por qué NO usa plegado especular, que era el primer intento y
 * es el truco obvio: `|2u-1|` tesela y da simetría, pero el ornamento queda
 * centrado en la tesela, así que al repetir aparece **un marco alrededor de
 * cada tesela** y el mosaico se lee como una pared de cuadros colgados. La
 * simetría espejada además junta dos gradientes opuestos en las medianas y
 * deja una cruz borrosa visible. Ninguna de las dos cosas se nota mirando la
 * tesela suelta; las dos son obvias en el teselado 3x3.
 *
 * La celosía arregla las dos: su rejilla es **más chica que la tesela** y
 * cruza los bordes, así que el ojo engancha con el ritmo del ornamento y no
 * con el ritmo de la tesela. Todo se evalúa con `pmod` sobre combinaciones
 * enteras de u y v, así que sigue cerrando.
 */
export function filigrana(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)

  const oroClaro = hex('#e8cf82')
  const oroMedio = hex('#c2953c')
  const oroOscuro = hex('#6d4f1c')
  const fondoClaro = hex('#4a4844')
  const fondoOscuro = hex('#22211f')

  // Diagonales por tesela. Enteros -> (u+v)*n y (u-v)*n avanzan un número
  // entero de vueltas al cruzar el borde, y la celosía cierra.
  const N = 3

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size

      // Coordenadas de celosía: rotación 45 grados y escala uniforme, así
      // que las distancias en (a,b) siguen siendo proporcionales a las
      // distancias reales y una "circunferencia" en (a,b) es redonda.
      const fa = pmod((u + v) * N, 1)
      const fb = pmod((u - v) * N, 1)
      const sa = fa < 0.5 ? fa : fa - 1
      const sb = fb < 0.5 ? fb : fb - 1
      const rad = Math.hypot(sa, sb)
      const th = Math.atan2(sb, sa)

      // Fondo: metal oscuro con manchones.
      let color = mixRgb(fondoClaro, fondoOscuro, fbmP(u, v, 4, 4, seed + 21))
      let oro = 0

      // --- Volutas de relleno: curva de nivel del ridged noise. ---
      // Tiene que ser una CURVA DE NIVEL (distancia a un valor), no una
      // franja entre dos umbrales. Con la franja, el ruido pasa mucho tiempo
      // dentro del rango y el oro inundaba el 44% de la tesela: quedaba una
      // masa mostaza en vez de filigrana. La distancia a un valor único da
      // un filamento de ancho controlado, que es lo que es una voluta.
      const vol = ridgedP(u, v, 6, 4, seed + 31)
      oro = Math.max(oro, smoothstep(0.024, 0.008, Math.abs(vol - 0.78)) * 0.9)
      const vol2 = ridgedP(u, v, 13, 3, seed + 33)
      oro = Math.max(oro, smoothstep(0.016, 0.006, Math.abs(vol2 - 0.82)) * 0.45)

      // --- Celosía: los dos haces de diagonales. ---
      oro = Math.max(oro, smoothstep(0.055, 0.030, Math.abs(sa)) * 0.95)
      oro = Math.max(oro, smoothstep(0.055, 0.030, Math.abs(sb)) * 0.95)

      // --- Roseta en cada cruce de la celosía. ---
      if (rad < 0.34) {
        // Anillo exterior.
        oro = Math.max(oro, smoothstep(0.022, 0.008, Math.abs(rad - 0.26)))
        // Pétalos de ocho lóbulos.
        const petalo = 0.15 + 0.065 * Math.cos(th * 8)
        oro = Math.max(oro, smoothstep(0.026, 0.010, Math.abs(rad - petalo)))
        // Botón central.
        oro = Math.max(oro, smoothstep(0.055, 0.040, rad))
      }

      // --- Motivo chico en el centro del rombo (fa=fb=0.5). ---
      const ma = fa - 0.5
      const mb = fb - 0.5
      const mrad = Math.hypot(ma, mb)
      if (mrad < 0.18) {
        const mth = Math.atan2(mb, ma)
        const flor = 0.075 + 0.045 * Math.cos(mth * 4)
        oro = Math.max(oro, smoothstep(0.022, 0.009, Math.abs(mrad - flor)))
      }

      if (oro > 0.02) {
        // Pan de oro gastado: el oro puro plano se ve a plástico dorado. El
        // desgaste por ruido es lo que lo lleva a "dorado a la hoja".
        const desgaste = fbmP(u, v, 12, 4, seed + 41)
        const tono = mixRgb(oroMedio, oroClaro, clamp01(desgaste * 1.5 - 0.2))
        const gastado = mixRgb(tono, oroOscuro, smoothstep(0.62, 0.85, desgaste) * 0.8)
        color = mixRgb(color, gastado, clamp01(oro))
      }

      cv.set(x, y, scaleRgb(color, grain(u, v, seed + 61, 0.10)))
    }
  }
  return cv
}

/* ------------------------------------------------------------------ *
 * 6. CEBRA ARCOÍRIS — franjas onduladas sobre barrido de tono.
 * ------------------------------------------------------------------ */

/**
 * Franjas de cebra = un seno cuya fase se deforma con ruido. Dos detalles
 * que separan "cebra" de "rayas onduladas":
 *
 *   - El **umbral variable**: si el corte es fijo, todas las franjas tienen
 *     el mismo ancho. Moduládolo con otro ruido, las franjas se afinan, se
 *     ensanchan y a veces se cortan — que es lo que hace una cebra real.
 *   - El seno lleva **número entero de ciclos** por tesela y el ruido de la
 *     fase es periódico, así que el conjunto cierra.
 *
 * El tono barre una vuelta completa en vertical: hue(0) = hue(1), así que el
 * arcoíris también cierra sin salto de color en la costura.
 */
export function cebra(size: number, seed: number): WrapCanvas {
  const cv = new WrapCanvas(size)
  // Los DOS coeficientes tienen que ser enteros, no sólo el principal.
  // Costó una costura vertical medida en 35x el salto interno: la primera
  // versión inclinaba las franjas con `v * 0.35`, que son 2.45 ciclos por
  // tesela — la onda llegaba al borde de abajo a mitad de camino. Un número
  // entero de ciclos en cada eje es la condición completa; que el eje
  // principal cierre no alcanza si el eje secundario no cierra también.
  const ciclosU = 2
  const ciclosV = 7 // franjas mayormente horizontales, como la referencia

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size
      const v = y / size

      // Deformación fuerte de la fase: es lo que curva las franjas en
      // galones en vez de dejarlas rectas.
      const w1 = (fbmP(u, v, 2, 4, seed + 1) - 0.5) * 1.55
      const w2 = (fbmP(u, v, 4, 3, seed + 2) - 0.5) * 0.55
      const fase = (u * ciclosU + v * ciclosV) * Math.PI * 2 + (w1 + w2) * Math.PI * 2

      const onda = Math.sin(fase)
      // Umbral variable -> ancho de franja variable y bifurcaciones.
      const corte = 0.06 + (fbmP(u, v, 5, 3, seed + 3) - 0.5) * 0.95

      const negra = smoothstep(corte - 0.05, corte + 0.05, onda)

      // Arcoíris: una vuelta completa de tono por tesela, en vertical.
      const tono = v + (fbmP(u, v, 3, 2, seed + 4) - 0.5) * 0.06
      const colorVivo = hsv(tono, 0.72, 0.80)
      const negro = hex('#211d1c')

      const color = mixRgb(colorVivo, negro, negra)
      cv.set(x, y, scaleRgb(color, grain(u, v, seed + 5, 0.08)))
    }
  }
  return cv
}
