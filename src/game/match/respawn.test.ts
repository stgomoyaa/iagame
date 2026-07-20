import { describe, expect, it } from 'vitest'
import {
  createSpawnHistory,
  invulnerabilityExpiresAt,
  isInvulnerable,
  pickFarthestSpawn,
  recordSpawnUse,
  spreadInitialSpawns,
} from '@/game/match/respawn'
import { vec3 } from '@/game/math/vec3'

describe('selección de spawn', () => {
  it('elige el spawn cuya distancia MÍNIMA a cualquier enemigo es la más grande (maximin, no promedio)', () => {
    // Spawn A=(0,0,0): un enemigo a 3m y otro a 60m -> promedio 31.5, mínimo 3.
    // Spawn B=(20,0,0): mismos dos enemigos a 17m y 40m -> promedio 28.5, mínimo 17.
    // Por PROMEDIO, A (31.5) gana a B (28.5) -- pero A tiene un enemigo
    // encima (3m). El criterio correcto (maximin) tiene que elegir B, cuyo
    // peor caso (17m) es mucho más seguro que el peor caso de A (3m).
    const spawns = [vec3(0, 0, 0), vec3(20, 0, 0)]
    const enemies = [vec3(3, 0, 0), vec3(60, 0, 0)]
    expect(pickFarthestSpawn(spawns, enemies)).toBe(1)
  })

  it('sin enemigos vivos, devuelve el primer spawn de forma determinista', () => {
    const spawns = [vec3(-25, 0, -25), vec3(25, 0, 25), vec3(0, 0, -27)]
    expect(pickFarthestSpawn(spawns, [])).toBe(0)
  })

  it('con un solo enemigo, elige el spawn más lejano de ese enemigo', () => {
    const spawns = [vec3(-25, 0, -25), vec3(25, 0, 25), vec3(0, 0, -27)]
    const enemies = [vec3(-24, 0, -24)] // pegado al spawn 0
    expect(pickFarthestSpawn(spawns, enemies)).toBe(1)
  })

  it('enemyCount limita cuántas entradas del buffer de enemyPositions se consideran (buffer scratch más grande de lo necesario)', () => {
    const spawns = [vec3(0, 0, 0), vec3(20, 0, 0)]
    // buffer[0] es el único enemigo "real" esta vez; buffer[1] es basura de
    // una llamada anterior que quedó en el scratch (mismo patrón que
    // game.ts: un buffer de tamaño máximo, sólo las primeras `enemyCount`
    // entradas son vigentes). Si enemyCount se ignorara, el resultado
    // cambiaría entre las dos llamadas -- acá se arma a propósito para que
    // cambie de verdad si el parámetro no se respeta.
    const buffer = [vec3(25, 0, 0), vec3(1, 0, 0)]
    expect(pickFarthestSpawn(spawns, buffer, 1)).toBe(0) // sólo cuenta (25,0,0): spawn 0 (dist 25) gana a spawn 1 (dist 5)
    expect(pickFarthestSpawn(spawns, buffer, 2)).toBe(1) // con la basura sumada, spawn 1 (min 5) gana a spawn 0 (min 1)
  })

  it('un spawn equidistante a varios enemigos gana si el resto tiene un enemigo más cerca todavía', () => {
    const spawns = [vec3(0, 0, 0), vec3(10, 0, 0), vec3(-10, 0, 0)]
    const enemies = [vec3(10, 0, 0), vec3(-10, 0, 0)] // pegados a los spawns 1 y 2
    // Spawn 0 (el centro) queda a 10m de ambos: mejor mínimo que los otros
    // dos, que tienen un enemigo literalmente encima (distancia 0).
    expect(pickFarthestSpawn(spawns, enemies)).toBe(0)
  })
})

