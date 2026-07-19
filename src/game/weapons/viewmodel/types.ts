/** Offset de transformación del viewmodel. Rotación en radianes, posición en metros. */
export interface VmTransform {
  px: number
  py: number
  pz: number
  rx: number
  ry: number
  rz: number
}

/** Configuración visual por arma. Todo lo que el rig necesita saber para animarla. */
export interface WeaponVisual {
  hip: VmTransform
  ads: VmTransform
  /** Segundos hip -> ads. */
  adsTime: number
  drawTime: number
  reloadTime: number
  /** Escala del culatazo: multiplica los impulsos de KICK_BACK/KICK_UP/KICK_ROLL. */
  kickMagnitude: number
}
