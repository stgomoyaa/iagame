import { describe, expect, it } from 'vitest'
import {
  isWeaponUnlocked,
  levelForXp,
  NIVEL_INICIAL,
  NIVEL_MAXIMO,
  NIVEL_MAXIMO_DESBLOQUEO,
  nivelMaximoDeDesbloqueo,
  progresoDeNivel,
  unlockedWeapons,
  unlockLevelFor,
  unlockLevelsSnapshot,
  xpParaNivel,
} from '@/game/progression/unlocks'
import { applyMatchResult, careerDifficulty, createDefaultCareer } from '@/game/progression/career'
import { createRandom, simulateMatch } from '@/game/progression/simulate'
import { resolveArchetype, weaponIndex } from '@/game/weapons/registry'

describe('desbloqueo por nivel de cuenta', () => {
  it('cubre las 40 armas del pack', () => {
    const slugs = weaponIndex().map((e) => e.slug)
    expect(slugs.length).toBe(40)
    for (const slug of slugs) expect(unlockLevelsSnapshot()[slug]).toBeGreaterThan(0)
  })

  it('tira con un arma que no existe en vez de dejarla desbloqueada', () => {
    expect(() => unlockLevelFor('no-existe')).toThrow()
  })

  it('una cuenta nueva tiene al menos un fusil y una pistola', () => {
    // La condición que hace que defaultLoadout() siempre pueda armar un
    // loadout jugable, y que un jugador nuevo nunca spawnee sin arma.
    const clases = unlockedWeapons(NIVEL_INICIAL).map((s) => resolveArchetype(s).class)
    expect(clases).toContain('ar')
    expect(clases).toContain('pistol')
  })

  it('una cuenta nueva no tiene todo el arsenal', () => {
    expect(unlockedWeapons(NIVEL_INICIAL).length).toBeLessThan(weaponIndex().length)
  })

  it('el arsenal sólo crece con el nivel', () => {
    let anterior = 0
    for (let nivel = 1; nivel <= nivelMaximoDeDesbloqueo() + 1; nivel++) {
      const cantidad = unlockedWeapons(nivel).length
      expect(cantidad).toBeGreaterThanOrEqual(anterior)
      anterior = cantidad
    }
    expect(anterior).toBe(weaponIndex().length)
  })

  it('las clases de nicho llegan después que fusiles y pistolas', () => {
    const minimoDeClase = (clase: string): number =>
      Math.min(
        ...weaponIndex()
          .filter((e) => resolveArchetype(e.slug).class === clase)
          .map((e) => unlockLevelFor(e.slug)),
      )
    expect(minimoDeClase('smg')).toBeGreaterThan(minimoDeClase('ar'))
    expect(minimoDeClase('smg')).toBeGreaterThan(minimoDeClase('pistol'))
  })

  it('isWeaponUnlocked es coherente con unlockLevelFor', () => {
    for (const entry of weaponIndex()) {
      const nivel = unlockLevelFor(entry.slug)
      expect(isWeaponUnlocked(entry.slug, nivel - 1)).toBe(false)
      expect(isWeaponUnlocked(entry.slug, nivel)).toBe(true)
    }
  })

  it('ningún arma exige más nivel que el tope de desbloqueo', () => {
    // La invariante que hace que crecer el catálogo no deje armas del otro
    // lado del techo de nivel.
    for (const nivel of Object.values(unlockLevelsSnapshot())) {
      expect(nivel).toBeLessThanOrEqual(NIVEL_MAXIMO_DESBLOQUEO)
    }
    expect(NIVEL_MAXIMO_DESBLOQUEO).toBeLessThan(NIVEL_MAXIMO)
  })

  it('un arma permanente ignora el nivel', () => {
    const tardia = weaponIndex()
      .map((e) => e.slug)
      .reduce((a, b) => (unlockLevelFor(a) >= unlockLevelFor(b) ? a : b))
    expect(unlockLevelFor(tardia)).toBeGreaterThan(NIVEL_INICIAL)

    expect(isWeaponUnlocked(tardia, NIVEL_INICIAL)).toBe(false)
    expect(isWeaponUnlocked(tardia, NIVEL_INICIAL, [tardia])).toBe(true)
    expect(unlockedWeapons(NIVEL_INICIAL, [tardia])).toContain(tardia)
    // Una permanente ajena no desbloquea otra cosa.
    expect(isWeaponUnlocked(tardia, NIVEL_INICIAL, ['otra-cosa'])).toBe(false)
  })
})

