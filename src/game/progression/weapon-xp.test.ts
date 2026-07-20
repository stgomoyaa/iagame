import { describe, expect, it } from 'vitest'

import { generateSkin } from '@/game/skins/generator'
import { rarityRank } from '@/game/skins/rarity'
import { XP } from '@/game/progression/xp'
import {
  applyWeaponXp,
  armasMaestreadas,
  camosDeMaestria,
  COSTO_PASO,
  createWeaponTally,
  MAESTRIA_PREFIX,
  NIVEL_ARMA_INICIAL,
  NIVEL_ARMA_MAXIMO,
  nivelDeArma,
  RAREZA_POR_NIVEL,
  registrarDano,
  registrarKill,
  resetWeaponTally,
  seedMaestria,
  seedsDeMaestria,
  TALLY_CAPACIDAD,
  weaponProgress,
  WEAPON_XP,
  xpDeArmaEnPartida,
  XP_ARMA_MAESTRIA,
  xpParaNivelArma,
} from '@/game/progression/weapon-xp'

describe('curva de niveles por arma', () => {
  it('el nivel es el inverso exacto del umbral, en los dos bordes de cada nivel', () => {
    for (let n = NIVEL_ARMA_INICIAL; n <= NIVEL_ARMA_MAXIMO; n++) {
      const umbral = xpParaNivelArma(n)
      expect(nivelDeArma(umbral)).toBe(n)
      // Un punto por debajo del umbral todavía es el nivel anterior.
      if (n > NIVEL_ARMA_INICIAL) expect(nivelDeArma(umbral - 1)).toBe(n - 1)
    }
  })

  it('los costos crecen y el ultimo ascenso cuesta 4 veces el primero', () => {
    const costos: number[] = []
    for (let n = NIVEL_ARMA_INICIAL; n < NIVEL_ARMA_MAXIMO; n++) {
      costos.push(xpParaNivelArma(n + 1) - xpParaNivelArma(n))
    }
    expect(costos).toEqual([600, 1200, 1800, 2400])
    expect(costos[costos.length - 1]).toBe(costos[0] * 4)
    expect(XP_ARMA_MAESTRIA).toBe(6000)
  })

  it('satura en el nivel maximo por mucha xp que se acumule', () => {
    expect(nivelDeArma(XP_ARMA_MAESTRIA)).toBe(NIVEL_ARMA_MAXIMO)
    expect(nivelDeArma(XP_ARMA_MAESTRIA * 1000)).toBe(NIVEL_ARMA_MAXIMO)
  })

  it('la basura cae al nivel inicial en vez de propagarse', () => {
    for (const v of [NaN, Infinity, -Infinity, -5, 0]) {
      expect(nivelDeArma(v)).toBe(NIVEL_ARMA_INICIAL)
    }
  })

  /**
   * El compromiso de diseño, escrito como test: la derivación de la cabecera
   * dice ~5 partidas por arma a ~1200 XP de arma por partida. Si alguien
   * retoca COSTO_PASO o los valores por evento sin rehacer la cuenta, esto
   * cae y lo obliga a actualizar la justificación.
   */
  it('maestrear un arma cuesta del orden de 5 partidas como arma principal', () => {
    const xpPorPartida = xpDeArmaEnPartida(12, 4, 2000)
    expect(xpPorPartida).toBe(1600)
    // La primaria se lleva la mayor parte, no todo.
    const comoPrincipal = xpDeArmaEnPartida(9, 3, 1500)
    const partidas = XP_ARMA_MAESTRIA / comoPrincipal
    expect(partidas).toBeGreaterThan(4)
    expect(partidas).toBeLessThan(7)
  })

  /**
   * Un bot tiene 100 de vida, así que un kill arrastra sus 100 de daño: vale
   * 110, o 160 con headshot. Cinco o seis kills tienen que alcanzar para el
   * primer ascenso, o la capa no se ve en la primera partida.
   */
  it('el primer ascenso cae dentro de la primera partida', () => {
    // Cinco kills, dos de ellos headshot, con el daño que implican.
    expect(nivelDeArma(xpDeArmaEnPartida(5, 2, 500))).toBe(2)
    // Seis kills sin un solo headshot también alcanzan.
    expect(nivelDeArma(xpDeArmaEnPartida(6, 0, 600))).toBe(2)
    // Cuatro sin headshots todavía no.
    expect(nivelDeArma(xpDeArmaEnPartida(4, 0, 400))).toBe(1)
  })
})

