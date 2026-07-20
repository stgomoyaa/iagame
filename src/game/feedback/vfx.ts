/**
 * Estado de los efectos visuales de disparo: fulgor de boca, trazadores,
 * impactos y calcomanías. Módulo puro — sin three, sin DOM — igual que
 * feedback/feedback.ts: acá sólo viven los datos de cada instancia, y
 * feedback/vfx-renderer.ts los sube a la GPU.
 *
 * DOS DECISIONES DE DISEÑO QUE EXPLICAN TODO LO DEMÁS
 *
 * 1. Todo es un anillo, nada tiene "step por frame". No hay un stepVfx() que
 *    envejezca partículas: cada instancia guarda su `spawnTimeS` y el shader
 *    calcula la edad como `uTime - spawnTimeS`. Eso deja el costo por frame
 *    de CPU en literalmente cero (escribir un uniform) por más partículas
 *    vivas que haya, que es lo que pide el presupuesto de 2.5 ms combinado.
 *    El precio es que la CPU no sabe cuáles están vivas — y no le hace falta:
 *    para reciclar slots alcanza con pisar el más viejo.
 *
 * 2. Los anillos son de capacidad fija y se pisan solos. La instancia (n+1)
 *    reemplaza a la más vieja, así que ni el consumo de memoria ni el de
 *    draw calls crecen con la duración de la partida. Esto importa
 *    especialmente para las calcomanías: dejarlas acumular sin techo es la
 *    forma clásica de degradar una partida larga hasta que no corre.
 */

import { VFX } from '@/game/feedback/tuning'

/** Código numérico de superficie. Se guarda como número (y no como el
 *  ImpactSurface de combat/shot.ts) porque viaja tal cual a un atributo de
 *  instancia: el shader lo usa para elegir color y variante del atlas. */
export const SUPERFICIE_HORMIGON = 0
export const SUPERFICIE_CARNE = 1

/** Una instancia de partícula, lista para subir a la GPU. Preasignada. */
export interface VfxInstance {
  /** false = slot nunca usado. El renderer los saltea al subir. */
  usada: boolean
  /** Momento del spawn, en segundos del reloj del juego. El shader deriva la
   *  edad de acá; es el único dato temporal que se guarda. */
  spawnTimeS: number
  x: number
  y: number
  z: number
  /** Trazador: dirección de viaje. Impacto/calcomanía: normal de la
   *  superficie. Fulgor: no se usa. Siempre normalizado. */
  dx: number
  dy: number
  dz: number
  /** Lado del quad, metros. */
  escala: number
  /** Semilla 0..1 para variar rotación y variante de atlas en el shader. */
  semilla: number
  /** Trazador: distancia hasta el impacto, metros. Otros: sin uso. */
  largo: number
  /** Ver SUPERFICIE_*. */
  superficie: number
}

/** Anillo de instancias de capacidad fija. */
export interface VfxRing {
  items: VfxInstance[]
  capacidad: number
  /** Próximo slot a escribir; vuelve a 0 al llegar al final. */
  siguiente: number
  /** Sube en cada spawn. El renderer compara contra la última que subió
   *  para no re-subir el buffer en frames donde no pasó nada. */
  version: number
}

export interface VfxState {
  fulgores: VfxRing
  trazadores: VfxRing
  impactos: VfxRing
  calcomanias: VfxRing
  /** Disparos acumulados, para decidir a cuáles les toca trazador. */
  disparos: number
  /** Estado del PRNG interno. */
  semilla: number
}

function crearInstancia(): VfxInstance {
  return {
    usada: false,
    spawnTimeS: 0,
    x: 0,
    y: 0,
    z: 0,
    dx: 0,
    dy: 0,
    dz: 1,
    escala: 1,
    semilla: 0,
    largo: 0,
    superficie: SUPERFICIE_HORMIGON,
  }
}

function crearAnillo(capacidad: number): VfxRing {
  const items: VfxInstance[] = new Array(capacidad)
  for (let i = 0; i < capacidad; i++) items[i] = crearInstancia()
  return { items, capacidad, siguiente: 0, version: 0 }
}

export function createVfxState(): VfxState {
  return {
    fulgores: crearAnillo(VFX.muzzlePoolSize),
    trazadores: crearAnillo(VFX.tracerPoolSize),
    impactos: crearAnillo(VFX.impactPoolSize),
    calcomanias: crearAnillo(VFX.decalPoolSize),
    disparos: 0,
    semilla: 0x2f6e2b1,
  }
}

/**
 * PRNG xorshift32 determinista. No usa Math.random a propósito: el resto del
 * motor evita depender de él en el camino de disparo (ver combat/spread.ts),
 * y así los tests pueden verificar variación sin que el resultado cambie
 * entre corridas.
 */
function siguienteAleatorio(state: VfxState): number {
  let x = state.semilla
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  state.semilla = x >>> 0
  return state.semilla / 0xffffffff
}

