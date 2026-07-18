# Fase 0: Arena y Movimiento — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Una arena jugable donde moverse se siente rápido y responsivo (sprint, slide, slide-cancel, bunny hop, mantle), con el presupuesto de 2.5ms de frame medido y verificado, antes de que exista un solo disparo.

**Architecture:** Toda la lógica de simulación vive en TypeScript puro sin dependencias de Three.js ni de React, para que sea testeable con Vitest en milisegundos. Three.js consume el estado de simulación pero nunca lo produce. Un loop de timestep fijo a 128Hz corre la simulación de forma determinista e independiente del framerate; el render interpola entre el tick anterior y el actual. Ninguna función del camino caliente asigna memoria.

**Tech Stack:** Next.js 16 (App Router), TypeScript strict, Tailwind, Three.js (WebGL2), Vitest, pnpm.

## Global Constraints

Copiados literales del spec (`docs/superpowers/specs/2026-07-18-arcade-fps-design.md`). Aplican a **todas** las tareas.

- **Presupuesto de frame: 2.5ms (CPU + GPU).** Escritorio 240Hz = 4.16ms disponibles, MacBook 120Hz = 8.33ms.
- **Cero asignaciones por frame.** Nada de `new Vector3()`, `[]`, `{}`, closures ni `.map()/.filter()` dentro del tick o del render. Objetos scratch preasignados a nivel de módulo.
- **≤50 draw calls, ≤150k triángulos visibles.**
- **React nunca corre dentro del frame.** El HUD de rendimiento se actualiza por DOM imperativo.
- **TypeScript strict.** Prohibido `any`; usar `unknown` con narrowing.
- **Imports con alias `@/`.**
- **Sin comentarios que referencien tareas ni al agente. Sin emojis en código.**
- **Unidades: metros y segundos.** Ángulos en radianes.
- **`src/game/**` no puede importar de `react`, `next` ni `three`.** Excepción única: `src/game/engine/renderer.ts` y `src/game/map/mesh.ts`, que sí usan Three. La regla se verifica con un test.
- Commits en español, imperativo, prefijo convencional (`feat:`, `test:`, `chore:`).

---

### Task 1: Scaffold del proyecto

**Files:**
- Create: todo el árbol de `create-next-app`
- Create: `vitest.config.ts`
- Create: `src/game/engine/constants.ts`
- Test: `src/game/engine/constants.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `TICK_HZ: number`, `TICK_DT: number`, `MAX_FRAME_DT: number`, `FRAME_BUDGET_MS: number`

- [ ] **Step 1: Scaffold Next.js**

```bash
cd /Users/santiago/dev/iagame
pnpm dlx create-next-app@latest . --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm --turbopack --yes
```

Si se queja de que el directorio no está vacío, es por `docs/` y `.gitignore`. Es esperado: aceptar y continuar.

- [ ] **Step 2: Instalar dependencias de juego y test**

```bash
pnpm add three three-mesh-bvh
pnpm add -D vitest @types/three
```

- [ ] **Step 3: Configurar Vitest**

Crear `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: { '@': resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
```

Agregar a `package.json` en `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Escribir el test que falla**

Crear `src/game/engine/constants.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { FRAME_BUDGET_MS, MAX_FRAME_DT, TICK_DT, TICK_HZ } from '@/game/engine/constants'

describe('constantes del motor', () => {
  it('el tick corre a 128Hz', () => {
    expect(TICK_HZ).toBe(128)
    expect(TICK_DT).toBeCloseTo(1 / 128, 10)
  })

  it('el guard de frame largo evita la espiral de la muerte', () => {
    expect(MAX_FRAME_DT).toBeGreaterThan(TICK_DT)
    expect(MAX_FRAME_DT).toBeLessThanOrEqual(0.25)
  })

  it('el presupuesto de frame es 2.5ms', () => {
    expect(FRAME_BUDGET_MS).toBe(2.5)
  })
})
```

- [ ] **Step 5: Correr el test y verificar que falla**

Run: `pnpm test`
Expected: FAIL, `Failed to resolve import "@/game/engine/constants"`

- [ ] **Step 6: Implementar**

Crear `src/game/engine/constants.ts`:

```ts
export const TICK_HZ = 128
export const TICK_DT = 1 / TICK_HZ

/** Techo de delta por frame. Sin esto, una pestaña en background acumula
 *  segundos de tiempo y el loop entra en espiral tratando de alcanzarlo. */
export const MAX_FRAME_DT = 0.25

/** Presupuesto de frame en milisegundos (CPU + GPU). */
export const FRAME_BUDGET_MS = 2.5
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `pnpm test`
Expected: PASS, 3 tests

- [ ] **Step 8: Commit**

```bash
committer "chore: scaffold de Next.js con Vitest y constantes del motor

Next.js 16 con App Router, TypeScript strict, Tailwind y pnpm. Vitest
configurado con alias @/ para testear la lógica de juego sin DOM.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  package.json pnpm-lock.yaml vitest.config.ts tsconfig.json \
  src/game/engine/constants.ts src/game/engine/constants.test.ts
```

Si `create-next-app` generó más archivos sin trackear, agregarlos en un commit aparte con `committer`.

---

### Task 2: Vec3 sin asignaciones

**Files:**
- Create: `src/game/math/vec3.ts`
- Test: `src/game/math/vec3.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `type Vec3 = { x: number; y: number; z: number }`
  - `vec3(x?, y?, z?): Vec3`
  - `set(out: Vec3, x: number, y: number, z: number): Vec3`
  - `copy(out: Vec3, a: Vec3): Vec3`
  - `addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3`
  - `scale(out: Vec3, a: Vec3, s: number): Vec3`
  - `dot(a: Vec3, b: Vec3): number`
  - `lengthHorizontal(a: Vec3): number`
  - `normalizeHorizontal(out: Vec3, a: Vec3): Vec3`

**Por qué un Vec3 propio y no el de Three:** `src/game/**` no puede importar Three, y `THREE.Vector3` asigna en cada operación encadenada. Este tipo es un objeto plano, así que `THREE.Vector3` lo satisface estructuralmente y hay interop gratis en el borde del renderer. Todas las funciones escriben en un `out` que recibe, nunca crean.

El eje **Y es vertical**. "Horizontal" siempre significa el plano XZ.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/math/vec3.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  addScaled, copy, dot, lengthHorizontal, normalizeHorizontal, scale, set, vec3,
} from '@/game/math/vec3'