describe('barra de progreso', () => {
  it('parte en cero y llena justo antes del ascenso', () => {
    const inicio = weaponProgress('ak47', 0)
    expect(inicio.nivel).toBe(1)
    expect(inicio.xpEnNivel).toBe(0)
    expect(inicio.xpDelNivel).toBe(COSTO_PASO)
    expect(inicio.maestria).toBe(false)

    const casi = weaponProgress('ak47', COSTO_PASO - 1)
    expect(casi.nivel).toBe(1)
    expect(casi.xpEnNivel).toBe(COSTO_PASO - 1)
  })

  it('en maestria la barra queda llena y no divide por cero', () => {
    const p = weaponProgress('ak47', XP_ARMA_MAESTRIA)
    expect(p.maestria).toBe(true)
    expect(p.xpDelNivel).toBeGreaterThan(0)
    expect(p.xpEnNivel).toBe(p.xpDelNivel)
  })
})

describe('xp por evento', () => {
  it('reusa los valores de xp.ts en vez de una tabla propia', () => {
    expect(WEAPON_XP.porKill).toBe(XP.porKill)
    expect(WEAPON_XP.porHeadshot).toBe(XP.porHeadshot)
    expect(WEAPON_XP.porDiezDeDano).toBe(XP.porDiezDeDano)
  })

  /**
   * La separación que da sentido a la capa: el arma cobra por lo que hizo,
   * no por el resultado de la partida. Dos partidas con el mismo desempeño
   * de arma dan la misma XP de arma, se haya ganado o perdido.
   */
  it('no cobra participacion ni bono de victoria', () => {
    const xp = xpDeArmaEnPartida(0, 0, 0)
    expect(xp).toBe(0)
    expect(xp).not.toBe(XP.participacion)

    // Un kill vale exactamente el kill, sin ningún término de partida encima.
    expect(xpDeArmaEnPartida(1, 0, 0)).toBe(XP.porKill)
  })

  it('los headshots no pueden superar a los kills', () => {
    expect(xpDeArmaEnPartida(2, 99, 0)).toBe(xpDeArmaEnPartida(2, 2, 0))
  })
})

