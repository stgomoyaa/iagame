import { describe, expect, it } from 'vitest'
import {
  createVfxState,
  instanciasVivas,
  spawnCalcomania,
  spawnFulgor,
  spawnImpacto,
  spawnTrazador,
  SUPERFICIE_CARNE,
  SUPERFICIE_HORMIGON,
} from '@/game/feedback/vfx'
import { VFX } from '@/game/feedback/tuning'

describe('anillos de vfx', () => {
  it('arranca con todos los slots sin usar', () => {
    const s = createVfxState()
    expect(instanciasVivas(s.impactos, 0, VFX.impactLifeS)).toBe(0)
    expect(instanciasVivas(s.calcomanias, 0, VFX.decalLifeS)).toBe(0)
  })

  it('las calcomanias no pasan nunca de su capacidad por larga que sea la partida', () => {
    const s = createVfxState()
    // Diez veces la capacidad del anillo, todas dentro de la misma ventana de
    // vida: si el anillo creciera, esto lo delataría.
    const total = VFX.decalPoolSize * 10
    for (let i = 0; i < total; i++) {
      spawnCalcomania(s, i, 0, 0, 0, 1, 0, 0)
    }
    expect(s.calcomanias.items.length).toBe(VFX.decalPoolSize)
    expect(instanciasVivas(s.calcomanias, 0, VFX.decalLifeS)).toBe(VFX.decalPoolSize)
  })

  it('el anillo pisa la instancia mas vieja, no la mas nueva', () => {
    const s = createVfxState()
    for (let i = 0; i < VFX.decalPoolSize; i++) {
      spawnCalcomania(s, i, 0, 0, 0, 1, 0, i)
    }
    // Una mas: tiene que pisar la del slot 0 (la primera que se escribio).
    spawnCalcomania(s, 999, 0, 0, 0, 1, 0, 100)
    expect(s.calcomanias.items[0].x).toBe(999)
    expect(s.calcomanias.items[0].spawnTimeS).toBe(100)
    // La ultima escrita antes de dar la vuelta sigue intacta.
    expect(s.calcomanias.items[VFX.decalPoolSize - 1].x).toBe(VFX.decalPoolSize - 1)
  })

  it('las instancias vencidas dejan de contar como vivas', () => {
    const s = createVfxState()
    spawnImpacto(s, 0, 0, 0, 0, 1, 0, SUPERFICIE_HORMIGON, 0)
    expect(instanciasVivas(s.impactos, 0, VFX.impactLifeS)).toBe(1)
    expect(instanciasVivas(s.impactos, VFX.impactLifeS + 0.01, VFX.impactLifeS)).toBe(0)
  })

  it('sube la version en cada spawn para que el renderer sepa que resubir', () => {
    const s = createVfxState()
    const v0 = s.impactos.version
    spawnImpacto(s, 0, 0, 0, 0, 1, 0, SUPERFICIE_CARNE, 0)
    expect(s.impactos.version).toBe(v0 + 1)
  })
})

describe('calcomanias', () => {
  it('se despegan de la pared a lo largo de la normal para no pelear en z', () => {
    const s = createVfxState()
    // Pared mirando en +X: la marca tiene que quedar delante de x=5, no en x=5.
    spawnCalcomania(s, 5, 1, 2, 1, 0, 0, 0)
    const c = s.calcomanias.items[0]
    expect(c.x).toBeCloseTo(5 + VFX.decalOffset, 6)
    expect(c.y).toBeCloseTo(1, 6)
    expect(c.z).toBeCloseTo(2, 6)
  })

  it('guarda la normal recibida', () => {
    const s = createVfxState()
    spawnCalcomania(s, 0, 0, 0, 0, 0, -1, 0)
    const c = s.calcomanias.items[0]
    expect(c.dx).toBe(0)
    expect(c.dy).toBe(0)
    expect(c.dz).toBe(-1)
  })
})