describe('vec3', () => {
  it('vec3 crea el vector cero por defecto', () => {
    expect(vec3()).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('set escribe en out y lo devuelve', () => {
    const out = vec3()
    const returned = set(out, 1, 2, 3)
    expect(returned).toBe(out)
    expect(out).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('copy no comparte referencia', () => {
    const a = vec3(1, 2, 3)
    const out = vec3()
    copy(out, a)
    set(a, 9, 9, 9)
    expect(out).toEqual({ x: 1, y: 2, z: 3 })
  })

  it('addScaled suma b escalado por s', () => {
    const out = vec3()
    addScaled(out, vec3(1, 1, 1), vec3(2, 0, 4), 0.5)
    expect(out).toEqual({ x: 2, y: 1, z: 3 })
  })

  it('scale multiplica las tres componentes', () => {
    const out = vec3()
    scale(out, vec3(1, -2, 3), 2)
    expect(out).toEqual({ x: 2, y: -4, z: 6 })
  })

  it('dot es el producto punto 3D', () => {
    expect(dot(vec3(1, 2, 3), vec3(4, 5, 6))).toBe(32)
  })

  it('lengthHorizontal ignora Y', () => {
    expect(lengthHorizontal(vec3(3, 100, 4))).toBe(5)
  })

  it('normalizeHorizontal deja Y en cero y largo 1', () => {
    const out = vec3()
    normalizeHorizontal(out, vec3(3, 7, 4))
    expect(out.y).toBe(0)
    expect(lengthHorizontal(out)).toBeCloseTo(1, 10)
  })

  it('normalizeHorizontal de un vector vertical devuelve cero sin NaN', () => {
    const out = vec3()
    normalizeHorizontal(out, vec3(0, 5, 0))
    expect(out).toEqual({ x: 0, y: 0, z: 0 })
  })

  it('las operaciones aceptan out === a sin corromperse', () => {
    const v = vec3(3, 0, 4)
    normalizeHorizontal(v, v)
    expect(lengthHorizontal(v)).toBeCloseTo(1, 10)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test vec3`
Expected: FAIL, `Failed to resolve import "@/game/math/vec3"`

- [ ] **Step 3: Implementar**

Crear `src/game/math/vec3.ts`:

```ts
export type Vec3 = { x: number; y: number; z: number }

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z }
}

export function set(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x
  out.y = y
  out.z = z
  return out
}

export function copy(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x
  out.y = a.y
  out.z = a.z
  return out
}

export function addScaled(out: Vec3, a: Vec3, b: Vec3, s: number): Vec3 {
  out.x = a.x + b.x * s
  out.y = a.y + b.y * s
  out.z = a.z + b.z * s
  return out
}

export function scale(out: Vec3, a: Vec3, s: number): Vec3 {
  out.x = a.x * s
  out.y = a.y * s
  out.z = a.z * s
  return out
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function lengthHorizontal(a: Vec3): number {
  return Math.hypot(a.x, a.z)
}

export function normalizeHorizontal(out: Vec3, a: Vec3): Vec3 {
  const len = Math.hypot(a.x, a.z)
  if (len < 1e-6) return set(out, 0, 0, 0)
  out.x = a.x / len
  out.y = 0
  out.z = a.z / len
  return out
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test vec3`
Expected: PASS, 10 tests

- [ ] **Step 5: Commit**

```bash
committer "feat: Vec3 sin asignaciones para el camino caliente

Objeto plano compatible estructuralmente con THREE.Vector3, con
operaciones que escriben en un out recibido en vez de crear vectores.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/math/vec3.ts src/game/math/vec3.test.ts
```

---

### Task 3: Loop de timestep fijo

**Files:**
- Create: `src/game/engine/fixed-loop.ts`
- Test: `src/game/engine/fixed-loop.test.ts`

**Interfaces:**
- Consumes: `TICK_DT`, `MAX_FRAME_DT` de `@/game/engine/constants`
- Produces: `createFixedLoop(): FixedLoop`, con `FixedLoop = { advance(frameDt: number): number; alpha: number; ticksLastFrame: number }`

`advance` consume el tiempo del frame, ejecuta cero o más ticks de tamaño exacto `TICK_DT`, y devuelve el **alpha de interpolación** (0..1) que indica qué tan lejos está el render entre el penúltimo y el último tick. No recibe un callback para evitar asignar closures; el llamador consulta `ticksLastFrame`.

Diseño deliberado: `advance` devuelve **cuántos ticks correr**, y el llamador los corre en un `for`. Así no hay indirección por función en el camino caliente.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/engine/fixed-loop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { MAX_FRAME_DT, TICK_DT } from '@/game/engine/constants'

describe('loop de timestep fijo', () => {
  it('un frame más corto que un tick no corre ninguno', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 0.5)
    expect(loop.ticksLastFrame).toBe(0)
  })

  it('acumula frames cortos hasta completar un tick', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 0.6)
    loop.advance(TICK_DT * 0.6)
    expect(loop.ticksLastFrame).toBe(1)
  })

  it('un frame de tres ticks corre exactamente tres', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 3)
    expect(loop.ticksLastFrame).toBe(3)
  })

  it('el alpha refleja el resto dentro del tick', () => {
    const loop = createFixedLoop()
    loop.advance(TICK_DT * 1.5)
    expect(loop.alpha).toBeCloseTo(0.5, 6)
  })

  it('el alpha siempre queda en el rango 0..1', () => {
    const loop = createFixedLoop()
    for (const dt of [0.001, 0.033, 0.5, 0.0001, 0.2]) {
      loop.advance(dt)
      expect(loop.alpha).toBeGreaterThanOrEqual(0)
      expect(loop.alpha).toBeLessThanOrEqual(1)
    }
  })

  it('un frame gigante se recorta a MAX_FRAME_DT y no dispara una avalancha', () => {
    const loop = createFixedLoop()
    loop.advance(30)
    expect(loop.ticksLastFrame).toBe(Math.floor(MAX_FRAME_DT / TICK_DT))
  })

  it('no acumula deriva a lo largo de muchos frames', () => {
    const loop = createFixedLoop()
    let ticks = 0
    for (let i = 0; i < 1000; i++) {
      loop.advance(1 / 240)
      ticks += loop.ticksLastFrame
    }
    // 1000 frames a 240Hz son 4.1667s de simulación; a 128Hz eso son ~533 ticks.
    expect(ticks).toBeGreaterThanOrEqual(532)
    expect(ticks).toBeLessThanOrEqual(534)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test fixed-loop`
Expected: FAIL, `Failed to resolve import "@/game/engine/fixed-loop"`

- [ ] **Step 3: Implementar**

Crear `src/game/engine/fixed-loop.ts`:

```ts
import { MAX_FRAME_DT, TICK_DT } from '@/game/engine/constants'

export interface FixedLoop {
  /** Consume el tiempo del frame. Devuelve cuántos ticks debe correr el llamador. */
  advance(frameDt: number): number
  /** Fracción 0..1 entre el penúltimo y el último tick, para interpolar el render. */
  readonly alpha: number
  /** Ticks devueltos por la última llamada a advance. */
  readonly ticksLastFrame: number
}

export function createFixedLoop(): FixedLoop {
  let accumulator = 0
  let alpha = 0
  let ticksLastFrame = 0

  return {
    advance(frameDt: number): number {
      accumulator += Math.min(frameDt, MAX_FRAME_DT)

      let ticks = 0
      while (accumulator >= TICK_DT) {
        accumulator -= TICK_DT
        ticks++
      }

      ticksLastFrame = ticks
      alpha = accumulator / TICK_DT
      return ticks
    },
    get alpha() {
      return alpha
    },
    get ticksLastFrame() {
      return ticksLastFrame
    },
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test fixed-loop`
Expected: PASS, 7 tests

- [ ] **Step 5: Commit**

```bash
committer "feat: loop de timestep fijo a 128Hz con alpha de interpolación

La simulación avanza en pasos exactos e independientes del framerate.
Recorta frames largos para evitar la espiral de la muerte y devuelve el
alpha para que el render interpole entre ticks.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/engine/fixed-loop.ts src/game/engine/fixed-loop.test.ts
```

---

### Task 4: Definición de la arena

**Files:**
- Create: `src/game/map/types.ts`
- Create: `src/game/map/arena.ts`
- Test: `src/game/map/arena.test.ts`

**Interfaces:**
- Consumes: `Vec3` de `@/game/math/vec3`
- Produces:
  - `interface Box { min: Vec3; max: Vec3 }`
  - `interface MapDef { name: string; boxes: Box[]; spawns: Vec3[]; bounds: Box }`
  - `ARENA: MapDef`
  - `box(minX, minY, minZ, maxX, maxY, maxZ): Box`

La arena es una definición declarativa de cajas AABB. Es la única fuente de verdad: de acá salen tanto el mesh visual como la geometría de colisión, así nunca se desincronizan.

Diseño: arena de 3 carriles, 60m × 60m, muros perimetrales de 6m, con cobertura escalonada y dos plataformas elevadas conectadas por rampas. Las alturas de cobertura son 1.0m (se puede mantlear y disparar por encima) y 2.2m (bloquea línea de vista).

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/map/arena.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ARENA, box } from '@/game/map/arena'

describe('arena', () => {
  it('box construye min y max ordenados', () => {
    const b = box(0, 0, 0, 2, 3, 4)
    expect(b.min).toEqual({ x: 0, y: 0, z: 0 })
    expect(b.max).toEqual({ x: 2, y: 3, z: 4 })
  })

  it('toda caja tiene min estrictamente menor que max en los tres ejes', () => {
    for (const b of ARENA.boxes) {
      expect(b.max.x).toBeGreaterThan(b.min.x)
      expect(b.max.y).toBeGreaterThan(b.min.y)
      expect(b.max.z).toBeGreaterThan(b.min.z)
    }
  })

  it('tiene al menos 8 spawns', () => {
    expect(ARENA.spawns.length).toBeGreaterThanOrEqual(8)
  })

  it('todos los spawns caen dentro de los límites del mapa', () => {
    for (const s of ARENA.spawns) {
      expect(s.x).toBeGreaterThan(ARENA.bounds.min.x)
      expect(s.x).toBeLessThan(ARENA.bounds.max.x)
      expect(s.z).toBeGreaterThan(ARENA.bounds.min.z)
      expect(s.z).toBeLessThan(ARENA.bounds.max.z)
    }
  })

  it('ningún spawn queda dentro de una caja sólida', () => {
    for (const s of ARENA.spawns) {
      for (const b of ARENA.boxes) {
        const dentro =
          s.x > b.min.x && s.x < b.max.x &&
          s.y > b.min.y && s.y < b.max.y &&
          s.z > b.min.z && s.z < b.max.z
        expect(dentro).toBe(false)
      }
    }
  })

  it('el conteo de cajas se mantiene bajo el presupuesto de draw calls', () => {
    expect(ARENA.boxes.length).toBeLessThanOrEqual(200)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test arena`
Expected: FAIL, `Failed to resolve import "@/game/map/arena"`

- [ ] **Step 3: Implementar los tipos**

Crear `src/game/map/types.ts`:

```ts
import type { Vec3 } from '@/game/math/vec3'

export interface Box {
  min: Vec3
  max: Vec3
}

export interface MapDef {
  name: string
  /** Geometría sólida. Alimenta tanto la colisión como el mesh visual. */
  boxes: Box[]
  spawns: Vec3[]
  bounds: Box
}
```

- [ ] **Step 4: Implementar la arena**

Crear `src/game/map/arena.ts`:

```ts
import type { Box, MapDef } from '@/game/map/types'
import { vec3 } from '@/game/math/vec3'

export function box(
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): Box {
  return {
    min: vec3(Math.min(minX, maxX), Math.min(minY, maxY), Math.min(minZ, maxZ)),
    max: vec3(Math.max(minX, maxX), Math.max(minY, maxY), Math.max(minZ, maxZ)),
  }
}

const HALF = 30
const WALL_H = 6
const WALL_T = 1

/** Cobertura baja: se mantlea y se dispara por encima. */
const LOW = 1.0
/** Cobertura alta: bloquea línea de vista de pie. */
const HIGH = 2.2

const boxes: Box[] = [
  // Piso
  box(-HALF, -1, -HALF, HALF, 0, HALF),

  // Muros perimetrales
  box(-HALF, 0, -HALF, HALF, WALL_H, -HALF + WALL_T),
  box(-HALF, 0, HALF - WALL_T, HALF, WALL_H, HALF),
  box(-HALF, 0, -HALF, -HALF + WALL_T, WALL_H, HALF),
  box(HALF - WALL_T, 0, -HALF, HALF, WALL_H, HALF),

  // Separadores de los tres carriles, con huecos para rotar
  box(-10, 0, -22, -9, HIGH, -6),
  box(-10, 0, 6, -9, HIGH, 22),
  box(9, 0, -22, 10, HIGH, -6),
  box(9, 0, 6, 10, HIGH, 22),

  // Estructura central: plataforma elevada con rampas a ambos lados
  box(-6, 0, -3, 6, 2.5, 3),
  box(-9, 0, -3, -6, 1.25, 3),
  box(6, 0, -3, 9, 1.25, 3),

  // Cobertura baja del carril izquierdo
  box(-24, 0, -14, -20, LOW, -10),
  box(-24, 0, 10, -20, LOW, 14),
  box(-18, 0, -2, -14, LOW, 2),

  // Cobertura baja del carril derecho (espejada)
  box(20, 0, -14, 24, LOW, -10),
  box(20, 0, 10, 24, LOW, 14),
  box(14, 0, -2, 18, LOW, 2),

  // Cobertura alta cerca de los spawns, para romper líneas de vista largas
  box(-4, 0, -26, 4, HIGH, -24),
  box(-4, 0, 24, 4, HIGH, 26),

  // Cajas mantleables sueltas para encadenar movimiento
  box(-16, 0, -20, -14, LOW, -18),
  box(14, 0, 18, 16, LOW, 20),
  box(-2, 0, 12, 0, LOW, 14),
  box(0, 0, -14, 2, LOW, -12),
]

const spawns = [
  vec3(-25, 0.1, -25), vec3(-25, 0.1, 25),
  vec3(25, 0.1, -25), vec3(25, 0.1, 25),
  vec3(0, 0.1, -27), vec3(0, 0.1, 27),
  vec3(-27, 0.1, 0), vec3(27, 0.1, 0),
]

export const ARENA: MapDef = {
  name: 'arena',
  boxes,
  spawns,
  bounds: box(-HALF, -1, -HALF, HALF, WALL_H, HALF),
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm test arena`
Expected: PASS, 6 tests

Si falla el test de spawns dentro de cajas, mover el spawn ofensor. El test de piso puede dar falso positivo porque los spawns están en `y = 0.1` y el piso llega a `y = 0`: verificar que el spawn quede por encima, no adentro.

- [ ] **Step 6: Commit**

```bash
committer "feat: definición declarativa de la arena de 3 carriles

Una sola fuente de verdad en cajas AABB, de la que salen tanto la
colisión como el mesh visual, para que no se puedan desincronizar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/map/types.ts src/game/map/arena.ts src/game/map/arena.test.ts
```

---

### Task 5: Colisión cápsula contra AABB

**Files:**
- Create: `src/game/physics/capsule.ts`
- Test: `src/game/physics/capsule.test.ts`

**Interfaces:**
- Consumes: `Vec3` de `@/game/math/vec3`, `Box` de `@/game/map/types`
- Produces:
  - `interface Capsule { radius: number; height: number }`
  - `const PLAYER_CAPSULE: Capsule` (radius 0.4, height 1.8)
  - `interface MoveResult { hitGround: boolean; hitCeiling: boolean; hitWall: boolean }`
  - `resolveMove(position: Vec3, delta: Vec3, capsule: Capsule, boxes: Box[], out: MoveResult): void`

`position` es el **punto de los pies** (base de la cápsula). `resolveMove` la mueve in-place aplicando `delta` y resolviendo penetraciones.

**Algoritmo.** Resolución discreta con substeps. El movimiento se parte en pasos que nunca exceden `radius * 0.5`, para que un jugador rápido no atraviese una pared en un tick. En cada substep se mueve la posición y después se resuelve la penetración contra cada caja, empujando por el **eje de menor penetración** (MTV, minimum translation vector). Es el enfoque estándar para mundos de cajas: robusto, barato y determinista, sin la complejidad de un swept continuo.

La normal del empuje determina qué se golpeó: `+Y` es suelo, `-Y` es techo, cualquier otro eje es pared.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/physics/capsule.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { PLAYER_CAPSULE, resolveMove } from '@/game/physics/capsule'
import type { MoveResult } from '@/game/physics/capsule'
import { box } from '@/game/map/arena'
import { vec3 } from '@/game/math/vec3'

const piso = [box(-50, -1, -50, 50, 0, 50)]
const result: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

describe('colisión de cápsula', () => {
  it('el movimiento libre en el aire no altera el delta', () => {
    const pos = vec3(0, 10, 0)
    resolveMove(pos, vec3(1, 0, 2), PLAYER_CAPSULE, piso, result)
    expect(pos.x).toBeCloseTo(1, 6)
    expect(pos.y).toBeCloseTo(10, 6)
    expect(pos.z).toBeCloseTo(2, 6)
    expect(result.hitGround).toBe(false)
  })

  it('caer sobre el piso lo detecta y deja los pies en la superficie', () => {
    const pos = vec3(0, 5, 0)
    resolveMove(pos, vec3(0, -10, 0), PLAYER_CAPSULE, piso, result)
    expect(pos.y).toBeCloseTo(0, 4)
    expect(result.hitGround).toBe(true)
  })

  it('caminar contra una pared frena el eje bloqueado y deja libre el otro', () => {
    const pared = [...piso, box(2, 0, -10, 3, 4, 10)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(5, 0, 1), PLAYER_CAPSULE, pared, result)
    expect(pos.x).toBeLessThan(2)
    expect(pos.z).toBeCloseTo(1, 4)
    expect(result.hitWall).toBe(true)
  })

  it('a alta velocidad no atraviesa una pared delgada (sin tunneling)', () => {
    const pared = [...piso, box(2, 0, -10, 2.2, 4, 10)]
    const pos = vec3(0, 0, 0)
    // 40 m/s en un tick de 128Hz: mucho más rápido que el tope de bhop
    resolveMove(pos, vec3(40 / 128, 0, 0), PLAYER_CAPSULE, pared, result)
    expect(pos.x).toBeLessThan(2)
  })

  it('golpear un techo lo detecta', () => {
    const techo = [...piso, box(-5, 3, -5, 5, 4, 5)]
    const pos = vec3(0, 0, 0)
    resolveMove(pos, vec3(0, 5, 0), PLAYER_CAPSULE, techo, result)
    expect(result.hitCeiling).toBe(true)
    expect(pos.y).toBeLessThan(3)
  })

  it('quedarse quieto sobre el piso no lo hunde ni lo expulsa', () => {
    const pos = vec3(0, 0, 0)
    for (let i = 0; i < 100; i++) {
      resolveMove(pos, vec3(0, 0, 0), PLAYER_CAPSULE, piso, result)
    }
    expect(pos.y).toBeCloseTo(0, 4)
  })

  it('deslizarse por una esquina interior no lo traba', () => {
    const esquina = [...piso, box(2, 0, -10, 3, 4, 0), box(-10, 0, -1, 3, 4, 0)]
    const pos = vec3(0, 0, -3)
    const zAntes = pos.z
    resolveMove(pos, vec3(1, 0, 1), PLAYER_CAPSULE, esquina, result)
    expect(pos.z).toBeGreaterThan(zAntes - 0.01)
    expect(Number.isNaN(pos.x)).toBe(false)
  })

  it('es determinista: la misma entrada da la misma salida', () => {
    const a = vec3(0, 3, 0)
    const b = vec3(0, 3, 0)
    const pared = [...piso, box(1, 0, -5, 2, 4, 5)]
    for (let i = 0; i < 20; i++) {
      resolveMove(a, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, result)
      resolveMove(b, vec3(0.3, -0.2, 0.1), PLAYER_CAPSULE, pared, result)
    }
    expect(a).toEqual(b)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test capsule`
Expected: FAIL, `Failed to resolve import "@/game/physics/capsule"`

- [ ] **Step 3: Implementar**

Crear `src/game/physics/capsule.ts`:

```ts
import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'

export interface Capsule {
  radius: number
  /** Altura total, de los pies a la coronilla. */
  height: number
}

export const PLAYER_CAPSULE: Capsule = { radius: 0.4, height: 1.8 }

export interface MoveResult {
  hitGround: boolean
  hitCeiling: boolean
  hitWall: boolean
}

/** Tolerancia para no re-resolver contactos de apoyo cada tick. */
const SKIN = 1e-4

/**
 * Aproximamos la cápsula por su AABB envolvente. Para un mundo de cajas
 * alineadas a los ejes la diferencia visible es nula, y evita el costo de
 * calcular el punto más cercano del segmento capsular por caja.
 */
function overlapAndResolve(
  position: Vec3,
  capsule: Capsule,
  b: Box,
  out: MoveResult,
): void {
  const minX = position.x - capsule.radius
  const maxX = position.x + capsule.radius
  const minY = position.y
  const maxY = position.y + capsule.height
  const minZ = position.z - capsule.radius
  const maxZ = position.z + capsule.radius

  const overlapX = Math.min(maxX, b.max.x) - Math.max(minX, b.min.x)
  if (overlapX <= SKIN) return
  const overlapY = Math.min(maxY, b.max.y) - Math.max(minY, b.min.y)
  if (overlapY <= SKIN) return
  const overlapZ = Math.min(maxZ, b.max.z) - Math.max(minZ, b.min.z)
  if (overlapZ <= SKIN) return

  // Empujar por el eje de menor penetración.
  if (overlapY <= overlapX && overlapY <= overlapZ) {
    const centroY = position.y + capsule.height * 0.5
    const cajaCentroY = (b.min.y + b.max.y) * 0.5
    if (centroY >= cajaCentroY) {
      position.y += overlapY
      out.hitGround = true
    } else {
      position.y -= overlapY
      out.hitCeiling = true
    }
    return
  }

  if (overlapX <= overlapZ) {
    position.x += position.x >= (b.min.x + b.max.x) * 0.5 ? overlapX : -overlapX
  } else {
    position.z += position.z >= (b.min.z + b.max.z) * 0.5 ? overlapZ : -overlapZ
  }
  out.hitWall = true
}

export function resolveMove(
  position: Vec3,
  delta: Vec3,
  capsule: Capsule,
  boxes: Box[],
  out: MoveResult,
): void {
  out.hitGround = false
  out.hitCeiling = false
  out.hitWall = false

  const distancia = Math.hypot(delta.x, delta.y, delta.z)
  const maxPaso = capsule.radius * 0.5
  const substeps = distancia > maxPaso ? Math.ceil(distancia / maxPaso) : 1
  const inv = 1 / substeps

  const stepX = delta.x * inv
  const stepY = delta.y * inv
  const stepZ = delta.z * inv

  for (let s = 0; s < substeps; s++) {
    position.x += stepX
    position.y += stepY
    position.z += stepZ

    // Dos pasadas: la primera resuelve la penetración dominante, la segunda
    // limpia las que aparecen al haber movido la cápsula en la primera.
    for (let pasada = 0; pasada < 2; pasada++) {
      for (let i = 0; i < boxes.length; i++) {
        overlapAndResolve(position, capsule, boxes[i], out)
      }
    }
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test capsule`
Expected: PASS, 8 tests

Si falla el test de "no lo traba en esquina interior", subir a 3 pasadas. Si falla el de determinismo, hay estado global filtrándose: revisar que no haya scratch compartido mutado fuera de la función.

- [ ] **Step 5: Commit**

```bash
committer "feat: colisión de cápsula contra AABB con substeps

Resolución discreta con substeps limitados a medio radio para evitar
tunneling a alta velocidad, empujando por el eje de menor penetración.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/physics/capsule.ts src/game/physics/capsule.test.ts
```

---

### Task 6: Constantes de tuning del movimiento

**Files:**
- Create: `src/game/movement/tuning.ts`
- Test: `src/game/movement/tuning.test.ts`

**Interfaces:**
- Consumes: nada
- Produces: `MOVEMENT: MovementTuning` (objeto mutable), `type MovementTuning`

**Todo número que afecte el feel vive acá y en ningún otro lado.** El objeto es mutable a propósito: el panel de debug de la Task 14 escribe sobre él en vivo. Ningún otro módulo puede declarar una constante de movimiento.

Los valores salen del spec sección 4. Nota sobre `airWishSpeedCap`: el spec dice "proyección limitada a 30", que es en unidades de Quake, donde la velocidad base es 320 ups. La proporción 30/320 aplicada a una base de 5 m/s da **0.47 m/s**, que redondeamos a 0.5. Ese número chico es exactamente lo que hace que el air-strafe funcione: limita cuánta velocidad podés ganar por tick en la dirección deseada, forzándote a girar el mouse para seguir acelerando.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/tuning.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MOVEMENT } from '@/game/movement/tuning'

describe('tuning del movimiento', () => {
  it('el sprint es más rápido que caminar y caminar más que ADS', () => {
    expect(MOVEMENT.sprintSpeed).toBeGreaterThan(MOVEMENT.walkSpeed)
    expect(MOVEMENT.walkSpeed).toBeGreaterThan(MOVEMENT.adsSpeed)
    expect(MOVEMENT.adsSpeed).toBeGreaterThan(MOVEMENT.crouchSpeed)
  })

  it('el tope de bhop se mide contra el sprint, no contra la caminata', () => {
    expect(MOVEMENT.bhopSoftCap).toBeCloseTo(MOVEMENT.sprintSpeed * 1.8, 6)
    // El punto del bhop: tiene que ser claramente más rápido que correr.
    expect(MOVEMENT.bhopSoftCap).toBeGreaterThan(MOVEMENT.sprintSpeed * 1.5)
  })

  it('el cap de wish speed aéreo es chico, que es lo que hace funcionar el air-strafe', () => {
    expect(MOVEMENT.airWishSpeedCap).toBeLessThan(1)
    expect(MOVEMENT.airWishSpeedCap).toBeGreaterThan(0)
  })

  it('la ventana de skip de fricción es menor que el buffer de salto', () => {
    expect(MOVEMENT.bhopFrictionSkipWindow).toBeLessThan(MOVEMENT.jumpBufferWindow)
  })

  it('la gravedad arcade es más alta que la real', () => {
    expect(MOVEMENT.gravity).toBeGreaterThan(9.81)
  })

  it('el boost de slide acelera y su decay desacelera', () => {
    expect(MOVEMENT.slideBoost).toBeGreaterThan(1)
    expect(MOVEMENT.slideEndSpeedScale).toBeLessThan(1)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test tuning`
Expected: FAIL, `Failed to resolve import "@/game/movement/tuning"`

- [ ] **Step 3: Implementar**

Crear `src/game/movement/tuning.ts`:

```ts
export interface MovementTuning {
  walkSpeed: number
  sprintSpeed: number
  adsSpeed: number
  crouchSpeed: number

  groundAccel: number
  groundFriction: number
  /** Piso de velocidad para el cálculo de fricción: hace que frenar sea firme. */
  stopSpeed: number

  airAccel: number
  /** Cuánta velocidad se puede ganar por tick en la dirección deseada, en el aire. */
  airWishSpeedCap: number

  jumpVelocity: number
  gravity: number
  coyoteTime: number

  jumpBufferWindow: number
  /** Si volvés a saltar dentro de esta ventana tras aterrizar, no se aplica fricción. */
  bhopFrictionSkipWindow: number
  bhopSoftCap: number
  /** Tasa de decaimiento exponencial por encima del tope suave. */
  bhopSoftCapDecay: number

  slideBoost: number
  slideDuration: number
  slideEndSpeedScale: number
  slideFriction: number
  /** Velocidad horizontal mínima para poder entrar en slide. */
  slideMinSpeed: number

  mantleMaxHeight: number
  mantleMinSpeed: number

  eyeHeight: number
  crouchEyeHeight: number
}

const walkSpeed = 5.0
const sprintSpeed = 8.0

export const MOVEMENT: MovementTuning = {
  walkSpeed,
  sprintSpeed,
  adsSpeed: 3.5,
  crouchSpeed: 3.0,

  groundAccel: 60,
  groundFriction: 8.0,
  stopSpeed: 1.5,

  airAccel: 100,
  airWishSpeedCap: 0.5,

  jumpVelocity: 6.5,
  gravity: 22,
  coyoteTime: 0.1,

  jumpBufferWindow: 0.12,
  bhopFrictionSkipWindow: 0.08,
  bhopSoftCap: sprintSpeed * 1.8,
  // Derivado, no elegido a ojo. Strafeando perfecto se gana
  // airAccel * dt * airWishSpeedCap = 100 * (1/128) * 0.5 = 0.39 m/s por tick.
  // El equilibrio del decay exponencial es gain / (1 - exp(-decay * dt)).
  // Con decay 3 el equilibrio queda en +16.8 m/s sobre el tope (31 m/s reales),
  // o sea el tope no toparía nada. Con 12 queda en +4.4, que sostiene ~18.8 m/s:
  // el bhop premia, pero no se descontrola.
  bhopSoftCapDecay: 12.0,

  slideBoost: 1.35,
  slideDuration: 0.7,
  slideEndSpeedScale: 0.6,
  slideFriction: 1.2,
  slideMinSpeed: 4.0,

  mantleMaxHeight: 1.2,
  mantleMinSpeed: 1.0,

  eyeHeight: 1.65,
  crouchEyeHeight: 1.0,
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test tuning`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
committer "feat: constantes de tuning del movimiento en un solo lugar

Todo número que afecte el feel vive acá, mutable, para que el panel de
debug lo escriba en vivo sin recompilar.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/tuning.ts src/game/movement/tuning.test.ts
```

---

### Task 7: Aceleración y fricción estilo Quake

**Files:**
- Create: `src/game/movement/accelerate.ts`
- Test: `src/game/movement/accelerate.test.ts`

**Interfaces:**
- Consumes: `Vec3`, `dot`, `lengthHorizontal` de `@/game/math/vec3`
- Produces:
  - `accelerate(velocity: Vec3, wishDir: Vec3, wishSpeed: number, accel: number, dt: number): void`
  - `applyFriction(velocity: Vec3, friction: number, stopSpeed: number, dt: number): void`

Estas dos funciones son el corazón del feel. `accelerate` sólo agrega velocidad **en la dirección deseada, y sólo hasta `wishSpeed` proyectado sobre esa dirección**. Esa proyección es lo que hace posible el air-strafe: si te movés a 15 m/s hacia adelante y apuntás 90° a un costado, tu velocidad proyectada sobre la nueva dirección es casi cero, así que podés seguir acelerando aunque ya vayas rapidísimo.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/accelerate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { accelerate, applyFriction } from '@/game/movement/accelerate'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'

describe('accelerate', () => {
  it('acelera desde el reposo en la dirección deseada', () => {
    const v = vec3(0, 0, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeGreaterThan(0)
    expect(v.z).toBe(0)
  })

  it('no supera la wishSpeed acelerando en línea recta', () => {
    const v = vec3(0, 0, 0)
    for (let i = 0; i < 1000; i++) accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeCloseTo(5, 3)
  })

  it('no agrega velocidad si ya vas más rápido que wishSpeed en esa dirección', () => {
    const v = vec3(10, 0, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.x).toBeCloseTo(10, 6)
  })

  it('sí acelera perpendicular aunque vayas rapidísimo: la base del air-strafe', () => {
    const v = vec3(15, 0, 0)
    const antes = lengthHorizontal(v)
    accelerate(v, vec3(0, 0, 1), 0.5, 100, 1 / 128)
    expect(v.z).toBeGreaterThan(0)
    expect(lengthHorizontal(v)).toBeGreaterThan(antes)
  })

  it('no toca la componente vertical', () => {
    const v = vec3(0, -9, 0)
    accelerate(v, vec3(1, 0, 0), 5, 60, 1 / 128)
    expect(v.y).toBe(-9)
  })
})

describe('applyFriction', () => {
  it('reduce la velocidad horizontal', () => {
    const v = vec3(5, 0, 0)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x).toBeLessThan(5)
    expect(v.x).toBeGreaterThan(0)
  })

  it('frena a cero y no cruza a negativo', () => {
    const v = vec3(5, 0, 0)
    for (let i = 0; i < 1000; i++) applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x).toBe(0)
    expect(v.z).toBe(0)
  })

  it('no toca la componente vertical', () => {
    const v = vec3(5, -9, 0)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.y).toBe(-9)
  })

  it('preserva la dirección mientras frena', () => {
    const v = vec3(3, 0, 4)
    applyFriction(v, 8, 1.5, 1 / 128)
    expect(v.x / v.z).toBeCloseTo(3 / 4, 6)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test accelerate`
Expected: FAIL, `Failed to resolve import "@/game/movement/accelerate"`

- [ ] **Step 3: Implementar**

Crear `src/game/movement/accelerate.ts`:

```ts
import type { Vec3 } from '@/game/math/vec3'

/**
 * Aceleración estilo Quake. Sólo agrega velocidad en `wishDir`, y sólo hasta
 * que la proyección de la velocidad actual sobre `wishDir` alcance `wishSpeed`.
 *
 * Esa proyección es la razón de que exista el air-strafe: si vas rápido hacia
 * adelante y mirás a un costado, la proyección sobre la nueva dirección es
 * casi cero, así que todavía te queda margen para acelerar.
 */
export function accelerate(
  velocity: Vec3,
  wishDir: Vec3,
  wishSpeed: number,
  accel: number,
  dt: number,
): void {
  const currentSpeed = velocity.x * wishDir.x + velocity.z * wishDir.z
  const addSpeed = wishSpeed - currentSpeed
  if (addSpeed <= 0) return

  let accelSpeed = accel * dt * wishSpeed
  if (accelSpeed > addSpeed) accelSpeed = addSpeed

  velocity.x += wishDir.x * accelSpeed
  velocity.z += wishDir.z * accelSpeed
}

/**
 * Fricción en el plano horizontal. `stopSpeed` actúa como piso del cálculo:
 * por debajo de esa velocidad el frenado es proporcionalmente más fuerte, lo
 * que hace que detenerse se sienta firme en vez de resbaloso.
 */
export function applyFriction(
  velocity: Vec3,
  friction: number,
  stopSpeed: number,
  dt: number,
): void {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed < 1e-4) {
    velocity.x = 0
    velocity.z = 0
    return
  }

  const control = speed < stopSpeed ? stopSpeed : speed
  const drop = control * friction * dt
  const newSpeed = speed - drop

  if (newSpeed <= 0) {
    velocity.x = 0
    velocity.z = 0
    return
  }

  const scale = newSpeed / speed
  velocity.x *= scale
  velocity.z *= scale
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test accelerate`
Expected: PASS, 9 tests

- [ ] **Step 5: Commit**

```bash
committer "feat: aceleración y fricción estilo Quake

La proyección de la velocidad sobre la dirección deseada es lo que
habilita el air-strafe y, con él, el bunny hop.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/accelerate.ts src/game/movement/accelerate.test.ts
```

---

### Task 8: Estado del jugador y movimiento en suelo y aire

**Files:**
- Create: `src/game/movement/state.ts`
- Create: `src/game/movement/step.ts`
- Test: `src/game/movement/step.test.ts`

**Interfaces:**
- Consumes: `MOVEMENT`, `accelerate`, `applyFriction`, `resolveMove`, `PLAYER_CAPSULE`, `Vec3`
- Produces:
  - `interface PlayerInput { forward: number; right: number; yaw: number; jump: boolean; sprint: boolean; crouch: boolean }`
  - `interface PlayerState { position: Vec3; velocity: Vec3; prevPosition: Vec3; grounded: boolean; timeSinceGrounded: number; timeSinceLanded: number; timeSinceJumpPressed: number; jumpWasPressed: boolean; sliding: boolean; slideTime: number; eyeHeight: number }`
  - `createPlayerState(spawn: Vec3): PlayerState`
  - `stepPlayer(state: PlayerState, input: PlayerInput, boxes: Box[], dt: number): void`

Esta tarea cubre suelo, aire, salto, gravedad y coyote time. Bhop, slide y mantle llegan en las tareas 9, 10 y 11 modificando `step.ts`.

`prevPosition` se guarda al inicio de cada tick para que el render interpole.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/step.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

const piso = [box(-50, -1, -50, 50, 0, 50)]

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ...over }
}

function simular(state: ReturnType<typeof createPlayerState>, inp: PlayerInput, ticks: number) {
  for (let i = 0; i < ticks; i++) stepPlayer(state, inp, piso, TICK_DT)
}

describe('paso del jugador', () => {
  it('arranca en el suelo tras un tick de asentamiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    expect(s.grounded).toBe(true)
  })

  it('sin input se queda quieto', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 60)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(0, 3)
  })

  it('caminar hacia adelante alcanza la velocidad de caminata', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1 }), 128)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(MOVEMENT.walkSpeed, 1)
  })

  it('sprint alcanza la velocidad de sprint', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, sprint: true }), 128)
    expect(lengthHorizontal(s.velocity)).toBeCloseTo(MOVEMENT.sprintSpeed, 1)
  })

  it('el yaw rota la dirección de movimiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, yaw: Math.PI / 2 }), 128)
    expect(Math.abs(s.velocity.x)).toBeGreaterThan(Math.abs(s.velocity.z))
  })

  it('el salto despega del suelo', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    expect(s.velocity.y).toBeGreaterThan(0)
    expect(s.grounded).toBe(false)
  })

  it('la gravedad lo devuelve al suelo', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input(), 5)
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    simular(s, input(), 256)
    expect(s.grounded).toBe(true)
    expect(s.position.y).toBeCloseTo(0, 2)
  })

  it('el coyote time permite saltar poco después de dejar una repisa', () => {
    const repisa = [box(-50, -1, -50, 50, 0, 0)]
    const s = createPlayerState(vec3(0, 0, -1))
    for (let i = 0; i < 5; i++) stepPlayer(s, input(), repisa, TICK_DT)
    // Caminar más allá del borde
    for (let i = 0; i < 40; i++) stepPlayer(s, input({ forward: -1, sprint: true }), repisa, TICK_DT)
    expect(s.grounded).toBe(false)
    expect(s.timeSinceGrounded).toBeLessThan(MOVEMENT.coyoteTime)
    stepPlayer(s, input({ jump: true }), repisa, TICK_DT)
    expect(s.velocity.y).toBeGreaterThan(0)
  })

  it('no se puede saltar en el aire pasado el coyote time', () => {
    const s = createPlayerState(vec3(0, 5, 0))
    simular(s, input(), 30)
    const yAntes = s.velocity.y
    stepPlayer(s, input({ jump: true }), piso, TICK_DT)
    expect(s.velocity.y).toBeLessThan(yAntes + 0.01)
  })

  it('prevPosition queda un tick atrás para interpolar', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    simular(s, input({ forward: 1, sprint: true }), 60)
    expect(s.prevPosition.z).not.toBeCloseTo(s.position.z, 6)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test step`
Expected: FAIL, `Failed to resolve import "@/game/movement/step"`

- [ ] **Step 3: Implementar el estado**

Crear `src/game/movement/state.ts`:

```ts
import type { Vec3 } from '@/game/math/vec3'

export interface PlayerInput {
  /** -1 atrás, 1 adelante. */
  forward: number
  /** -1 izquierda, 1 derecha. */
  right: number
  /** Rotación horizontal de la cámara, en radianes. */
  yaw: number
  /** Estado sostenido, no flanco. El auto-hop depende de que sea sostenido. */
  jump: boolean
  sprint: boolean
  crouch: boolean
}

export interface PlayerState {
  position: Vec3
  velocity: Vec3
  /** Posición al inicio del tick anterior. El render interpola entre ésta y position. */
  prevPosition: Vec3

  grounded: boolean
  /** Segundos desde que dejó de estar en el suelo. Habilita el coyote time. */
  timeSinceGrounded: number
  /** Segundos desde que aterrizó. Habilita el skip de fricción del bhop. */
  timeSinceLanded: number
  /** Segundos desde que se presionó saltar. Habilita el jump buffering. */
  timeSinceJumpPressed: number
  jumpWasPressed: boolean

  sliding: boolean
  slideTime: number

  eyeHeight: number
}
```

- [ ] **Step 4: Implementar el paso**

Crear `src/game/movement/step.ts`:

```ts
import { TICK_DT } from '@/game/engine/constants'
import type { Box } from '@/game/map/types'
import { copy, vec3, type Vec3 } from '@/game/math/vec3'
import { accelerate, applyFriction } from '@/game/movement/accelerate'
import type { PlayerInput, PlayerState } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE, resolveMove, type MoveResult } from '@/game/physics/capsule'

const scratchWishDir: Vec3 = vec3()
const scratchDelta: Vec3 = vec3()
const scratchResult: MoveResult = { hitGround: false, hitCeiling: false, hitWall: false }

export function createPlayerState(spawn: Vec3): PlayerState {
  return {
    position: vec3(spawn.x, spawn.y, spawn.z),
    velocity: vec3(),
    prevPosition: vec3(spawn.x, spawn.y, spawn.z),
    grounded: false,
    timeSinceGrounded: Infinity,
    timeSinceLanded: Infinity,
    timeSinceJumpPressed: Infinity,
    jumpWasPressed: false,
    sliding: false,
    slideTime: 0,
    eyeHeight: MOVEMENT.eyeHeight,
  }
}

function computeWishDir(out: Vec3, input: PlayerInput): void {
  const sin = Math.sin(input.yaw)
  const cos = Math.cos(input.yaw)

  // La cámara mira hacia -Z con yaw 0, que es la convención de Three.
  // Adelante = (-sin, 0, -cos). Derecha = (cos, 0, -sin).
  const x = input.right * cos - input.forward * sin
  const z = -input.forward * cos - input.right * sin

  const len = Math.hypot(x, z)
  if (len < 1e-6) {
    out.x = 0
    out.z = 0
  } else {
    out.x = x / len
    out.z = z / len
  }
  out.y = 0
}

function targetSpeed(input: PlayerInput): number {
  if (input.crouch) return MOVEMENT.crouchSpeed
  if (input.sprint) return MOVEMENT.sprintSpeed
  return MOVEMENT.walkSpeed
}

export function stepPlayer(
  state: PlayerState,
  input: PlayerInput,
  boxes: Box[],
  dt: number = TICK_DT,
): void {
  copy(state.prevPosition, state.position)

  // Temporizadores de input
  if (input.jump && !state.jumpWasPressed) state.timeSinceJumpPressed = 0
  else state.timeSinceJumpPressed += dt
  state.jumpWasPressed = input.jump

  computeWishDir(scratchWishDir, input)
  const wishSpeed = targetSpeed(input)

  if (state.grounded) {
    applyFriction(state.velocity, MOVEMENT.groundFriction, MOVEMENT.stopSpeed, dt)
    accelerate(state.velocity, scratchWishDir, wishSpeed, MOVEMENT.groundAccel, dt)
  } else {
    accelerate(
      state.velocity,
      scratchWishDir,
      MOVEMENT.airWishSpeedCap,
      MOVEMENT.airAccel,
      dt,
    )
  }

  // Salto, con coyote time y auto-hop.
  //
  // `quiereSaltar` es una disyunción a propósito. Si sólo mirara el buffer,
  // mantener espacio apretado dejaría de saltar a los 120ms: el flanco de
  // subida ocurre una sola vez y timeSinceJumpPressed crece para siempre.
  // Eso mataría el auto-hop, que es la base del bhop. `input.jump` sostenido
  // significa "quiero saltar ahora"; el buffer cubre el caso de apretar y
  // soltar justo antes de aterrizar.
  const puedeSaltar = state.grounded || state.timeSinceGrounded <= MOVEMENT.coyoteTime
  const quiereSaltar = input.jump || state.timeSinceJumpPressed <= MOVEMENT.jumpBufferWindow

  if (puedeSaltar && quiereSaltar) {
    state.velocity.y = MOVEMENT.jumpVelocity
    state.grounded = false
    state.timeSinceGrounded = MOVEMENT.coyoteTime + 1
    state.timeSinceJumpPressed = Infinity
  }

  state.velocity.y -= MOVEMENT.gravity * dt

  scratchDelta.x = state.velocity.x * dt
  scratchDelta.y = state.velocity.y * dt
  scratchDelta.z = state.velocity.z * dt

  resolveMove(state.position, scratchDelta, PLAYER_CAPSULE, boxes, scratchResult)

  const estabaEnSuelo = state.grounded
  state.grounded = scratchResult.hitGround

  if (state.grounded) {
    if (state.velocity.y < 0) state.velocity.y = 0
    state.timeSinceGrounded = 0
    if (!estabaEnSuelo) state.timeSinceLanded = 0
    else state.timeSinceLanded += dt
  } else {
    state.timeSinceGrounded += dt
    state.timeSinceLanded += dt
  }

  if (scratchResult.hitCeiling && state.velocity.y > 0) state.velocity.y = 0

  state.eyeHeight = input.crouch ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm test step`
Expected: PASS, 10 tests

- [ ] **Step 6: Commit**

```bash
committer "feat: estado del jugador con movimiento en suelo y aire

Caminar, sprint, salto con jump buffering y coyote time, gravedad
arcade y resolución de colisión. prevPosition guardado por tick para
que el render interpole.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/state.ts src/game/movement/step.ts src/game/movement/step.test.ts
```

---

### Task 9: Bunny hop

**Files:**
- Modify: `src/game/movement/step.ts`
- Create: `src/game/movement/bhop.ts`
- Test: `src/game/movement/bhop.test.ts`

**Interfaces:**
- Consumes: `MOVEMENT`, `Vec3`
- Produces: `shouldSkipFriction(state: PlayerState, input: PlayerInput): boolean`, `applySoftCap(velocity: Vec3, cap: number, decay: number, dt: number): void`

Tres piezas hacen el bhop:

1. **Auto-hop:** con `jump` sostenido, saltás en el frame exacto en que tocás el suelo. Ya funciona por el jump buffering de la Task 8.
2. **Skip de fricción:** si vas a saltar de nuevo dentro de `bhopFrictionSkipWindow` de haber aterrizado, no se aplica fricción ese tick. Sin esto, un solo frame de fricción a 8.0 te come la velocidad ganada.
3. **Tope suave:** por encima de `bhopSoftCap` el exceso decae exponencialmente en vez de cortarse. Cortar duro se siente como chocar un muro invisible.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/bhop.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applySoftCap } from '@/game/movement/bhop'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

const piso = [box(-500, -1, -500, 500, 0, 500)]

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ...over }
}

describe('tope suave', () => {
  it('no toca velocidades por debajo del tope', () => {
    const v = vec3(5, 0, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeCloseTo(5, 6)
  })

  it('decae el exceso por encima del tope sin cortarlo de golpe', () => {
    const v = vec3(20, 0, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeLessThan(20)
    expect(v.x).toBeGreaterThan(14.4)
  })

  it('converge hacia el tope tras sostenerlo', () => {
    const v = vec3(30, 0, 0)
    for (let i = 0; i < 1000; i++) applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.x).toBeCloseTo(14.4, 1)
  })

  it('no toca la vertical', () => {
    const v = vec3(30, -9, 0)
    applySoftCap(v, 14.4, 3, TICK_DT)
    expect(v.y).toBe(-9)
  })
})

describe('bunny hop', () => {
  it('con salto sostenido rebota sin tocar el suelo más de un tick seguido', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    let ticksEnSuelo = 0
    for (let i = 0; i < 512; i++) {
      stepPlayer(s, input({ jump: true, forward: 1, sprint: true }), piso, TICK_DT)
      if (s.grounded) ticksEnSuelo++
    }
    // Rebotando, se pasa la enorme mayoría del tiempo en el aire.
    expect(ticksEnSuelo).toBeLessThan(120)
  })

  it('el air-strafe gana velocidad por encima del sprint', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    // Encadenar saltos girando el yaw mientras strafea, que es la técnica real.
    let yaw = 0
    for (let i = 0; i < 1500; i++) {
      yaw += 0.012
      stepPlayer(s, input({ jump: true, right: 1, yaw, sprint: true }), piso, TICK_DT)
    }
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(MOVEMENT.sprintSpeed)
  })

  it('la velocidad nunca supera el tope suave de forma sostenida', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 10; i++) stepPlayer(s, input(), piso, TICK_DT)

    let yaw = 0
    let maxVista = 0
    for (let i = 0; i < 5000; i++) {
      yaw += 0.012
      stepPlayer(s, input({ jump: true, right: 1, yaw, sprint: true }), piso, TICK_DT)
      maxVista = Math.max(maxVista, lengthHorizontal(s.velocity))
    }
    // El tope es suave, así que se permite un margen por encima, no infinito.
    // El equilibrio calculado es ~18.8 m/s con decay 12; 1.5x da 21.6 de holgura.
    expect(maxVista).toBeLessThan(MOVEMENT.bhopSoftCap * 1.5)
  })

  it('sin saltar, la fricción frena hasta la velocidad de caminata', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    s.velocity.x = 20
    for (let i = 0; i < 256; i++) stepPlayer(s, input(), piso, TICK_DT)
    expect(lengthHorizontal(s.velocity)).toBeLessThan(MOVEMENT.walkSpeed)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test bhop`
Expected: FAIL, `Failed to resolve import "@/game/movement/bhop"`

- [ ] **Step 3: Implementar el helper**

Crear `src/game/movement/bhop.ts`:

```ts
import type { Vec3 } from '@/game/math/vec3'
import type { PlayerInput, PlayerState } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'

/**
 * Con `jump` sostenido y un aterrizaje muy reciente, se omite la fricción de
 * ese tick. Sin esto, un único frame de fricción a 8.0 borra la velocidad que
 * costó varios saltos acumular, y el bhop no se siente como recompensa.
 */
export function shouldSkipFriction(state: PlayerState, input: PlayerInput): boolean {
  return input.jump && state.timeSinceLanded <= MOVEMENT.bhopFrictionSkipWindow
}

/**
 * Decaimiento exponencial del exceso por encima del tope, en vez de un corte
 * duro. Un corte se siente como chocar un muro invisible; el decay se siente
 * como resistencia del aire.
 */
export function applySoftCap(velocity: Vec3, cap: number, decay: number, dt: number): void {
  const speed = Math.hypot(velocity.x, velocity.z)
  if (speed <= cap) return

  const exceso = speed - cap
  const nuevoExceso = exceso * Math.exp(-decay * dt)
  const scale = (cap + nuevoExceso) / speed

  velocity.x *= scale
  velocity.z *= scale
}
```

- [ ] **Step 4: Conectarlo al paso**

En `src/game/movement/step.ts`, agregar el import:

```ts
import { applySoftCap, shouldSkipFriction } from '@/game/movement/bhop'
```

Reemplazar el bloque de suelo y aire por:

```ts
  if (state.grounded) {
    if (!shouldSkipFriction(state, input)) {
      applyFriction(state.velocity, MOVEMENT.groundFriction, MOVEMENT.stopSpeed, dt)
    }
    accelerate(state.velocity, scratchWishDir, wishSpeed, MOVEMENT.groundAccel, dt)
  } else {
    accelerate(
      state.velocity,
      scratchWishDir,
      MOVEMENT.airWishSpeedCap,
      MOVEMENT.airAccel,
      dt,
    )
    applySoftCap(state.velocity, MOVEMENT.bhopSoftCap, MOVEMENT.bhopSoftCapDecay, dt)
  }
```

- [ ] **Step 5: Correr toda la suite y verificar que pasa**

Run: `pnpm test`
Expected: PASS, incluidos los 8 tests nuevos de bhop y todos los anteriores sin romperse.

Si el test de air-strafe no gana velocidad, el incremento de yaw por tick es el sospechoso: a 128Hz, 0.012 rad/tick son ~88°/s, que está en la banda correcta. Si sigue fallando, verificar que `computeWishDir` normalice y que `airWishSpeedCap` sea 0.5 y no 5.

- [ ] **Step 6: Commit**

```bash
committer "feat: bunny hop con auto-hop, skip de fricción y tope suave

Saltar sostenido rebota en el frame de aterrizaje, se omite la fricción
dentro de la ventana de 80ms, y el exceso sobre 14.4 m/s decae
exponencialmente en vez de cortarse en seco.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/bhop.ts src/game/movement/bhop.test.ts src/game/movement/step.ts
```

---

### Task 10: Slide y slide-cancel

**Files:**
- Modify: `src/game/movement/step.ts`
- Test: `src/game/movement/slide.test.ts`

**Interfaces:**
- Consumes: `MOVEMENT`, `PlayerState`, `PlayerInput`
- Produces: comportamiento de slide dentro de `stepPlayer`. Sin API nueva; se observa vía `state.sliding` y `state.slideTime`.

Reglas:
- **Entrada:** agachar estando en el suelo con velocidad horizontal ≥ `slideMinSpeed`. Multiplica la velocidad por `slideBoost`.
- **Durante:** fricción reducida (`slideFriction` en vez de `groundFriction`), altura de ojos baja, sin aceleración de caminata (no podés acelerar deslizando).
- **Fin natural:** pasado `slideDuration`, o si la velocidad baja de `walkSpeed * slideEndSpeedScale`.
- **Cancel:** saltar durante el slide lo corta **conservando la velocidad**. Eso es lo que permite encadenar slide → salto → air-strafe → slide.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/slide.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { lengthHorizontal, vec3 } from '@/game/math/vec3'
import { TICK_DT } from '@/game/engine/constants'

const piso = [box(-500, -1, -500, 500, 0, 500)]

function input(over: Partial<PlayerInput> = {}): PlayerInput {
  return { forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false, ...over }
}

function correrHastaSprint(s: ReturnType<typeof createPlayerState>) {
  for (let i = 0; i < 200; i++) {
    stepPlayer(s, input({ forward: 1, sprint: true }), piso, TICK_DT)
  }
}

describe('slide', () => {
  it('agacharse corriendo entra en slide y da un boost de velocidad', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    const antes = lengthHorizontal(s.velocity)

    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)

    expect(s.sliding).toBe(true)
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(antes)
  })

  it('no entra en slide si vas muy lento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    for (let i = 0; i < 20; i++) stepPlayer(s, input(), piso, TICK_DT)
    stepPlayer(s, input({ crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(false)
  })

  it('el slide baja la altura de los ojos', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    expect(s.eyeHeight).toBeCloseTo(MOVEMENT.crouchEyeHeight, 6)
  })

  it('el slide termina solo pasada su duración', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    const ticks = Math.ceil(MOVEMENT.slideDuration / TICK_DT) + 10
    for (let i = 0; i < ticks; i++) {
      stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    }
    expect(s.sliding).toBe(false)
  })

  it('el slide-cancel conserva la velocidad, que es lo que permite encadenar', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    const velEnSlide = lengthHorizontal(s.velocity)

    stepPlayer(s, input({ forward: 1, crouch: true, jump: true }), piso, TICK_DT)

    expect(s.sliding).toBe(false)
    expect(s.velocity.y).toBeGreaterThan(0)
    expect(lengthHorizontal(s.velocity)).toBeGreaterThan(velEnSlide * 0.9)
  })

  it('deslizando no se puede acelerar con las teclas de movimiento', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    const alEntrar = lengthHorizontal(s.velocity)

    for (let i = 0; i < 20; i++) {
      stepPlayer(s, input({ forward: 1, sprint: true, crouch: true }), piso, TICK_DT)
    }
    expect(lengthHorizontal(s.velocity)).toBeLessThan(alEntrar)
  })

  it('soltar agacharse termina el slide', () => {
    const s = createPlayerState(vec3(0, 0, 0))
    correrHastaSprint(s)
    stepPlayer(s, input({ forward: 1, crouch: true }), piso, TICK_DT)
    expect(s.sliding).toBe(true)
    stepPlayer(s, input({ forward: 1 }), piso, TICK_DT)
    expect(s.sliding).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test slide`
Expected: FAIL, varios tests fallan porque `state.sliding` nunca se pone en `true`.

- [ ] **Step 3: Implementar en step.ts**

En `src/game/movement/step.ts`, insertar este bloque **inmediatamente después** de `computeWishDir(...)` y `const wishSpeed = targetSpeed(input)`, y **antes** del bloque `if (state.grounded)`:

```ts
  // Transiciones de slide
  const velHorizontal = Math.hypot(state.velocity.x, state.velocity.z)

  if (state.sliding) {
    state.slideTime += dt
    const expiro = state.slideTime >= MOVEMENT.slideDuration
    const muyLento = velHorizontal < MOVEMENT.walkSpeed * MOVEMENT.slideEndSpeedScale
    if (expiro || muyLento || !input.crouch) {
      state.sliding = false
      state.slideTime = 0
    }
  } else if (input.crouch && state.grounded && velHorizontal >= MOVEMENT.slideMinSpeed) {
    state.sliding = true
    state.slideTime = 0
    state.velocity.x *= MOVEMENT.slideBoost
    state.velocity.z *= MOVEMENT.slideBoost
  }
```

Reemplazar el bloque de suelo por uno que respete el slide:

```ts
  if (state.grounded) {
    if (state.sliding) {
      // Fricción reducida y sin aceleración: deslizando no se acelera.
      applyFriction(state.velocity, MOVEMENT.slideFriction, MOVEMENT.stopSpeed, dt)
    } else {
      if (!shouldSkipFriction(state, input)) {
        applyFriction(state.velocity, MOVEMENT.groundFriction, MOVEMENT.stopSpeed, dt)
      }
      accelerate(state.velocity, scratchWishDir, wishSpeed, MOVEMENT.groundAccel, dt)
    }
  } else {
```

En el bloque de salto, cancelar el slide conservando la velocidad. Reemplazar por:

```ts
  if (puedeSaltar && quiereSaltar) {
    state.velocity.y = MOVEMENT.jumpVelocity
    state.grounded = false
    state.timeSinceGrounded = MOVEMENT.coyoteTime + 1
    state.timeSinceJumpPressed = Infinity
    // El slide-cancel no toca la velocidad horizontal: encadenar es el punto.
    state.sliding = false
    state.slideTime = 0
  }
```

Finalmente, la altura de ojos considera el slide. Reemplazar la última línea por:

```ts
  state.eyeHeight =
    input.crouch || state.sliding ? MOVEMENT.crouchEyeHeight : MOVEMENT.eyeHeight
```

- [ ] **Step 4: Correr toda la suite y verificar que pasa**

Run: `pnpm test`
Expected: PASS, incluidos los 7 tests nuevos de slide y todos los anteriores.

- [ ] **Step 5: Commit**

```bash
committer "feat: slide con boost de entrada y cancel que conserva velocidad

Agacharse corriendo da un boost de 1.35x con fricción reducida. Saltar
lo corta sin perder velocidad horizontal, que es lo que permite
encadenar slide, salto, air-strafe y volver a slide.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/step.ts src/game/movement/slide.test.ts
```

---

### Task 11: Mantle

**Files:**
- Create: `src/game/movement/mantle.ts`
- Modify: `src/game/movement/step.ts`
- Test: `src/game/movement/mantle.test.ts`

**Interfaces:**
- Consumes: `Box`, `Vec3`, `MOVEMENT`, `PLAYER_CAPSULE`
- Produces: `tryMantle(position: Vec3, velocity: Vec3, wishDir: Vec3, boxes: Box[]): boolean`

Regla: estando en el aire, moviéndote hacia una pared, si el tope de esa pared está a `mantleMaxHeight` o menos por encima de tus pies y hay espacio libre encima para la cápsula, subís automáticamente. Es lo que hace que las cajas de 1.0m de la arena sean parte del flujo de movimiento y no obstáculos.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/movement/mantle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { tryMantle } from '@/game/movement/mantle'
import { MOVEMENT } from '@/game/movement/tuning'
import { box } from '@/game/map/arena'
import { vec3 } from '@/game/math/vec3'

const piso = box(-50, -1, -50, 50, 0, 50)

describe('mantle', () => {
  it('sube a una caja baja cuando te movés contra ella', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, caja])
    expect(ok).toBe(true)
    expect(pos.y).toBeCloseTo(1.0, 2)
  })

  it('no sube a una pared más alta que el límite', () => {
    const pared = box(1, 0, -2, 3, 4, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, pared])
    expect(ok).toBe(false)
    expect(pos.y).toBeCloseTo(0, 6)
  })

  it('no sube si te movés en dirección contraria', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(-2, 0, 0), vec3(-1, 0, 0), [piso, caja])
    expect(ok).toBe(false)
  })

  it('no sube si no hay espacio libre arriba', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const techo = box(1, 1.2, -2, 3, 5, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(2, 0, 0), vec3(1, 0, 0), [piso, caja, techo])
    expect(ok).toBe(false)
  })

  it('no sube si vas demasiado lento', () => {
    const caja = box(1, 0, -2, 3, 1.0, 2)
    const pos = vec3(0.5, 0, 0)
    const ok = tryMantle(pos, vec3(0.1, 0, 0), vec3(1, 0, 0), [piso, caja])
    expect(ok).toBe(false)
  })

  it('respeta exactamente el límite de altura del tuning', () => {
    const justo = box(1, 0, -2, 3, MOVEMENT.mantleMaxHeight - 0.01, 2)
    const pasado = box(1, 0, -2, 3, MOVEMENT.mantleMaxHeight + 0.5, 2)
    const a = vec3(0.5, 0, 0)
    const b = vec3(0.5, 0, 0)
    expect(tryMantle(a, vec3(2, 0, 0), vec3(1, 0, 0), [piso, justo])).toBe(true)
    expect(tryMantle(b, vec3(2, 0, 0), vec3(1, 0, 0), [piso, pasado])).toBe(false)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test mantle`
Expected: FAIL, `Failed to resolve import "@/game/movement/mantle"`

- [ ] **Step 3: Implementar**

Crear `src/game/movement/mantle.ts`:

```ts
import type { Box } from '@/game/map/types'
import type { Vec3 } from '@/game/math/vec3'
import { MOVEMENT } from '@/game/movement/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'

/** Cuánto por delante de los pies se sondea la repisa. */
const PROBE_DISTANCE = 0.6
/** Holgura vertical requerida por encima de la repisa. */
const HEAD_CLEARANCE = 0.05

function contienePunto(b: Box, x: number, y: number, z: number): boolean {
  return (
    x > b.min.x && x < b.max.x &&
    y > b.min.y && y < b.max.y &&
    z > b.min.z && z < b.max.z
  )
}

function espacioLibre(boxes: Box[], x: number, y: number, z: number, r: number, h: number): boolean {
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (
      x + r > b.min.x && x - r < b.max.x &&
      y + h > b.min.y && y < b.max.y &&
      z + r > b.min.z && z - r < b.max.z
    ) {
      return false
    }
  }
  return true
}

/**
 * Sube automáticamente a repisas bajas cuando el jugador se mueve contra ellas.
 * Es lo que convierte las cajas de 1m de la arena en parte del flujo de
 * movimiento en vez de obstáculos que cortan el ritmo.
 *
 * Devuelve true y modifica `position` si el mantle procede.
 */
export function tryMantle(
  position: Vec3,
  velocity: Vec3,
  wishDir: Vec3,
  boxes: Box[],
): boolean {
  const velHorizontal = Math.hypot(velocity.x, velocity.z)
  if (velHorizontal < MOVEMENT.mantleMinSpeed) return false

  const dirLen = Math.hypot(wishDir.x, wishDir.z)
  if (dirLen < 1e-6) return false

  // Debe moverse en la dirección deseada, no contra ella.
  if ((velocity.x * wishDir.x + velocity.z * wishDir.z) <= 0) return false

  const probeX = position.x + (wishDir.x / dirLen) * PROBE_DISTANCE
  const probeZ = position.z + (wishDir.z / dirLen) * PROBE_DISTANCE

  let mejorTope = -Infinity
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const alturaRepisa = b.max.y - position.y
    if (alturaRepisa <= 0 || alturaRepisa > MOVEMENT.mantleMaxHeight) continue

    // El punto de sondeo debe caer sobre la cara superior de esta caja.
    if (probeX <= b.min.x || probeX >= b.max.x) continue
    if (probeZ <= b.min.z || probeZ >= b.max.z) continue
    if (!contienePunto(b, probeX, b.max.y - 0.01, probeZ)) continue

    if (b.max.y > mejorTope) mejorTope = b.max.y
  }

  if (mejorTope === -Infinity) return false

  const destinoY = mejorTope + HEAD_CLEARANCE
  if (!espacioLibre(boxes, probeX, destinoY, probeZ, PLAYER_CAPSULE.radius, PLAYER_CAPSULE.height)) {
    return false
  }

  position.x = probeX
  position.y = destinoY
  position.z = probeZ
  return true
}
```

- [ ] **Step 4: Conectarlo al paso**

En `src/game/movement/step.ts`, agregar el import:

```ts
import { tryMantle } from '@/game/movement/mantle'
```

Después de la llamada a `resolveMove` y **antes** del bloque que actualiza `state.grounded`, insertar:

```ts
  // Mantle: sólo si chocamos una pared en el aire yendo hacia ella.
  if (!scratchResult.hitGround && scratchResult.hitWall) {
    if (tryMantle(state.position, state.velocity, scratchWishDir, boxes)) {
      if (state.velocity.y < 0) state.velocity.y = 0
    }
  }
```

- [ ] **Step 5: Correr toda la suite y verificar que pasa**

Run: `pnpm test`
Expected: PASS, incluidos los 6 de mantle y todos los anteriores.

- [ ] **Step 6: Commit**

```bash
committer "feat: mantle automático sobre repisas bajas

Subir a cajas de hasta 1.2m yendo contra ellas en el aire, con
verificación de espacio libre arriba. Convierte la cobertura baja en
parte del flujo de movimiento.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/movement/mantle.ts src/game/movement/mantle.test.ts src/game/movement/step.ts
```

---

### Task 12: Input con pointer lock

**Files:**
- Create: `src/game/engine/input.ts`
- Test: `src/game/engine/input.test.ts`

**Interfaces:**
- Consumes: `PlayerInput` de `@/game/movement/state`
- Produces:
  - `interface InputSystem { readonly player: PlayerInput; pitch: number; attach(canvas: HTMLCanvasElement): void; detach(): void; readonly locked: boolean }`
  - `createInputSystem(getSensitivity: () => number): InputSystem`

El objeto `player` es **el mismo objeto en cada frame**, mutado en lugar de recreado, para no asignar. `yaw` y `pitch` se acumulan desde `movementX/Y` del pointer lock. `pitch` se clampea a ±(π/2 − ε) para que no se dé vuelta la cámara.

Este módulo toca el DOM, así que el test cubre sólo la lógica pura de acumulación de mirada, extraída a funciones exportadas.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/engine/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { applyLook, clampPitch, PITCH_LIMIT } from '@/game/engine/input'

describe('acumulación de mirada', () => {
  it('clampPitch limita mirar hacia arriba', () => {
    expect(clampPitch(10)).toBeCloseTo(PITCH_LIMIT, 6)
  })

  it('clampPitch limita mirar hacia abajo', () => {
    expect(clampPitch(-10)).toBeCloseTo(-PITCH_LIMIT, 6)
  })

  it('clampPitch nunca deja dar la vuelta completa', () => {
    expect(Math.abs(clampPitch(100))).toBeLessThan(Math.PI / 2)
  })

  it('applyLook acumula yaw negativo al mover el mouse a la derecha', () => {
    const r = applyLook(0, 0, 100, 0, 0.002)
    expect(r.yaw).toBeCloseTo(-0.2, 6)
  })

  it('applyLook invierte el pitch para que mover el mouse arriba mire arriba', () => {
    const r = applyLook(0, 0, 0, -100, 0.002)
    expect(r.pitch).toBeGreaterThan(0)
  })

  it('applyLook respeta la sensibilidad', () => {
    const lento = applyLook(0, 0, 100, 0, 0.001)
    const rapido = applyLook(0, 0, 100, 0, 0.004)
    expect(Math.abs(rapido.yaw)).toBeGreaterThan(Math.abs(lento.yaw))
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test input`
Expected: FAIL, `Failed to resolve import "@/game/engine/input"`

- [ ] **Step 3: Implementar**

Crear `src/game/engine/input.ts`:

```ts
import type { PlayerInput } from '@/game/movement/state'

export const PITCH_LIMIT = Math.PI / 2 - 0.01

export function clampPitch(pitch: number): number {
  if (pitch > PITCH_LIMIT) return PITCH_LIMIT
  if (pitch < -PITCH_LIMIT) return -PITCH_LIMIT
  return pitch
}

/** Reusado por applyLook para no asignar en el camino caliente. */
const lookResult = { yaw: 0, pitch: 0 }

export function applyLook(
  yaw: number,
  pitch: number,
  movementX: number,
  movementY: number,
  sensitivity: number,
): { yaw: number; pitch: number } {
  lookResult.yaw = yaw - movementX * sensitivity
  lookResult.pitch = clampPitch(pitch - movementY * sensitivity)
  return lookResult
}

export interface InputSystem {
  readonly player: PlayerInput
  pitch: number
  readonly locked: boolean
  attach(canvas: HTMLCanvasElement): void
  detach(): void
}

export function createInputSystem(getSensitivity: () => number): InputSystem {
  const player: PlayerInput = {
    forward: 0, right: 0, yaw: 0, jump: false, sprint: false, crouch: false,
  }

  let pitch = 0
  let locked = false
  let canvas: HTMLCanvasElement | null = null

  const keys = new Set<string>()

  function updateAxes(): void {
    player.forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0)
    player.right = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0)
    player.jump = keys.has('Space')
    player.sprint = keys.has('ShiftLeft') || keys.has('ShiftRight')
    player.crouch = keys.has('ControlLeft') || keys.has('KeyC')
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Space') e.preventDefault()
    keys.add(e.code)
    updateAxes()
  }

  function onKeyUp(e: KeyboardEvent): void {
    keys.delete(e.code)
    updateAxes()
  }

  function onMouseMove(e: MouseEvent): void {
    if (!locked) return
    const r = applyLook(player.yaw, pitch, e.movementX, e.movementY, getSensitivity())
    player.yaw = r.yaw
    pitch = r.pitch
  }

  function onPointerLockChange(): void {
    locked = document.pointerLockElement === canvas
    if (!locked) {
      keys.clear()
      updateAxes()
    }
  }

  function onClick(): void {
    canvas?.requestPointerLock()
  }

  return {
    player,
    get pitch() { return pitch },
    set pitch(v: number) { pitch = clampPitch(v) },
    get locked() { return locked },

    attach(target: HTMLCanvasElement): void {
      canvas = target
      target.addEventListener('click', onClick)
      document.addEventListener('pointerlockchange', onPointerLockChange)
      document.addEventListener('mousemove', onMouseMove)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
    },

    detach(): void {
      canvas?.removeEventListener('click', onClick)
      document.removeEventListener('pointerlockchange', onPointerLockChange)
      document.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas = null
      keys.clear()
    },
  }
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test input`
Expected: PASS, 6 tests

- [ ] **Step 5: Commit**

```bash
committer "feat: sistema de input con pointer lock

WASD, salto, sprint y agacharse por código de tecla física, con mirada
acumulada desde pointer lock. El objeto de input se muta en vez de
recrearse para no asignar por frame.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/engine/input.ts src/game/engine/input.test.ts
```

---

### Task 13: Renderer, mesh de la arena y cámara interpolada

**Files:**
- Create: `src/game/map/mesh.ts`
- Create: `src/game/engine/renderer.ts`
- Create: `src/game/game.ts`
- Create: `src/app/play/page.tsx`
- Create: `src/ui/GameCanvas.tsx`
- Test: `src/game/map/mesh.test.ts`

**Interfaces:**
- Consumes: `ARENA`, `createFixedLoop`, `createInputSystem`, `createPlayerState`, `stepPlayer`, `MOVEMENT`
- Produces:
  - `buildArenaGeometry(map: MapDef): BufferGeometry` (una sola geometría fusionada)
  - `createRenderer(canvas: HTMLCanvasElement): GameRenderer`
  - `createGame(canvas: HTMLCanvasElement): { start(): void; stop(): void; readonly stats: FrameStats }`

**Regla de draw calls:** las 24 cajas de la arena se fusionan en **una** `BufferGeometry` con un solo material. Eso da 1 draw call para todo el mapa. La cámara es el único otro objeto en escena en la fase 0.

Cada caja recibe un color de vértice según su altura (piso, cobertura baja, cobertura alta, muro), lo que da legibilidad espacial sin texturas, sin luces y sin shadow maps. Material: `MeshBasicMaterial` con `vertexColors: true`.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/map/mesh.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildArenaGeometry } from '@/game/map/mesh'
import { ARENA } from '@/game/map/arena'

describe('geometría de la arena', () => {
  it('fusiona todas las cajas en una sola geometría', () => {
    const geo = buildArenaGeometry(ARENA)
    const posiciones = geo.getAttribute('position')
    // 6 caras por caja, 2 triángulos por cara, 3 vértices por triángulo
    expect(posiciones.count).toBe(ARENA.boxes.length * 36)
  })

  it('incluye colores de vértice para legibilidad sin luces', () => {
    const geo = buildArenaGeometry(ARENA)
    expect(geo.getAttribute('color')).toBeDefined()
    expect(geo.getAttribute('color').count).toBe(geo.getAttribute('position').count)
  })

  it('se mantiene bajo el presupuesto de triángulos', () => {
    const geo = buildArenaGeometry(ARENA)
    const triangulos = geo.getAttribute('position').count / 3
    expect(triangulos).toBeLessThan(150_000)
  })

  it('incluye normales para el sombreado', () => {
    const geo = buildArenaGeometry(ARENA)
    expect(geo.getAttribute('normal')).toBeDefined()
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test mesh`
Expected: FAIL, `Failed to resolve import "@/game/map/mesh"`

- [ ] **Step 3: Implementar el mesh**

Crear `src/game/map/mesh.ts`:

```ts
import { BoxGeometry, BufferAttribute, BufferGeometry, Color, Matrix4 } from 'three'
import type { Box, MapDef } from '@/game/map/types'

const COLOR_PISO = new Color(0x2a2f3a)
const COLOR_COBERTURA_BAJA = new Color(0x4a5568)
const COLOR_COBERTURA_ALTA = new Color(0x39414f)
const COLOR_MURO = new Color(0x1e222b)

function colorPara(b: Box): Color {
  const altura = b.max.y - b.min.y
  if (b.max.y <= 0.01) return COLOR_PISO
  if (altura >= 5) return COLOR_MURO
  if (altura >= 2) return COLOR_COBERTURA_ALTA
  return COLOR_COBERTURA_BAJA
}

/**
 * Fusiona todas las cajas del mapa en una única geometría no indexada.
 * Un mapa entero en 1 draw call, sin luces ni shadow maps: la legibilidad
 * espacial la dan los colores de vértice por tipo de superficie.
 */
export function buildArenaGeometry(map: MapDef): BufferGeometry {
  const totalVertices = map.boxes.length * 36
  const positions = new Float32Array(totalVertices * 3)
  const normals = new Float32Array(totalVertices * 3)
  const colors = new Float32Array(totalVertices * 3)

  const matrix = new Matrix4()
  let offset = 0

  for (const b of map.boxes) {
    const sx = b.max.x - b.min.x
    const sy = b.max.y - b.min.y
    const sz = b.max.z - b.min.z

    const geo = new BoxGeometry(sx, sy, sz).toNonIndexed()
    matrix.makeTranslation(
      (b.min.x + b.max.x) * 0.5,
      (b.min.y + b.max.y) * 0.5,
      (b.min.z + b.max.z) * 0.5,
    )
    geo.applyMatrix4(matrix)

    const p = geo.getAttribute('position').array as Float32Array
    const n = geo.getAttribute('normal').array as Float32Array
    positions.set(p, offset * 3)
    normals.set(n, offset * 3)

    const c = colorPara(b)
    for (let i = 0; i < 36; i++) {
      colors[(offset + i) * 3] = c.r
      colors[(offset + i) * 3 + 1] = c.g
      colors[(offset + i) * 3 + 2] = c.b
    }

    offset += 36
    geo.dispose()
  }

  const merged = new BufferGeometry()
  merged.setAttribute('position', new BufferAttribute(positions, 3))
  merged.setAttribute('normal', new BufferAttribute(normals, 3))
  merged.setAttribute('color', new BufferAttribute(colors, 3))
  return merged
}
```

- [ ] **Step 4: Correr el test del mesh y verificar que pasa**

Run: `pnpm test mesh`
Expected: PASS, 4 tests

- [ ] **Step 5: Implementar el renderer**

Crear `src/game/engine/renderer.ts`:

```ts
import { Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, WebGLRenderer } from 'three'
import { ARENA } from '@/game/map/arena'
import { buildArenaGeometry } from '@/game/map/mesh'

export interface GameRenderer {
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  render(): void
  resize(width: number, height: number): void
  dispose(): void
}

export function createRenderer(canvas: HTMLCanvasElement): GameRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
    // El buffer de stencil no se usa y cuesta ancho de banda.
    stencil: false,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))

  const scene = new Scene()
  const camera = new PerspectiveCamera(90, 1, 0.1, 200)

  const geometry = buildArenaGeometry(ARENA)
  const material = new MeshBasicMaterial({ vertexColors: true })
  const arena = new Mesh(geometry, material)
  // La arena nunca se mueve: saltear el recálculo de matrices por frame.
  arena.matrixAutoUpdate = false
  arena.updateMatrix()
  scene.add(arena)

  return {
    camera,
    renderer,
    render(): void {
      renderer.render(scene, camera)
    },
    resize(width: number, height: number): void {
      camera.aspect = width / height
      camera.updateProjectionMatrix()
      renderer.setSize(width, height, false)
    },
    dispose(): void {
      geometry.dispose()
      material.dispose()
      renderer.dispose()
    },
  }
}
```

- [ ] **Step 6: Implementar el ensamblado del juego**

Crear `src/game/game.ts`:

```ts
import { createFixedLoop } from '@/game/engine/fixed-loop'
import { createInputSystem } from '@/game/engine/input'
import { createRenderer } from '@/game/engine/renderer'
import { ARENA } from '@/game/map/arena'
import { createPlayerState, stepPlayer } from '@/game/movement/step'

export interface Game {
  start(): void
  stop(): void
}

const SENSITIVITY = 0.0022

export function createGame(canvas: HTMLCanvasElement): Game {
  const gfx = createRenderer(canvas)
  const input = createInputSystem(() => SENSITIVITY)
  const loop = createFixedLoop()
  const player = createPlayerState(ARENA.spawns[0])

  let running = false
  let lastTime = 0
  let rafId = 0

  function onResize(): void {
    gfx.resize(canvas.clientWidth, canvas.clientHeight)
  }

  function frame(now: number): void {
    if (!running) return
    rafId = requestAnimationFrame(frame)

    const frameDt = lastTime === 0 ? 0 : (now - lastTime) / 1000
    lastTime = now

    const ticks = loop.advance(frameDt)
    for (let i = 0; i < ticks; i++) {
      stepPlayer(player, input.player, ARENA.boxes)
    }

    // Interpolar la posición de la cámara entre el tick anterior y el actual.
    const a = loop.alpha
    gfx.camera.position.x = player.prevPosition.x + (player.position.x - player.prevPosition.x) * a
    gfx.camera.position.y =
      player.prevPosition.y + (player.position.y - player.prevPosition.y) * a + player.eyeHeight
    gfx.camera.position.z = player.prevPosition.z + (player.position.z - player.prevPosition.z) * a

    gfx.camera.rotation.set(input.pitch, input.player.yaw, 0, 'YXZ')

    gfx.render()
  }

  return {
    start(): void {
      if (running) return
      running = true
      lastTime = 0
      input.attach(canvas)
      window.addEventListener('resize', onResize)
      onResize()
      rafId = requestAnimationFrame(frame)
    },
    stop(): void {
      running = false
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', onResize)
      input.detach()
      gfx.dispose()
    },
  }
}
```

- [ ] **Step 7: Implementar el componente y la ruta**

Crear `src/ui/GameCanvas.tsx`:

```tsx
'use client'

import { useEffect, useRef } from 'react'
import { createGame } from '@/game/game'

export function GameCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const game = createGame(canvas)
    game.start()
    return () => game.stop()
  }, [])

  return <canvas ref={ref} className="block h-screen w-screen cursor-crosshair" />
}
```

Crear `src/app/play/page.tsx`:

```tsx
import { GameCanvas } from '@/ui/GameCanvas'

export default function PlayPage() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black">
      <GameCanvas />
    </main>
  )
}
```

- [ ] **Step 8: Verificar a mano en el navegador**

Run: `pnpm dev`

Abrir `http://localhost:3000/play`. Hacer clic en el canvas para tomar el pointer lock. Verificar:

1. La arena se ve, con el piso y las cajas en tonos distintos.
2. WASD mueve, el mouse mira, Shift corre.
3. Espacio salta y la gravedad devuelve al suelo.
4. Mantener espacio corriendo y girar el mouse mientras se strafea gana velocidad (bhop).
5. Ctrl corriendo desliza; saltar durante el slide conserva la velocidad.
6. Correr contra una caja baja saltando sube encima (mantle).
7. No se atraviesan las paredes.

Si algo de esto falla, el problema es de integración, no de lógica: la lógica ya está cubierta por tests. Revisar primero el mapeo de teclas y la convención de signo del yaw.

- [ ] **Step 9: Commit**

```bash
committer "feat: renderer, arena en un draw call y cámara interpolada

La arena entera se fusiona en una BufferGeometry con colores de vértice,
sin luces ni shadow maps. La cámara interpola entre ticks con el alpha
del loop fijo, así el render va libre y la simulación determinista.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/map/mesh.ts src/game/map/mesh.test.ts src/game/engine/renderer.ts \
  src/game/game.ts src/ui/GameCanvas.tsx src/app/play/page.tsx
```

---

### Task 14: HUD de rendimiento y modo benchmark

**Files:**
- Create: `src/game/engine/stats.ts`
- Modify: `src/game/game.ts`
- Test: `src/game/engine/stats.test.ts`

**Interfaces:**
- Consumes: `FRAME_BUDGET_MS`
- Produces:
  - `interface FrameStats { cpuMs: number; gpuMs: number; drawCalls: number; triangles: number; fps: number; overBudget: boolean }`
  - `createStatsTracker(): StatsTracker` con `beginFrame()`, `endFrame(drawCalls, triangles)`, `readonly stats: FrameStats`, `mount(parent: HTMLElement)`, `unmount()`
  - `runBenchmark(render: () => void, passes: number): number` (ms promedio por pasada)

Notas de implementación:

- El HUD se actualiza por **DOM imperativo** (`textContent` sobre nodos preexistentes), nunca por React. Y sólo **4 veces por segundo**: actualizar texto a 240Hz cuesta más que el juego.
- `cpuMs` se mide con `performance.now()` alrededor del trabajo del frame.
- `drawCalls` y `triangles` salen de `renderer.info.render.calls` y `renderer.info.render.triangles`.
- **`gpuMs` requiere verificación.** La extensión es `EXT_disjoint_timer_query_webgl2` sobre `renderer.getContext()`. Three.js también expone un API de timestamps propio en versiones recientes. **Antes de implementar, verificar cuál está disponible en la versión instalada** con `pnpm list three` y consultando la doc de esa versión. Si ninguna está, dejar `gpuMs` en `-1` y mostrar `GPU: n/d` en el HUD; el presupuesto se evalúa por CPU hasta que se resuelva. **No inventar un API.**
- El modo benchmark mide throughput crudo corriendo N pasadas de render seguidas dentro de un frame, sin esperar al vsync. Es lo que da el número de "FPS del motor" independiente de los 240Hz del monitor.

- [ ] **Step 1: Escribir el test que falla**

Crear `src/game/engine/stats.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
import { FRAME_BUDGET_MS } from '@/game/engine/constants'

describe('tracker de estadísticas', () => {
  it('arranca en cero', () => {
    const t = createStatsTracker()
    expect(t.stats.cpuMs).toBe(0)
    expect(t.stats.drawCalls).toBe(0)
  })

  it('registra draw calls y triángulos del frame', () => {
    const t = createStatsTracker()
    t.beginFrame()
    t.endFrame(12, 4000)
    expect(t.stats.drawCalls).toBe(12)
    expect(t.stats.triangles).toBe(4000)
  })

  it('mide tiempo de CPU no negativo', () => {
    const t = createStatsTracker()
    t.beginFrame()
    let x = 0
    for (let i = 0; i < 100_000; i++) x += i
    t.endFrame(1, 1)
    expect(t.stats.cpuMs).toBeGreaterThanOrEqual(0)
    expect(x).toBeGreaterThan(0)
  })

  it('marca overBudget cuando el frame supera el presupuesto', () => {
    const t = createStatsTracker()
    t.beginFrame()
    const fin = performance.now() + FRAME_BUDGET_MS + 2
    while (performance.now() < fin) { /* quemar tiempo a propósito */ }
    t.endFrame(1, 1)
    expect(t.stats.overBudget).toBe(true)
  })

  it('runBenchmark corre exactamente las pasadas pedidas', () => {
    let n = 0
    runBenchmark(() => { n++ }, 50)
    expect(n).toBe(50)
  })

  it('runBenchmark devuelve un promedio por pasada no negativo', () => {
    const ms = runBenchmark(() => { /* trabajo nulo */ }, 100)
    expect(ms).toBeGreaterThanOrEqual(0)
    expect(Number.isFinite(ms)).toBe(true)
  })
})
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm test stats`
Expected: FAIL, `Failed to resolve import "@/game/engine/stats"`

- [ ] **Step 3: Implementar**

Crear `src/game/engine/stats.ts`:

```ts
import { FRAME_BUDGET_MS } from '@/game/engine/constants'

export interface FrameStats {
  cpuMs: number
  /** -1 si la extensión de timing de GPU no está disponible. */
  gpuMs: number
  drawCalls: number
  triangles: number
  fps: number
  overBudget: boolean
}

export interface StatsTracker {
  readonly stats: FrameStats
  beginFrame(): void
  endFrame(drawCalls: number, triangles: number): void
  mount(parent: HTMLElement): void
  unmount(): void
}

/** El HUD se refresca 4 veces por segundo: escribir texto a 240Hz cuesta más que el juego. */
const HUD_INTERVAL_MS = 250

export function createStatsTracker(): StatsTracker {
  const stats: FrameStats = {
    cpuMs: 0, gpuMs: -1, drawCalls: 0, triangles: 0, fps: 0, overBudget: false,
  }

  let frameStart = 0
  let lastHudUpdate = 0
  let framesSinceHud = 0
  let hud: HTMLDivElement | null = null

  return {
    stats,

    beginFrame(): void {
      frameStart = performance.now()
    },

    endFrame(drawCalls: number, triangles: number): void {
      const now = performance.now()
      stats.cpuMs = now - frameStart
      stats.drawCalls = drawCalls
      stats.triangles = triangles
      stats.overBudget = stats.cpuMs > FRAME_BUDGET_MS

      framesSinceHud++
      const desdeHud = now - lastHudUpdate
      if (desdeHud >= HUD_INTERVAL_MS) {
        stats.fps = (framesSinceHud * 1000) / desdeHud
        framesSinceHud = 0
        lastHudUpdate = now

        if (hud) {
          const gpu = stats.gpuMs < 0 ? 'n/d' : `${stats.gpuMs.toFixed(2)}ms`
          hud.textContent =
            `${stats.fps.toFixed(0)} fps  |  cpu ${stats.cpuMs.toFixed(2)}ms  |  ` +
            `gpu ${gpu}  |  ${stats.drawCalls} draws  |  ` +
            `${(stats.triangles / 1000).toFixed(1)}k tris  |  ` +
            `presupuesto ${FRAME_BUDGET_MS}ms`
          hud.style.color = stats.overBudget ? '#ff5f5f' : '#5fff9f'
        }
      }
    },

    mount(parent: HTMLElement): void {
      hud = document.createElement('div')
      hud.style.cssText =
        'position:absolute;top:8px;left:8px;font:12px ui-monospace,monospace;' +
        'color:#5fff9f;background:rgba(0,0,0,.6);padding:6px 10px;' +
        'border-radius:4px;pointer-events:none;z-index:10;white-space:nowrap'
      parent.appendChild(hud)
    },

    unmount(): void {
      hud?.remove()
      hud = null
    },
  }
}

/**
 * Mide throughput crudo del motor corriendo N pasadas de render seguidas sin
 * esperar al vsync. Es el número de "FPS del motor" independiente de los Hz
 * del monitor: en un panel de 240Hz nunca se dibujan más de 240 frames, pero
 * esto revela cuánto margen real queda.
 *
 * Devuelve el promedio de milisegundos por pasada.
 */
export function runBenchmark(render: () => void, passes: number): number {
  const inicio = performance.now()
  for (let i = 0; i < passes; i++) render()
  return (performance.now() - inicio) / passes
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm test stats`
Expected: PASS, 6 tests

- [ ] **Step 5: Conectarlo al juego**

En `src/game/game.ts`, agregar el import:

```ts
import { createStatsTracker, runBenchmark } from '@/game/engine/stats'
```

Dentro de `createGame`, después de crear `gfx`:

```ts
  const stats = createStatsTracker()
```

En `frame`, envolver el trabajo. Poner `stats.beginFrame()` justo después de `rafId = requestAnimationFrame(frame)`, y reemplazar la línea `gfx.render()` por:

```ts
    gfx.renderer.info.reset()
    gfx.render()
    stats.endFrame(gfx.renderer.info.render.calls, gfx.renderer.info.render.triangles)
```

En `start()`, después de `input.attach(canvas)`:

```ts
      if (canvas.parentElement) stats.mount(canvas.parentElement)
```

En `stop()`, antes de `gfx.dispose()`:

```ts
      stats.unmount()
```

Exponer el benchmark en la interfaz `Game`. Agregar a la interfaz:

```ts
export interface Game {
  start(): void
  stop(): void
  /** Mide ms promedio por pasada de render, sin esperar al vsync. */
  benchmark(passes?: number): number
  readonly stats: FrameStats
}
```

Y al objeto devuelto:

```ts
    benchmark(passes = 500): number {
      return runBenchmark(() => gfx.render(), passes)
    },
    get stats() {
      return stats.stats
    },
```

Agregar el import del tipo: `import type { FrameStats } from '@/game/engine/stats'`.

- [ ] **Step 6: Investigar el timing de GPU**

Run: `pnpm list three`

Con la versión exacta, buscar en la doc de Three de esa versión si expone un API de timestamps de GPU. Si existe, usarlo para llenar `stats.gpuMs`. Si no, implementar `EXT_disjoint_timer_query_webgl2` a mano sobre `gfx.renderer.getContext()`.

Si ninguna vía funciona en menos de 30 minutos, dejar `gpuMs` en `-1` y seguir: el HUD ya muestra `n/d` y el presupuesto se evalúa por CPU. **No inventar nombres de API.** Anotar el resultado de esta investigación en el commit.

- [ ] **Step 7: Verificar el presupuesto a mano**

Run: `pnpm dev`, abrir `/play`.

Verificar en el HUD:
- `draws` debe ser **1 o 2** (la arena fusionada).
- `tris` debe estar muy por debajo de 150k.
- `cpu` debe estar bien por debajo de 2.5ms en escena vacía.
- El contador de fps debe fijarse en 240 en el escritorio y 120 en la Mac.

Después, en la consola del navegador, medir throughput crudo. Exponer temporalmente el juego en `window` desde `GameCanvas.tsx` si hace falta, y correr el benchmark. Anotar el número: **ese es el "FPS del motor" real**, y es el que se compara contra el objetivo de 2.5ms.

**Criterio de salida de la fase 0: `cpuMs` por debajo de 2.5ms con la escena de arena vacía.** Si no se cumple, se para y se optimiza antes de la fase 1.

- [ ] **Step 8: Commit**

```bash
committer "feat: HUD de rendimiento y modo benchmark

HUD por DOM imperativo refrescado 4 veces por segundo, con cpu, draw
calls, triángulos y estado del presupuesto. El benchmark corre pasadas
de render sin esperar al vsync para medir throughput real del motor,
independiente de los Hz del monitor.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/engine/stats.ts src/game/engine/stats.test.ts src/game/game.ts
```

---

### Task 15: Panel de tuning en vivo y test de asignaciones

**Files:**
- Create: `src/game/engine/tuning-panel.ts`
- Create: `src/game/movement/allocations.test.ts`
- Create: `src/game/architecture.test.ts`
- Modify: `src/game/game.ts`

**Interfaces:**
- Consumes: `MOVEMENT`, `MovementTuning`
- Produces: `createTuningPanel(): { mount(parent: HTMLElement): void; unmount(): void; toggle(): void }`

Dos entregas en una tarea porque ambas son verificación del trabajo previo, no funcionalidad nueva.

**El panel** escribe directo sobre el objeto `MOVEMENT`. Sin recompilar, sin recargar. Es la única forma de tunear el feel: hay que sentirlo mientras se mueve el número, no adivinar y esperar un build. Se abre con la tecla `` ` ``.

**El test de asignaciones** protege la restricción global de cero asignaciones por frame. Corre miles de ticks y verifica que el heap no crezca de forma sostenida. Es intrínsecamente ruidoso, así que el umbral es generoso: detecta una fuga real (un `new` por tick), no ruido del GC.

**El test de arquitectura** verifica que `src/game/**` no importe React, Next ni Three, salvo las dos excepciones permitidas.

- [ ] **Step 1: Escribir el test de asignaciones**

Crear `src/game/movement/allocations.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createPlayerState, stepPlayer } from '@/game/movement/step'
import type { PlayerInput } from '@/game/movement/state'
import { ARENA } from '@/game/map/arena'
import { TICK_DT } from '@/game/engine/constants'
import { vec3 } from '@/game/math/vec3'

const input: PlayerInput = {
  forward: 1, right: 1, yaw: 0.4, jump: true, sprint: true, crouch: false,
}

describe('presupuesto de asignaciones', () => {
  it('stepPlayer no hace crecer el heap de forma sostenida', () => {
    const s = createPlayerState(vec3(0, 1, 0))

    // Calentar: dejar que el JIT optimice y que se asiente el estado inicial.
    for (let i = 0; i < 20_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    global.gc?.()
    const antes = process.memoryUsage().heapUsed

    for (let i = 0; i < 100_000; i++) {
      input.yaw += 0.01
      stepPlayer(s, input, ARENA.boxes, TICK_DT)
    }

    global.gc?.()
    const despues = process.memoryUsage().heapUsed
    const crecimientoMB = (despues - antes) / 1024 / 1024

    // Un solo objeto por tick serían decenas de MB en 100k ticks.
    // 4MB de margen absorbe el ruido del GC sin dejar pasar una fuga real.
    expect(crecimientoMB).toBeLessThan(4)
  })
})
```

- [ ] **Step 2: Escribir el test de arquitectura**

Crear `src/game/architecture.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GAME_DIR = join(process.cwd(), 'src/game')

/** Únicos archivos de src/game autorizados a importar Three. */
const PUEDEN_USAR_THREE = ['engine/renderer.ts', 'map/mesh.ts']

function archivosTs(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = base ? `${base}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...archivosTs(full, rel))
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(rel)
  }
  return out
}

describe('límites de arquitectura', () => {
  const archivos = archivosTs(GAME_DIR)

  it('encuentra archivos para revisar', () => {
    expect(archivos.length).toBeGreaterThan(5)
  })

  it('src/game nunca importa React ni Next', () => {
    for (const f of archivos) {
      const src = readFileSync(join(GAME_DIR, f), 'utf8')
      expect(src, `${f} importa react`).not.toMatch(/from\s+['"]react['"]/)
      expect(src, `${f} importa next`).not.toMatch(/from\s+['"]next[/'"]/)
    }
  })

  it('sólo el renderer y el mesh importan Three', () => {
    for (const f of archivos) {
      const src = readFileSync(join(GAME_DIR, f), 'utf8')
      const importaThree = /from\s+['"]three['"]/.test(src)
      if (importaThree) {
        expect(PUEDEN_USAR_THREE, `${f} no está autorizado a importar three`).toContain(f)
      }
    }
  })
})
```

- [ ] **Step 3: Correr ambos tests**

Run: `pnpm test allocations architecture`
Expected: PASS. `game.ts` importa Three sólo de forma indirecta vía el renderer, así que no debería aparecer en el test. Si aparece, es una señal legítima de que el ensamblado se filtró: mover ese uso adentro de `renderer.ts`.

Si el test de asignaciones falla, el sospechoso es un `new` en el camino caliente. Revisar `resolveMove`, `computeWishDir` y `applyLook`.

Para que `global.gc()` esté disponible y el test sea más estable:

```bash
pnpm vitest run --pool=forks --poolOptions.forks.execArgv=--expose-gc
```

El test pasa igual sin `--expose-gc`, sólo con más ruido.

- [ ] **Step 4: Implementar el panel de tuning**

Crear `src/game/engine/tuning-panel.ts`:

```ts
import { MOVEMENT, type MovementTuning } from '@/game/movement/tuning'

interface Campo {
  key: keyof MovementTuning
  label: string
  min: number
  max: number
  step: number
}

const CAMPOS: Campo[] = [
  { key: 'walkSpeed', label: 'caminar', min: 1, max: 12, step: 0.1 },
  { key: 'sprintSpeed', label: 'sprint', min: 1, max: 20, step: 0.1 },
  { key: 'groundAccel', label: 'accel suelo', min: 5, max: 200, step: 1 },
  { key: 'groundFriction', label: 'fricción', min: 0, max: 20, step: 0.1 },
  { key: 'airAccel', label: 'accel aire', min: 0, max: 300, step: 1 },
  { key: 'airWishSpeedCap', label: 'cap wish aire', min: 0.05, max: 3, step: 0.05 },
  { key: 'jumpVelocity', label: 'salto', min: 1, max: 15, step: 0.1 },
  { key: 'gravity', label: 'gravedad', min: 5, max: 50, step: 0.5 },
  { key: 'bhopSoftCap', label: 'tope bhop', min: 5, max: 40, step: 0.5 },
  { key: 'bhopSoftCapDecay', label: 'decay bhop', min: 0.1, max: 20, step: 0.1 },
  { key: 'slideBoost', label: 'boost slide', min: 1, max: 2.5, step: 0.05 },
  { key: 'slideDuration', label: 'dur. slide', min: 0.1, max: 2, step: 0.05 },
  { key: 'slideFriction', label: 'fricción slide', min: 0, max: 10, step: 0.1 },
  { key: 'mantleMaxHeight', label: 'altura mantle', min: 0.3, max: 3, step: 0.1 },
]

export interface TuningPanel {
  mount(parent: HTMLElement): void
  unmount(): void
  toggle(): void
}

export function createTuningPanel(): TuningPanel {
  let root: HTMLDivElement | null = null
  let visible = false

  function onKeyDown(e: KeyboardEvent): void {
    if (e.code === 'Backquote') {
      visible = !visible
      if (root) root.style.display = visible ? 'block' : 'none'
    }
  }

  return {
    mount(parent: HTMLElement): void {
      root = document.createElement('div')
      root.style.cssText =
        'position:absolute;top:8px;right:8px;display:none;z-index:20;' +
        'font:11px ui-monospace,monospace;color:#e6e6e6;' +
        'background:rgba(0,0,0,.85);padding:10px;border-radius:4px;' +
        'max-height:90vh;overflow-y:auto;width:260px'

      const titulo = document.createElement('div')
      titulo.textContent = 'tuning de movimiento  (tecla ` para cerrar)'
      titulo.style.cssText = 'margin-bottom:8px;opacity:.6'
      root.appendChild(titulo)

      for (const campo of CAMPOS) {
        const fila = document.createElement('div')
        fila.style.cssText = 'margin-bottom:6px'

        const etiqueta = document.createElement('div')
        const valorActual = MOVEMENT[campo.key] as number
        etiqueta.textContent = `${campo.label}: ${valorActual.toFixed(2)}`
        fila.appendChild(etiqueta)

        const slider = document.createElement('input')
        slider.type = 'range'
        slider.min = String(campo.min)
        slider.max = String(campo.max)
        slider.step = String(campo.step)
        slider.value = String(valorActual)
        slider.style.cssText = 'width:100%'
        slider.addEventListener('input', () => {
          const v = Number(slider.value)
          ;(MOVEMENT[campo.key] as number) = v
          etiqueta.textContent = `${campo.label}: ${v.toFixed(2)}`
        })
        fila.appendChild(slider)
        root.appendChild(fila)
      }

      parent.appendChild(root)
      window.addEventListener('keydown', onKeyDown)
    },

    unmount(): void {
      window.removeEventListener('keydown', onKeyDown)
      root?.remove()
      root = null
      visible = false
    },

    toggle(): void {
      visible = !visible
      if (root) root.style.display = visible ? 'block' : 'none'
    },
  }
}
```

- [ ] **Step 5: Conectarlo al juego**

En `src/game/game.ts`, agregar el import:

```ts
import { createTuningPanel } from '@/game/engine/tuning-panel'
```

Dentro de `createGame`, junto a `stats`:

```ts
  const tuning = createTuningPanel()
```

En `start()`, junto al mount de stats:

```ts
      if (canvas.parentElement) tuning.mount(canvas.parentElement)
```

En `stop()`, junto al unmount de stats:

```ts
      tuning.unmount()
```

- [ ] **Step 6: Verificar a mano**

Run: `pnpm dev`, abrir `/play`.

Apretar `` ` ``. El panel aparece. Mover el slider de `accel aire` y saltar: la ganancia de air-strafe cambia en vivo. Mover `gravedad` y saltar: los saltos se sienten distintos al instante.

**Este es el entregable real de la fase 0.** Ahora se puede tunear el feel jugando, en vez de adivinar. Dedicar una sesión a jugar y mover números hasta que se sienta bien, y anotar los valores finales en `tuning.ts`.

- [ ] **Step 7: Correr toda la suite**

Run: `pnpm test`
Expected: PASS, todos los tests de las 15 tareas.

- [ ] **Step 8: Commit**

```bash
committer "feat: panel de tuning en vivo y tests de arquitectura

Sliders que escriben sobre MOVEMENT sin recompilar, que es la única
forma de tunear el feel sintiéndolo. Más dos tests de guardia: el heap
no crece por tick, y src/game no importa React, Next ni Three fuera de
las dos excepciones autorizadas.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>" \
  src/game/engine/tuning-panel.ts src/game/movement/allocations.test.ts \
  src/game/architecture.test.ts src/game/game.ts
```

---

## Criterio de salida de la fase 0

Antes de pasar a la fase 1, verificar los seis puntos:

1. `pnpm test` pasa entero.
2. En `/play` se camina, corre, salta, desliza, se cancela el slide y se mantlea.
3. El bunny hop encadenado gana velocidad por encima del sprint y se estabiliza cerca de 14.4 m/s.
4. El HUD muestra **1 o 2 draw calls** y `cpuMs` por debajo de **2.5ms**.
5. El contador de fps se fija en el refresh del monitor (240 en escritorio, 120 en Mac) sin caídas.
6. El panel de tuning abre con `` ` `` y los cambios se sienten en vivo.

**Si el punto 3 se cumple pero moverse no se siente bien, no avanzar.** La fase 0 existe para descubrir eso ahora. Sentarse con el panel de tuning y mover números hasta que se sienta rico. Es tiempo bien gastado: todas las fases siguientes se construyen encima de este feel.
