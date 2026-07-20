# Tarea: colisión cápsula contra brushes convexos

Primera pieza de "importar mapas del Workshop". Se hace **sola y primero** porque es
la que decide si todo el resto vale la pena, y se puede probar entera con formas
sintéticas, sin necesidad de tener el parser de BSP escrito.

## Por qué

Hoy el motor sólo sabe chocar contra cajas alineadas a los ejes (`Box` en
`src/game/map/types.ts`). Medimos dos mapas reales del Workshop con
`scripts/bsp-analyze.ts`:

| | dm_nuketown | gm_lasertag_arena |
|---|---|---|
| Brushes sólidos | 1.492 | 1.060 |
| Cajas alineadas, por conteo | 44,0% | 70,0% |
| Cajas alineadas, por volumen | 97,4% | 90,7% |

O sea: casi todo el volumen ya entra en cajas, pero entre el 3% y el 9% son rampas y
muros en ángulo. Ese resto no se puede ignorar — una rampa que no se sube o una pared
invisible en diagonal arruina un mapa entero.

En Source la colisión del jugador no es la malla visual: son *brushes*, poliedros
convexos definidos por planos. Ya vienen convexos, o sea no hay que descomponer nada.

## Archivos

- Modificar: `src/game/physics/capsule.ts` (131 líneas; acá vive todo)
- Modificar: `src/game/map/types.ts` (agregar el tipo `Convex`)
- Test: `src/game/physics/capsule.test.ts`

**No toques** `src/game/movement/step.ts` más allá de lo mínimo para que compile, ni
el navgrid, ni nada de `src/game/map/*.ts` salvo `types.ts`. Los tres mapas actuales
(arena, torre, búnker) tienen que seguir andando exactamente igual.

## El tipo

```ts
export interface Convex {
  /** Planos empaquetados (nx, ny, nz, d), 4 floats por plano. Normales hacia
   *  AFUERA: el interior del cuerpo es donde dot(n, p) <= d. */
  planes: Float32Array
  count: number
  /** Caja envolvente, para descarte rápido antes de mirar los planos. */
  min: Vec3
  max: Vec3
}
```

## El algoritmo, ya resuelto

Cápsula = segmento AB con radio r. Cuerpo = intersección de semiespacios `dot(n,p) <= d`.

Para cada plano i:

```
minSeg = min(dot(n_i, A), dot(n_i, B))        // lineal sobre el segmento
penetracion_i = d_i + r - minSeg
```

- Si **algún** `penetracion_i <= 0`, ese plano separa: no hay contacto. Cortá temprano.
- Si todas son positivas, hay contacto. Empujá afuera por el plano de **menor**
  penetración positiva: `position += n_i * penetracion_i`.

Por qué funciona en rampas: sobre una rampa de 30° el plano de menor penetración es el
de la rampa, así que el empuje sale por la normal del plano inclinado y la cápsula
resbala hacia arriba en vez de trabarse. Ese es exactamente el comportamiento que hoy
no existe.

**Limitación conocida, documentala en el código, no la escondas:** tratar el cuerpo
como puro conjunto de planos sobreestima el volumen cerca de aristas y vértices (la
suma de Minkowski real con una esfera tiene esquinas redondeadas, esto las deja en
punta). El efecto es un colchón invisible de a lo sumo `r` en aristas convexas. Es
benigno —falla del lado de chocar de más, nunca de atravesar— y es lo que hacen varios
motores. No intentes resolver el caso exacto de arista/vértice en esta tarea.

## Restricciones que no se negocian

- **Cero asignaciones por frame.** Hay guards automáticos corriendo
  (`src/game/movement/allocations.test.ts`); no los debilites. Usá buffers
  preasignados a nivel de módulo, igual que el resto del motor.
- **La ruta de AABB se mantiene rápida.** Un AABB es un convexo de 6 planos, pero
  convertir los tres mapas actuales a planos costaría rendimiento sin motivo. `Box`
  sigue existiendo y `resolveMove` acepta **las dos** cosas.
- **`MAX_SUBSTEPS` y la lógica de substeps no cambian.** Ya están calibrados.
- TypeScript strict, nada de `any`.

## Tests que quiero ver

Escribí el test **antes** que la implementación y confirmá que falla primero.

1. **La rampa se sube.** Una cuña de 30°: la cápsula empujada horizontalmente contra
   ella termina *más arriba* que donde arrancó. Con el código de hoy esto es imposible
   y es la razón de ser de toda la tarea.
2. **No se atraviesa.** Cápsula lanzada a 80 m/s (más rápido que el bhop, que llega a
   14,4) contra un muro convexo delgado: termina de este lado. Un test que sólo prueba
   velocidades lentas no prueba nada.
3. **El plano separador corta temprano.** Una cápsula lejos de un convexo no reporta
   contacto y no se mueve.
4. **Equivalencia con AABB.** Un cubo expresado como `Convex` de 6 planos resuelve
   igual (dentro de 1e-4) que el mismo cubo como `Box`. Esto es lo que prueba que la
   ruta nueva no es una física distinta.
5. **Regresión:** toda la suite de movimiento existente sigue verde.

## Definition of done

Los cinco tests pasan, la suite entera está verde, `tsc` y lint limpios, y hay UN
commit con el trabajo. No agregues parsing de BSP, ni carga de mapas, ni navegación:
eso son tareas siguientes y meterlas acá hace la revisión imposible.
