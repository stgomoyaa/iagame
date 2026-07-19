/**
 * Corre la simulación de carrera y escupe las curvas (progression/simulate.ts).
 *
 *   npx vite-node scripts/simular-rangos.ts
 *
 * No es un test: es la herramienta con la que se calibró `expectedCombatScore`
 * y con la que se verificó que la escalera converge. Su salida es lo que se
 * pega en el reporte de la fase.
 */

import { ajustarRecta, etiquetaRango, medirParejos, simulateCareer } from '@/game/progression/simulate'
import { expectedCombatScore } from '@/game/progression/combat-score'
import { rankLabel, RANK_MAX } from '@/game/progression/ranks'
import { RR } from '@/game/progression/rr'

function fijo(n: number, d = 1): string {
  return n.toFixed(d)
}

console.log('== Enfrentamientos parejos: combatScore contra dificultad ==')
const parejos = medirParejos(400, 0xc0ffee)
for (const p of parejos) {
  if (Math.round(p.difficulty * RANK_MAX) % 3 !== 0) continue
  console.log(
    `  ${rankLabel(Math.round(p.difficulty * RANK_MAX)).padEnd(12)} d=${fijo(p.difficulty, 2)}  combatScore medio ${fijo(p.media)}  expected actual ${fijo(expectedCombatScore(p.difficulty))}`,
  )
}
const recta = ajustarRecta(parejos)
console.log(`  ajuste: base ${fijo(recta.base, 2)}  pendiente ${fijo(recta.pendiente, 2)}`)

console.log('')
console.log('== Convergencia por nivel de habilidad (60 partidas, 5 semillas) ==')
console.log('  skill  teorico            final (promedio ultimas 20)      victorias')

const niveles = [0.05, 0.2, 0.35, 0.5, 0.65, 0.8, 0.95]
for (const skill of niveles) {
  const corridas = [0, 1, 2, 3, 4].map((s) => simulateCareer(skill, 60, 0x5111 + s * 7919))
  const estacionario = corridas.reduce((a, c) => a + c.rankEstacionario, 0) / corridas.length
  const teorico = corridas[0].rankTeorico
  const victorias = corridas.reduce((a, c) => a + c.victorias, 0)
  const total = corridas.reduce((a, c) => a + c.victorias + c.derrotas, 0)
  console.log(
    `  ${fijo(skill, 2)}   ${rankLabel(teorico).padEnd(14)} ${etiquetaRango(estacionario).padEnd(14)} (${fijo(estacionario)})   ${fijo((victorias / total) * 100)}%`,
  )
}

console.log('')
console.log('== Reparto de rrChange de un jugador ya estacionado (skill 0.5, 400 partidas) ==')
const largo = simulateCareer(0.5, 400, 0xd15721b, 400)
const rankeadas = largo.samples.filter((s) => s.rank !== null && s.partida > 25)
const victorias = rankeadas.filter((s) => s.win).map((s) => s.rrChange)
const derrotas = rankeadas.filter((s) => !s.win).map((s) => s.rrChange)

function reparto(valores: readonly number[], etiqueta: string): void {
  if (valores.length === 0) return
  const orden = [...valores].sort((a, b) => a - b)
  const media = valores.reduce((a, b) => a + b, 0) / valores.length
  const p = (q: number): number => orden[Math.min(orden.length - 1, Math.floor(q * orden.length))]
  console.log(
    `  ${etiqueta.padEnd(10)} n=${String(valores.length).padStart(3)}  media ${fijo(media)}  min ${p(0)}  p25 ${p(0.25)}  mediana ${p(0.5)}  p75 ${p(0.75)}  max ${orden[orden.length - 1]}`,
  )
}
reparto(victorias, 'victorias')
reparto(derrotas, 'derrotas')
const enTope = victorias.filter((v) => v === 5).length
const enPiso = derrotas.filter((v) => v === -5).length
console.log(
  `  victorias que dieron el minimo (+5): ${fijo((enTope / Math.max(1, victorias.length)) * 100)}%  ` +
    `derrotas que dieron el maximo (-5): ${fijo((enPiso / Math.max(1, derrotas.length)) * 100)}%`,
)

console.log('')
console.log('== Sensibilidad a RR.porPuntoDeDelta (sesgo medio en rangos vs el teorico) ==')
const original = RR.porPuntoDeDelta
for (const coef of [0.25, 0.35, 0.45, 0.55, 0.7]) {
  RR.porPuntoDeDelta = coef
  let sesgo = 0
  let peor = 0
  for (const skill of niveles) {
    const c = simulateCareer(skill, 60, 0x7a1b)
    const d = c.rankEstacionario - c.rankTeorico
    sesgo += d
    if (Math.abs(d) > Math.abs(peor)) peor = d
  }
  console.log(
    `  coef ${fijo(coef, 2)}   sesgo medio ${fijo(sesgo / niveles.length, 2)} rangos   peor caso ${fijo(peor, 2)}`,
  )
}
RR.porPuntoDeDelta = original

console.log('')
console.log('== Trayectoria de un jugador de habilidad 0.65 ==')
const traza = simulateCareer(0.65, 60, 0xbeef)
for (const s of traza.samples) {
  if (s.partida % 5 !== 0 && s.partida > 6) continue
  const rango = s.rank === null ? 'colocacion' : `${rankLabel(s.rank)} ${s.rr}RR`
  console.log(
    `  p${String(s.partida).padStart(2)}  ${rango.padEnd(22)} d=${fijo(s.difficulty, 2)}  rr ${s.rrChange >= 0 ? '+' : ''}${s.rrChange}  ${s.win ? 'victoria' : 'derrota'}`,
  )
}