describe('reparto de reapariciones (compañeros + recencia)', () => {
  // Dos spawns igual de seguros respecto al enemigo: el maximin solo empata
  // y siempre devuelve el primero. Es exactamente el caso que apilaba a un
  // equipo entero en el mismo punto.
  const spawns = [vec3(0, 0, 0), vec3(0, 0, 10)]
  const enemies = [vec3(100, 0, 5)] // ~100m de los dos, empate práctico

  it('sin compañeros ni historial se comporta igual que antes (empate -> el primero)', () => {
    expect(pickFarthestSpawn(spawns, enemies)).toBe(0)
    expect(pickFarthestSpawn(spawns, enemies, 1, null, 0, null, 0)).toBe(0)
  })

  it('con un compañero encima del spawn empatado, elige el otro', () => {
    const allies = [vec3(0, 0, 0)] // parado justo en el spawn 0
    expect(pickFarthestSpawn(spawns, enemies, 1, allies, 1)).toBe(1)
  })

  it('el término de compañeros no convence de meterse en la mira de un enemigo', () => {
    // spawn 0 seguro (enemigo a 100m) pero con un compañero encima;
    // spawn 1 despejado de compañeros pero con un enemigo a 2m.
    const spawnsAsim = [vec3(0, 0, 0), vec3(0, 0, 10)]
    const enemigoPegado = [vec3(0, 0, 12)] // 2m del spawn 1, 12m del spawn 0
    const allies = [vec3(0, 0, 0)]
    // Sin el tope, +8m de bonus por alejarse del compañero no puede ganarle
    // a perder 10m de distancia al enemigo.
    expect(pickFarthestSpawn(spawnsAsim, enemigoPegado, 1, allies, 1)).toBe(0)
  })

  it('un spawn usado recién pierde contra uno equivalente sin usar', () => {
    const history = createSpawnHistory(4)
    expect(pickFarthestSpawn(spawns, enemies, 1, null, 0, history, 0)).toBe(0)
    recordSpawnUse(history, 0, 0)
    // 1s después el castigo sigue vigente (ventana de 6s)
    expect(pickFarthestSpawn(spawns, enemies, 1, null, 0, history, 1)).toBe(1)
  })

  it('el castigo por recencia se desvanece al vencer la ventana', () => {
    const history = createSpawnHistory(4)
    recordSpawnUse(history, 0, 0)
    // Pasada la ventana completa, el spawn 0 vuelve a estar disponible y el
    // empate se resuelve otra vez a favor del primero.
    expect(pickFarthestSpawn(spawns, enemies, 1, null, 0, history, 99)).toBe(0)
  })

  it('el anillo del historial no crece y pisa lo más viejo', () => {
    const history = createSpawnHistory(2)
    recordSpawnUse(history, 0, 0)
    recordSpawnUse(history, 1, 0)
    recordSpawnUse(history, 0, 0) // pisa la entrada del 0 original
    expect(history.indices.length).toBe(2)
    expect(history.times.length).toBe(2)
  })

  it('reparte una oleada de reapariciones del mismo bando en puntos distintos', () => {
    // Cuatro spawns EXACTAMENTE equidistantes del único enemigo (que está
    // en el centro): el maximin empata en los cuatro y sin los términos
    // nuevos los cuatro compañeros elegirían el índice 0. Es el caso que
    // los términos nuevos existen para resolver -- cuando los spawns
    // difieren mucho en seguridad, la seguridad manda y así debe ser.
    const cuatro = [vec3(-10, 0, 0), vec3(10, 0, 0), vec3(0, 0, -10), vec3(0, 0, 10)]
    const lejos = [vec3(0, 0, 0)]
    const history = createSpawnHistory(4)
    const colocados: ReturnType<typeof vec3>[] = []
    const elegidos: number[] = []
    for (let n = 0; n < 4; n++) {
      const idx = pickFarthestSpawn(cuatro, lejos, 1, colocados, colocados.length, history, n * 0.5)
      elegidos.push(idx)
      recordSpawnUse(history, idx, n * 0.5)
      colocados.push(vec3(cuatro[idx].x, cuatro[idx].y, cuatro[idx].z))
    }
    expect(new Set(elegidos).size).toBe(4)
  })
})

describe('ventana de invulnerabilidad', () => {
  it('invulnerabilityExpiresAt suma la duración al reloj de partida', () => {
    expect(invulnerabilityExpiresAt(10, 1.5)).toBeCloseTo(11.5)
  })

  it('invulnerabilityExpiresAt nunca da un vencimiento anterior al reloj actual (duración negativa se clampea a 0)', () => {
    expect(invulnerabilityExpiresAt(10, -5)).toBe(10)
  })

  it('isInvulnerable es true estrictamente antes del vencimiento', () => {
    const expiresAt = invulnerabilityExpiresAt(10, 1.5)
    expect(isInvulnerable(expiresAt, 10)).toBe(true)
    expect(isInvulnerable(expiresAt, 11)).toBe(true)
  })

  it('isInvulnerable es false en el instante exacto del vencimiento y después', () => {
    const expiresAt = invulnerabilityExpiresAt(10, 1.5)
    expect(isInvulnerable(expiresAt, 11.5)).toBe(false)
    expect(isInvulnerable(expiresAt, 20)).toBe(false)
  })
})