describe('acumulador de partida', () => {
  it('acumula por arma por separado', () => {
    const t = createWeaponTally()
    registrarKill(t, 'ak47', true)
    registrarDano(t, 'ak47', 100)
    registrarKill(t, 'glock', false)

    const { armas, outcomes } = applyWeaponXp({}, t)
    expect(outcomes.map((o) => o.slug)).toEqual(['ak47', 'glock'])
    expect(armas.ak47).toBe(XP.porKill + XP.porHeadshot + 10)
    expect(armas.glock).toBe(XP.porKill)
  })

  it('reset deja el acumulador como nuevo', () => {
    const t = createWeaponTally()
    registrarKill(t, 'ak47', true)
    registrarDano(t, 'ak47', 500)
    resetWeaponTally(t)
    expect(t.count).toBe(0)
    expect(applyWeaponXp({}, t).outcomes).toEqual([])

    // Y vuelve a funcionar después del reset.
    registrarKill(t, 'glock', false)
    expect(applyWeaponXp({}, t).armas).toEqual({ glock: XP.porKill })
  })

  it('ignora dano invalido y no crea la entrada', () => {
    const t = createWeaponTally()
    for (const v of [NaN, Infinity, 0, -10]) registrarDano(t, 'ak47', v)
    expect(t.count).toBe(0)
  })

  it('al pasarse de capacidad deja de acumular en vez de crecer', () => {
    const t = createWeaponTally()
    for (let i = 0; i < TALLY_CAPACIDAD + 4; i++) registrarKill(t, `arma-${i}`, false)
    expect(t.count).toBe(TALLY_CAPACIDAD)
    expect(t.slugs.length).toBe(TALLY_CAPACIDAD)
    expect(Object.keys(applyWeaponXp({}, t).armas)).toHaveLength(TALLY_CAPACIDAD)
  })

  /**
   * La regla dura del proyecto: el camino del disparo no asigna.
   *
   *
   * POR QUÉ ESTE GUARD NO MIDE COMO LOS OTROS NUEVE
   *
   * Los guards de allocations.test.ts (match/, bots/, movement/) miden
   * heapUsed con `gc()` ANTES y DESPUÉS, así que detectan memoria
   * **retenida**: una fuga de 8 bytes por tick que nadie suelta. Es lo
   * correcto para lo que vigilan.
   *
   * Acá eso no alcanza, y se comprobó rompiendo el código a propósito: una
   * asignación por llamada que se suelta enseguida (un objeto temporal, un
   * array que se vacía) no retiene NADA, así que un guard con `gc()` al
   * final la deja pasar entera. Este archivo llegó a tener ese guard y
   * pasaba con dos mutaciones distintas metidas a mano.
   *
   * La medición correcta para "no asigna" es la TASA de asignación, no la
   * retención: se fuerza GC, se mide, se corre un tramo corto y se vuelve a
   * medir **sin** GC, de modo que todo lo asignado en el tramo siga en el
   * heap joven cuando se lee. 20.000 vueltas es el punto medido donde el
   * tramo no dispara un scavenge por sí solo.
   *
   * Números medidos (Node, 4 corridas, ver el reporte de la tarea):
   *   - implementación limpia:            0.2 a 3.1 KB
   *   - con una asignación por llamada: 1079 a 1601 KB
   * El umbral de 256 KB queda ~80x sobre el ruido y ~4x bajo la señal.
   *
   * Un detalle que también salió de romper esto: un objeto temporal que NO
   * escapa lo elimina el escape analysis de V8 y no llega a asignar nunca,
   * así que ni este guard ni ninguno lo ven -- y está bien, porque en ese
   * caso no hay asignación real que ver.
   */
  it('registrar dano y kills no asigna memoria', () => {
    // Asertar, no saltar en silencio: un guard que se auto-desactiva cuando
    // falta el flag es peor que no tenerlo, porque se lee como que pasó.
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const t = createWeaponTally()

    function golpe(i: number): void {
      const slug = i % 2 === 0 ? 'ak47' : 'glock'
      registrarDano(t, slug, 12.5)
      registrarKill(t, slug, i % 3 === 0)
    }

    // Calentar hasta que el JIT estabilice: la primera pasada de una función
    // fría asigna por su cuenta (ICs, feedback vectors) y ensuciaría la
    // medición.
    for (let i = 0; i < 20_000; i++) golpe(i)

    global.gc?.()
    global.gc?.()
    const antes = process.memoryUsage().heapUsed
    for (let i = 0; i < 20_000; i++) golpe(i)
    // Sin gc() acá a propósito: ver la cabecera.
    const despues = process.memoryUsage().heapUsed

    expect((despues - antes) / 1024).toBeLessThan(256)
  })
})