/** Toma el próximo slot del anillo, pisando el más viejo si hace falta. */
function tomarSlot(ring: VfxRing): VfxInstance {
  const slot = ring.items[ring.siguiente]
  ring.siguiente = (ring.siguiente + 1) % ring.capacidad
  ring.version++
  slot.usada = true
  return slot
}

/** Fulgor de boca. La posición la pone el renderer (es local al arma), acá
 *  sólo se registran el momento, la escala y la variante. */
export function spawnFulgor(state: VfxState, timeS: number): void {
  const s = tomarSlot(state.fulgores)
  const r = siguienteAleatorio(state)
  s.spawnTimeS = timeS
  s.semilla = r
  s.escala = VFX.muzzleScale * (1 + (r - 0.5) * 2 * VFX.muzzleScaleJitter)
}

/**
 * Trazador desde `from` hasta `to`. Guarda origen, dirección normalizada y
 * distancia; el shader lo desliza a lo largo de esa dirección con el tiempo,
 * así que un trazador no cuesta nada de CPU después del spawn.
 *
 * Devuelve false si a este disparo no le tocaba trazador (ver
 * VFX.tracerFraction) — el llamador no necesita mirarlo, pero los tests sí.
 */
export function spawnTrazador(
  state: VfxState,
  fromX: number,
  fromY: number,
  fromZ: number,
  toX: number,
  toY: number,
  toZ: number,
  timeS: number,
): boolean {
  state.disparos++
  if (VFX.tracerFraction < 1) {
    // Determinista y sin acumular error de punto flotante: cada cuántos
    // disparos entra uno.
    const cada = Math.max(1, Math.round(1 / VFX.tracerFraction))
    if (state.disparos % cada !== 0) return false
  }

  const vx = toX - fromX
  const vy = toY - fromY
  const vz = toZ - fromZ
  const dist = Math.sqrt(vx * vx + vy * vy + vz * vz)
  if (dist <= 1e-5) return false

  const s = tomarSlot(state.trazadores)
  s.spawnTimeS = timeS
  s.x = fromX
  s.y = fromY
  s.z = fromZ
  s.dx = vx / dist
  s.dy = vy / dist
  s.dz = vz / dist
  s.largo = dist
  s.escala = VFX.tracerWidth
  s.semilla = siguienteAleatorio(state)
  return true
}

/** Chispa/humo en el punto de impacto, orientada por la normal. */
export function spawnImpacto(
  state: VfxState,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  superficie: number,
  timeS: number,
): void {
  const s = tomarSlot(state.impactos)
  s.spawnTimeS = timeS
  // Despegado de la superficie a lo largo de la normal, por la razón que
  // documenta VFX.impactOffset: centrado justo sobre la pared, medio
  // billboard queda detrás de ella y el depth test se lo come.
  s.x = x + nx * VFX.impactOffset
  s.y = y + ny * VFX.impactOffset
  s.z = z + nz * VFX.impactOffset
  s.dx = nx
  s.dy = ny
  s.dz = nz
  s.superficie = superficie
  s.escala = VFX.impactScale
  s.semilla = siguienteAleatorio(state)
}

/**
 * Calcomanía (marca de bala) pegada a la superficie. Se despega un poco a lo
 * largo de la normal: dibujarla exactamente sobre la pared pelea en z con
 * ella y produce el parpadeo clásico de z-fighting.
 *
 * Sólo tiene sentido en superficies duras — la carne no deja agujero fijo
 * porque el bot se mueve y la marca quedaría flotando en el aire. El
 * llamador decide; acá no se filtra.
 */
export function spawnCalcomania(
  state: VfxState,
  x: number,
  y: number,
  z: number,
  nx: number,
  ny: number,
  nz: number,
  timeS: number,
): void {
  const s = tomarSlot(state.calcomanias)
  s.spawnTimeS = timeS
  s.x = x + nx * VFX.decalOffset
  s.y = y + ny * VFX.decalOffset
  s.z = z + nz * VFX.decalOffset
  s.dx = nx
  s.dy = ny
  s.dz = nz
  s.escala = VFX.decalScale
  s.semilla = siguienteAleatorio(state)
}

/**
 * Cuántas instancias del anillo siguen vivas en `nowS` con vida `lifeS`.
 * No la usa el juego (el shader decide qué dibujar por su cuenta): existe
 * para que los tests puedan afirmar que un anillo no crece sin techo.
 */
export function instanciasVivas(ring: VfxRing, nowS: number, lifeS: number): number {
  let n = 0
  for (let i = 0; i < ring.capacidad; i++) {
    const it = ring.items[i]
    if (!it.usada) continue
    const edad = nowS - it.spawnTimeS
    if (edad >= 0 && edad < lifeS) n++
  }
  return n
}