describe('nivel por xp', () => {
  it('una cuenta sin xp está en el nivel inicial', () => {
    expect(levelForXp(0)).toBe(NIVEL_INICIAL)
    expect(levelForXp(-100)).toBe(NIVEL_INICIAL)
    expect(levelForXp(Number.NaN)).toBe(NIVEL_INICIAL)
  })

  it('xpParaNivel es la inversa exacta en todos los niveles y en sus bordes', () => {
    for (let nivel = NIVEL_INICIAL; nivel <= NIVEL_MAXIMO; nivel++) {
      const xp = xpParaNivel(nivel)
      expect(levelForXp(xp)).toBe(nivel)
      if (nivel > NIVEL_INICIAL) expect(levelForXp(xp - 1)).toBe(nivel - 1)
      if (nivel < NIVEL_MAXIMO) expect(levelForXp(xp + 1)).toBe(nivel)
    }
  })

  it('la fórmula cerrada coincide con una búsqueda lineal en TODO el dominio', () => {
    // `levelForXp` resuelve una cuadrática con Math.sqrt en vez de contar
    // niveles. Este test es la única razón por la que se puede confiar en
    // eso: compara XP por XP contra la definición ingenua, en el rango
    // entero del ciclo. Si alguien cambia los coeficientes a un rango donde
    // la raíz deje de ser exacta, falla acá y no en la partida de alguien.
    const porFuerzaBruta = (xp: number): number => {
      let nivel = NIVEL_INICIAL
      while (nivel < NIVEL_MAXIMO && xpParaNivel(nivel + 1) <= xp) nivel++
      return nivel
    }

    // Cota del dominio antes de recorrerlo. Sin esto, unos coeficientes
    // absurdos no harían fallar este test: lo harían colgarse, que en la
    // práctica es peor (nadie sabe si falló o si la máquina está lenta).
    // 400.000 XP son ~165 partidas, muy por encima de las ~50 que dura el
    // ciclo: pasar de ahí ya sería otro diseño y hay que volver a medir.
    const dominio = xpParaNivel(NIVEL_MAXIMO)
    expect(dominio).toBeLessThan(400_000)

    for (let xp = 0; xp <= dominio + 5000; xp++) {
      if (levelForXp(xp) !== porFuerzaBruta(xp)) {
        // Un expect por XP serían 125.000 aserciones; se reporta la primera
        // discrepancia con su número, que es lo que hace falta para
        // depurarla.
        expect(`xp=${xp} -> ${levelForXp(xp)}`).toBe(`xp=${xp} -> ${porFuerzaBruta(xp)}`)
      }
    }
    expect(levelForXp(xpParaNivel(30) + 0.5)).toBe(30)
  })

  it('la curva es progresiva: cada nivel cuesta más que el anterior', () => {
    // Si alguien la volviera lineal, esto falla.
    let anterior = 0
    for (let nivel = NIVEL_INICIAL + 1; nivel <= NIVEL_MAXIMO; nivel++) {
      const costo = xpParaNivel(nivel) - xpParaNivel(nivel - 1)
      expect(costo).toBeGreaterThan(anterior)
      anterior = costo
    }
  })

  it('el nivel tiene techo', () => {
    expect(levelForXp(xpParaNivel(NIVEL_MAXIMO) * 100)).toBe(NIVEL_MAXIMO)
    expect(levelForXp(Number.MAX_SAFE_INTEGER)).toBe(NIVEL_MAXIMO)
  })

  it('la barra de nivel se llena y no se pasa', () => {
    const medio = progresoDeNivel(xpParaNivel(10) + 1)
    expect(medio.level).toBe(10)
    expect(medio.fraccion).toBeGreaterThan(0)
    expect(medio.fraccion).toBeLessThan(1)
    expect(medio.enTecho).toBe(false)

    const techo = progresoDeNivel(xpParaNivel(NIVEL_MAXIMO) * 3)
    expect(techo.level).toBe(NIVEL_MAXIMO)
    expect(techo.fraccion).toBe(1)
    expect(techo.falta).toBe(0)
    expect(techo.enTecho).toBe(true)
  })
})

describe('ritmo de la curva contra partidas reales', () => {
  /** Cuántas partidas tarda un jugador sintético en llegar a `objetivo`. */
  function partidasHasta(skill: number, objetivo: number, seed: number): number {
    const rand = createRandom(seed)
    let data = createDefaultCareer()
    for (let i = 1; i <= 500; i++) {
      const perf = simulateMatch(skill, careerDifficulty(data), rand)
      data = applyMatchResult(data, perf).data
      if (levelForXp(data.xp) >= objetivo) return i
    }
    return Infinity
  }

  it('la primera partida siempre sube de nivel', () => {
    // La regla del diseño: ninguna acción cae en el vacío, y la primera
    // partida es la que decide si el jugador vuelve.
    for (const skill of [0.15, 0.5, 0.85]) {
      expect(partidasHasta(skill, NIVEL_INICIAL + 1, 7)).toBe(1)
    }
  })

  it('el ciclo completo dura entre 35 y 70 partidas', () => {
    // La medición que justificó cambiar la curva: con la lineal de 1200 el
    // techo de desbloqueo llegaba en 12 partidas (~75 minutos) y prestigiar
    // habría sido reiniciar antes de usar nada. La ventana es ancha a
    // propósito -- fija el ORDEN DE MAGNITUD, que es lo que se decidió, y no
    // un número exacto que cambiaría con cualquier retoque de balance de los
    // bots.
    for (const skill of [0.2, 0.5, 0.8]) {
      const partidas = partidasHasta(skill, NIVEL_MAXIMO, 4242)
      expect(partidas).toBeGreaterThanOrEqual(35)
      expect(partidas).toBeLessThanOrEqual(70)
    }
  })

  it('el arsenal completo entra dentro del ciclo, y no en la primera tarde', () => {
    // El otro lado de la advertencia de escala. Medido con este catálogo:
    //
    //   40 armas (build publicable):  última arma en la partida 13 de 46
    //   79 armas (con las locales):   última arma en la partida 24 de 46
    //   148 armas (catálogo completo): la compresión la deja en el nivel 50,
    //                                  o sea la partida ~39 de 46
    //
    // Las dos cotas que sí son propiedades del diseño y no del tamaño del
    // pack: nadie termina el arsenal en las primeras partidas, y nadie llega
    // al techo con armas todavía por desbloquear (si eso pasara, prestigiar
    // borraría el acceso a un arma que el jugador nunca llegó a tener).
    const ultima = partidasHasta(0.5, nivelMaximoDeDesbloqueo(), 4242)
    const techo = partidasHasta(0.5, NIVEL_MAXIMO, 4242)
    expect(ultima).toBeGreaterThanOrEqual(10)
    expect(ultima).toBeLessThan(techo)
  })
})