describe('applyWeaponXp', () => {
  it('no muta el mapa que recibe', () => {
    const original = { ak47: 100 }
    const t = createWeaponTally()
    registrarKill(t, 'ak47', false)
    const { armas } = applyWeaponXp(original, t)
    expect(original).toEqual({ ak47: 100 })
    expect(armas.ak47).toBe(100 + XP.porKill)
  })

  it('acumula sobre lo ya guardado y reporta el ascenso', () => {
    const t = createWeaponTally()
    registrarKill(t, 'ak47', false)
    const { outcomes } = applyWeaponXp({ ak47: COSTO_PASO - XP.porKill }, t)
    expect(outcomes[0].nivelAnterior).toBe(1)
    expect(outcomes[0].nivel).toBe(2)
    expect(outcomes[0].subioDeNivel).toBe(true)
    expect(outcomes[0].camos).toHaveLength(1)
    expect(outcomes[0].camos[0].rarity).toBe(RAREZA_POR_NIVEL[2])
  })

  it('un arma equipada que no hizo nada no entra al guardado', () => {
    const t = createWeaponTally()
    registrarDano(t, 'ak47', 0)
    registrarKill(t, 'glock', false)
    const { armas } = applyWeaponXp({}, t)
    expect(armas).toEqual({ glock: XP.porKill })
    expect('ak47' in armas).toBe(false)
  })

  it('un salto de dos niveles entrega los dos camos', () => {
    const t = createWeaponTally()
    // Suficiente para cruzar del nivel 1 al 3 de una.
    registrarKill(t, 'ak47', false)
    registrarDano(t, 'ak47', 20_000)
    const { outcomes } = applyWeaponXp({}, t)
    expect(outcomes[0].nivel).toBe(3)
    expect(outcomes[0].camos.map((c) => c.rarity)).toEqual([
      RAREZA_POR_NIVEL[2],
      RAREZA_POR_NIVEL[3],
    ])
  })

  it('en maestria deja de entregar camos', () => {
    const t = createWeaponTally()
    registrarKill(t, 'ak47', false)
    const { outcomes } = applyWeaponXp({ ak47: XP_ARMA_MAESTRIA }, t)
    expect(outcomes[0].subioDeNivel).toBe(false)
    expect(outcomes[0].camos).toEqual([])
  })

  it('tolera un valor corrupto en el mapa guardado', () => {
    const t = createWeaponTally()
    registrarKill(t, 'ak47', false)
    const corrupto = { ak47: NaN } as unknown as Record<string, number>
    expect(applyWeaponXp(corrupto, t).armas.ak47).toBe(XP.porKill)
  })
})

describe('camos de maestria', () => {
  it('la seed es determinista y la rareza es la del nivel, no un sorteo', () => {
    for (const slug of ['ak47', 'glock', 'm4a1', 'awp', 'mp5']) {
      for (const nivel of [2, 3, 4, 5]) {
        const seed = seedMaestria(slug, nivel)
        expect(seed).toBe(seedMaestria(slug, nivel))
        expect(seed.startsWith(`${MAESTRIA_PREFIX}:${slug}:${nivel}:`)).toBe(true)
        expect(generateSkin(seed).rarity).toBe(RAREZA_POR_NIVEL[nivel])
      }
    }
  })

  it('la rareza sube monotonamente con el nivel', () => {
    const rangos = [2, 3, 4, 5].map((n) => rarityRank(generateSkin(seedMaestria('ak47', n)).rarity))
    for (let i = 1; i < rangos.length; i++) expect(rangos[i]).toBeGreaterThan(rangos[i - 1])
  })

  it('dos armas distintas no comparten camo de maestria', () => {
    expect(seedMaestria('ak47', 5)).not.toBe(seedMaestria('glock', 5))
  })

  it('el nivel 1 no tiene camo: no se regala nada por equipar', () => {
    expect(RAREZA_POR_NIVEL[1]).toBeUndefined()
    expect(() => seedMaestria('ak47', 1)).toThrow()
    expect(camosDeMaestria('ak47', 0)).toEqual([])
  })

  it('los camos desbloqueados se derivan del nivel, sin guardarlos', () => {
    expect(camosDeMaestria('ak47', xpParaNivelArma(4))).toHaveLength(3)
    expect(camosDeMaestria('ak47', XP_ARMA_MAESTRIA)).toHaveLength(4)
    expect(seedsDeMaestria({ ak47: XP_ARMA_MAESTRIA, glock: xpParaNivelArma(2) })).toHaveLength(5)
  })

  it('cuenta las armas maestreadas', () => {
    expect(
      armasMaestreadas({ ak47: XP_ARMA_MAESTRIA, glock: 10, m4a1: XP_ARMA_MAESTRIA }),
    ).toBe(2)
  })
})