describe('trazadores', () => {
  it('guarda origen, direccion normalizada y distancia hasta el impacto', () => {
    const s = createVfxState()
    // De (0,0,0) a (0,0,-10): direccion -Z, distancia 10.
    expect(spawnTrazador(s, 0, 0, 0, 0, 0, -10, 0)).toBe(true)
    const t = s.trazadores.items[0]
    expect(t.x).toBe(0)
    expect(t.largo).toBeCloseTo(10, 6)
    expect(t.dz).toBeCloseTo(-1, 6)
    const norma = Math.hypot(t.dx, t.dy, t.dz)
    expect(norma).toBeCloseTo(1, 6)
  })

  it('ignora un disparo de largo cero en vez de escribir una direccion NaN', () => {
    const s = createVfxState()
    // Origen y destino iguales: normalizar dividiria por cero.
    expect(spawnTrazador(s, 3, 3, 3, 3, 3, 3, 0)).toBe(false)
    expect(s.trazadores.items[0].usada).toBe(false)
  })

  it('con fraccion 1 le toca trazador a todos los disparos', () => {
    const s = createVfxState()
    const previo = VFX.tracerFraction
    VFX.tracerFraction = 1
    try {
      for (let i = 0; i < 5; i++) {
        expect(spawnTrazador(s, 0, 0, 0, 0, 0, -10, 0)).toBe(true)
      }
    } finally {
      VFX.tracerFraction = previo
    }
  })

  it('con fraccion 1/3 le toca a uno de cada tres', () => {
    const s = createVfxState()
    const previo = VFX.tracerFraction
    VFX.tracerFraction = 1 / 3
    try {
      const salidas: boolean[] = []
      for (let i = 0; i < 6; i++) salidas.push(spawnTrazador(s, 0, 0, 0, 0, 0, -10, 0))
      expect(salidas.filter(Boolean).length).toBe(2)
    } finally {
      VFX.tracerFraction = previo
    }
  })
})

describe('impactos', () => {
  it('distingue carne de hormigon', () => {
    const s = createVfxState()
    spawnImpacto(s, 0, 0, 0, 0, 1, 0, SUPERFICIE_CARNE, 0)
    spawnImpacto(s, 1, 0, 0, 0, 1, 0, SUPERFICIE_HORMIGON, 0)
    expect(s.impactos.items[0].superficie).toBe(SUPERFICIE_CARNE)
    expect(s.impactos.items[1].superficie).toBe(SUPERFICIE_HORMIGON)
  })
})

describe('fulgor de boca', () => {
  it('varia la escala entre disparos para que no se vea calcado', () => {
    const s = createVfxState()
    for (let i = 0; i < VFX.muzzlePoolSize; i++) spawnFulgor(s, i)
    const escalas = s.fulgores.items.map((f) => f.escala)
    expect(new Set(escalas).size).toBeGreaterThan(1)
  })

  it('mantiene la escala dentro del jitter configurado', () => {
    const s = createVfxState()
    const min = VFX.muzzleScale * (1 - VFX.muzzleScaleJitter)
    const max = VFX.muzzleScale * (1 + VFX.muzzleScaleJitter)
    for (let i = 0; i < 40; i++) {
      spawnFulgor(s, i)
      for (const f of s.fulgores.items) {
        if (!f.usada) continue
        expect(f.escala).toBeGreaterThanOrEqual(min - 1e-9)
        expect(f.escala).toBeLessThanOrEqual(max + 1e-9)
      }
    }
  })
})

describe('determinismo', () => {
  it('dos estados nuevos producen la misma secuencia', () => {
    const a = createVfxState()
    const b = createVfxState()
    for (let i = 0; i < 10; i++) {
      spawnFulgor(a, i)
      spawnFulgor(b, i)
    }
    expect(a.fulgores.items.map((f) => f.escala)).toEqual(b.fulgores.items.map((f) => f.escala))
  })
})

describe('presupuesto de asignaciones', () => {
  it('cero asignaciones: cientos de miles de spawns no hacen crecer el heap', () => {
    expect(typeof global.gc, 'correr con --expose-gc').toBe('function')

    const s = createVfxState()
    // Calentamiento: que los anillos ya hayan dado la vuelta antes de medir.
    for (let i = 0; i < 5000; i++) {
      spawnFulgor(s, i * 0.01)
      spawnTrazador(s, 0, 0, 0, 0, 0, -20, i * 0.01)
      spawnImpacto(s, 1, 2, 3, 0, 1, 0, SUPERFICIE_HORMIGON, i * 0.01)
      spawnCalcomania(s, 1, 2, 3, 0, 1, 0, i * 0.01)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 200_000; i++) {
      const t = i * 0.01
      spawnFulgor(s, t)
      spawnTrazador(s, 0, 0, 0, 0, 0, -20, t)
      spawnImpacto(s, 1, 2, 3, 0, 1, 0, i % 2 === 0 ? SUPERFICIE_CARNE : SUPERFICIE_HORMIGON, t)
      spawnCalcomania(s, 1, 2, 3, 0, 1, 0, t)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024
    expect(crecimientoMB).toBeLessThan(1)
  })
})
