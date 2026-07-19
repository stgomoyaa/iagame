import { MAX_FRAME_DT } from '@/game/engine/constants'

/**
 * Satura un delta de tiempo crudo al rango seguro para integrar física o
 * animación: [0, max]. Un clamp de sólo Math.min/Math.max NO filtra NaN
 * (cualquier comparación con NaN da `false`, así que pasa intacto) y un NaN
 * que llega a integrar velocidad, posición o una fase de animación corrompe
 * ese estado para siempre: no hay clamp posterior que lo saque de NaN, ni
 * cantidad de ticks sanos después que lo recupere (NaN + número finito
 * sigue siendo NaN).
 *
 * Punto único de esta regla: fixed-loop.ts (el acumulador de ticks),
 * movement/step.ts (stepPlayer) y weapons/viewmodel/rig.ts (stepViewmodel)
 * la llaman en vez de reimplementar el mismo clamp cada uno por su lado.
 * Este bug ya se corrigió dos veces por separado antes de extraer esto
 * (fixed-loop.ts primero, luego el viewmodel); que no se repita una tercera.
 */
export function sanitizeDt(dt: number, max: number = MAX_FRAME_DT): number {
  if (Number.isNaN(dt)) return 0
  return dt < 0 ? 0 : dt > max ? max : dt
}