/**
 * Los spawns de nuketown, en forma: 32 puntos en DOS racimos de 16, cada
 * racimo de ~5 x 12 m, separados 61 m. Es la forma que tiene cualquier mapa
 * de Source portado -- el mapper los agrupa por bando -- y es exactamente
 * la que rompía el reparto secuencial.
 *
 * Sintético a propósito y no el nuketown real: los archivos del mapa
 * derivan del Steam Workshop y no viven en el repo (docs/WORKSHOP.md), y un
 * test que se saltea cuando falta un archivo no es un test. Las medidas
 * salen de haber medido el mapa real.
 */
function spawnsEnDosRacimos(): ReturnType<typeof vec3>[] {
  const out: ReturnType<typeof vec3>[] = []
  for (const baseX of [40, -21]) {
    for (let i = 0; i < 16; i++) {
      out.push(vec3(baseX + (i % 4) * 1.6, -1.18, -0.3 - Math.floor(i / 4) * 4))
    }
  }
  return out
}

function separacionMinima(spawns: ReturnType<typeof vec3>[], plan: number[]): number {
  let peor = Infinity
  for (let i = 0; i < plan.length; i++) {
    for (let j = i + 1; j < plan.length; j++) {
      const a = spawns[plan[i]]
      const b = spawns[plan[j]]
      const d = Math.hypot(a.x - b.x, a.z - b.z)
      if (d < peor) peor = d
    }
  }
  return peor
}

describe('reparto de spawns al arrancar la partida', () => {
  it('separa a los participantes en vez de amontonarlos en el primer racimo', () => {
    // El bug medido: repartir en el orden del mapa (0,1,2,...) dejaba a
    // cuatro de los cinco bots a menos de 5 m del jugador, porque los
    // primeros 16 spawns de nuketown son todos de la misma casa.
    const spawns = spawnsEnDosRacimos()
    const secuencial = [0, 1, 2, 3, 4, 5]
    const plan = spreadInitialSpawns(spawns, 6)

    // Umbrales medidos sobre el nuketown real, no elegidos a ojo: con 5
    // bots la separación mínima pasa de 1.72 m a 5.45 m, y la distancia del
    // jugador al enemigo más cercano de 2.44 m a 5.45 m. El racimo es
    // genuinamente chico (5 x 12 m), así que el techo no es "medio mapa":
    // lo que se arregla es que nadie arranque a distancia de escopeta.
    expect(separacionMinima(spawns, secuencial)).toBeLessThan(5)
    expect(separacionMinima(spawns, plan)).toBeGreaterThan(6)
    expect(separacionMinima(spawns, plan)).toBeGreaterThan(
      separacionMinima(spawns, secuencial) * 3,
    )
  })

  it('alterna entre los dos racimos', () => {
    // Con dos grupos separados 61 m, maximin tiene que ir y volver: si el
    // plan se quedara en un solo racimo, el segundo quedaría vacío.
    const spawns = spawnsEnDosRacimos()
    const plan = spreadInitialSpawns(spawns, 4)
    const racimos = plan.map((i) => (spawns[i].x > 0 ? 'A' : 'B'))
    expect(new Set(racimos).size).toBe(2)
  })

  it('da un índice por participante, sin repetir mientras alcancen los spawns', () => {
    const spawns = spawnsEnDosRacimos()
    const plan = spreadInitialSpawns(spawns, 8)
    expect(plan).toHaveLength(8)
    expect(new Set(plan).size).toBe(8)
  })

  it('el primer participante (el jugador) va al spawn 0, determinista', () => {
    const spawns = spawnsEnDosRacimos()
    expect(spreadInitialSpawns(spawns, 5)[0]).toBe(0)
    expect(spreadInitialSpawns(spawns, 5)).toEqual(spreadInitialSpawns(spawns, 5))
  })

  it('con más participantes que spawns recicla en vez de dejar a alguien sin posición', () => {
    const spawns = [vec3(0, 0, 0), vec3(10, 0, 0)]
    const plan = spreadInitialSpawns(spawns, 5)
    expect(plan).toHaveLength(5)
    expect(plan.every((i) => i >= 0 && i < spawns.length)).toBe(true)
  })

  it('un mapa sin spawns devuelve un plan vacío en vez de romper', () => {
    expect(spreadInitialSpawns([], 4)).toEqual([])
  })
})
