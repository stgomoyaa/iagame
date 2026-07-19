/**
 * Paletas curadas por tier de rareza.
 *
 * Es la decisión central de todo el generador, y es a mano por un motivo
 * concreto: sortear tono, saturación y luminosidad al azar dentro de rangos
 * "razonables" produce cuarenta variantes de gris embarrado, porque el
 * promedio de todos los colores posibles es exactamente eso. Un generador
 * así suma un gancho de progresión sin recompensa visual, que es peor que no
 * tener skins.
 *
 * La estructura que sí funciona: pares base/acento elegidos a ojo, con
 * separación de tono y de luminosidad grandes, y la seed decidiendo cuál de
 * esos pares sale, con qué patrón y con cuánta variación fina encima
 * (color.ts, `jitterColor`). El espacio de skins sigue siendo enorme (paleta
 * × patrón × escala × desgaste × metalness × emisivo × animación), pero
 * ningún punto de ese espacio es feo.
 *
 * El eje de rareza también es de color, no sólo de efectos: las comunes son
 * colores de dotación de croma bajo, las raras traen color pero siguen
 * siendo tácticas, y de épico para arriba la saturación y el contraste
 * suben hasta colores que no existen en un arma real.
 */

import { hexToRgb, type Rgb } from '@/game/skins/color'
import type { RarityId } from '@/game/skins/rarity'

export interface Palette {
  /** Sustantivo del nombre de la skin ("Carmesí" + "Fracturado"). */
  name: string
  base: Rgb
  accent: Rgb
}

interface PaletteSpec {
  name: string
  base: string
  accent: string
}

function build(specs: readonly PaletteSpec[]): readonly Palette[] {
  return specs.map((s) => ({ name: s.name, base: hexToRgb(s.base), accent: hexToRgb(s.accent) }))
}

/** Dotación: croma bajo, contraste por luminosidad y no por tono. */
const COMUN = build([
  { name: 'Grafito', base: '#282c31', accent: '#767d85' },
  { name: 'Arena', base: '#574c37', accent: '#c2ac81' },
  { name: 'Oliva', base: '#333b29', accent: '#8b986a' },
  { name: 'Óxido', base: '#432b21', accent: '#a3644a' },
  { name: 'Ventisca', base: '#7c848c', accent: '#e2e8ee' },
  { name: 'Nocturno', base: '#171a20', accent: '#525c70' },
  { name: 'Ceniza', base: '#3b3a38', accent: '#9a958c' },
])

/** Táctico con color: tonos identificables, saturación media. */
const RARO = build([
  { name: 'Cobalto', base: '#182c46', accent: '#4fa6ec' },
  { name: 'Carmesí', base: '#3a1116', accent: '#d0333f' },
  { name: 'Ámbar', base: '#3a2810', accent: '#eda52a' },
  { name: 'Jade', base: '#0e3229', accent: '#2fbd92' },
  { name: 'Ciruela', base: '#28152f', accent: '#a057d4' },
  { name: 'Cobre', base: '#2f1c12', accent: '#e08048' },
  { name: 'Turquesa', base: '#12303a', accent: '#3fc4d4' },
])

/** Dos tonos fuertes y bien separados. Acá arranca el emisivo. */
const EPICO = build([
  { name: 'Tóxico', base: '#14210d', accent: '#a8ec2b' },
  { name: 'Magenta', base: '#2b0d26', accent: '#ee36a4' },
  { name: 'Cian', base: '#0a2831', accent: '#22dcec' },
  { name: 'Solar', base: '#33150a', accent: '#ff7d1e' },
  { name: 'Vórtice', base: '#180e33', accent: '#7f52ff' },
  { name: 'Coral', base: '#2e0f18', accent: '#ff5f6d' },
])

/** Metales preciosos y colores dramáticos sobre negro. */
const LEGENDARIO = build([
  { name: 'Oro Negro', base: '#121009', accent: '#f6c953' },
  { name: 'Sangre Real', base: '#1d0810', accent: '#ff2f58' },
  { name: 'Plasma', base: '#06121e', accent: '#3ef2ff' },
  { name: 'Obsidiana', base: '#100a1e', accent: '#b93cff' },
  { name: 'Esmeralda', base: '#04180f', accent: '#31ffa8' },
])

/** Colores que no existen en un arma real. Tres, y se notan. */
const EXOTICO = build([
  { name: 'Prisma', base: '#090912', accent: '#ff56dd' },
  { name: 'Antimateria', base: '#04060a', accent: '#86ff33' },
  { name: 'Fisura', base: '#0f0206', accent: '#ff8f10' },
])

export const PALETTES_BY_RARITY: Record<RarityId, readonly Palette[]> = {
  comun: COMUN,
  raro: RARO,
  epico: EPICO,
  legendario: LEGENDARIO,
  exotico: EXOTICO,
}
