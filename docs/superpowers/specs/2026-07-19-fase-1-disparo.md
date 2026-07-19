# Fase 1: disparar — spec de implementación

## Criterio de salida, y es el único que importa

**Pegarle a una diana tiene que dar gusto sin que haya un solo enemigo en el mapa.**

Si no lo da, no se avanza a los bots. Es el mismo criterio que usó la fase 0 con el
movimiento, y es lo que evita construir contenido sobre un core que no se siente. Un
"funciona y los tests pasan" no cumple este criterio.

## Qué ya existe y no hay que rehacer

- `src/game/weapons/archetypes.ts` — 10 arquetipos con curvas de daño por distancia, cadencia,
  cargador, tiempos de recarga, parámetros de ADS y **patrones de retroceso ya calibrados a
  magnitudes físicas** (15-20° de subida para un rifle, cubriendo el cargador entero sin wrap).
- `src/game/weapons/viewmodel/rig.ts` — las 6 capas procedurales, incluidos `fire()` con
  culatazo elástico y `startReload()` con eventos en `magOut` y `magIn`.
- `three-mesh-bvh` ya está instalado como dependencia. Nadie lo usa todavía: es para esto.
- `src/game/map/arena.ts` — la geometría, como cajas AABB.

## 1. Hitscan

Raycast contra un BVH construido una vez sobre la geometría del mapa, más las hitboxes de los
objetivos. **Cero asignaciones por disparo**: el resultado se escribe en un objeto preasignado,
igual que el resto del motor.

Sin proyectiles con viaje y sin penetración de materiales en esta fase.

El disparo sale **desde la cámara, no desde la boca del arma**. Es lo que hacen todos los
shooters en primera persona: si el rayo saliera del viewmodel, apuntar al borde de una caja
daría impactos que no coinciden con la mira, y se siente roto aunque sea "más realista".

## 2. Hitboxes y daño

Multiplicadores del spec sección 5: **cabeza 1.8, torso 1.0, extremidades 0.85**, sobre 100 de
vida y sin armadura.

El daño sale de la curva del arquetipo: daño completo hasta el rango óptimo, caída lineal
hasta el máximo, y un piso porcentual más allá. Ya está implementado y testeado; sólo hay que
consumirlo.

TTK objetivo en rango óptimo: **250-400ms**, que es lo que los 10 arquetipos ya cumplen.

## 3. Retroceso aplicado a la cámara

El patrón determinista mueve el pitch y el yaw de la cámara. Encima va un cono de dispersión
aleatorio que **crece con fuego sostenido y se cierra al soltar el gatillo**.

Dos propiedades que hay que testear porque son las que hacen que el arma se sienta aprendible:

- El patrón es determinista: la misma secuencia de disparos produce el mismo desvío, siempre.
- La recuperación devuelve la cámara hacia el origen con una curva suave, **sin pasarse**.

El retroceso **no puede empujar el pitch más allá de `PITCH_LIMIT`**. Los patrones ya están
calibrados para quedar holgadamente adentro, pero la aplicación tiene que clampear igual: una
suma de retroceso más movimiento del jugador puede llegar al tope aunque el patrón solo no.

## 4. ADS de verdad

Hoy el ADS sólo mueve el arma. Falta conectar sus tres efectos reales, que ya están como datos
en cada arquetipo:

- **FOV**: interpola al `fovScale` del arma durante `adsTime`.
- **Sensibilidad**: multiplica por `sensScale` mientras se apunta. Sin esto, apuntar con mira
  se siente igual de brusco que de cadera y el ADS no aporta nada.
- **Velocidad de movimiento**: multiplica por `speedScale`.

Los tres tienen que interpolar junto con la transición visual, no saltar al llegar.

## 5. Sistema de feedback

**Esto no es pulido, es la mitad del criterio de salida.** Todo vive en `src/game/feedback/` y
en ningún otro lado, así que el feel se tunea en un solo archivo.

### Al impactar

| Elemento | Detalle |
|---|---|
| Hitmarker | Escala con el daño |
| Sonido | Cuatro niveles: impacto normal, headshot agudo, kill grave, headshot kill |
| Números de daño | Flotan hacia arriba y se apagan |
| Punch de cámara | Sutil, al disparar |

### Al recibir

Viñeta roja **direccional** (indica de dónde vino), screen shake proporcional al daño, y
latido más desaturación bajo 30 de vida.

### Restricciones

Todo sale de **pools preasignados**. El juice no puede costar frames: el presupuesto es 2.5ms
y la GPU ya está usando ~1.9 de eso. Medí CPU y GPU al cerrar, el HUD muestra los dos.

## 6. Dianas

Objetivos estáticos y móviles en la arena, con hitboxes reales, que reaccionan al impacto y se
reinician. Es lo que permite evaluar el criterio de salida sin bots.

Poné al menos una diana a rango óptimo y una lejos, para que la caída de daño sea observable.

## Qué testear

Lógica pura, con Vitest:

- Multiplicadores por hitbox y curva de daño por distancia.
- Determinismo del patrón de retroceso aplicado (misma secuencia, mismo desvío).
- El retroceso acumulado nunca supera `PITCH_LIMIT`.
- La dispersión crece con fuego sostenido y se cierra al soltar, de forma monótona.
- El ADS alcanza exactamente sus tres objetivos (FOV, sensibilidad, velocidad) en `adsTime`.
- Cero asignaciones: el heap no crece a lo largo de miles de disparos.

Lo que **no** se puede testear y hay que mirar: si pegarle a algo da gusto. Eso se juega en el
navegador, con el mouse.

## Fuera de alcance

Bots, modos de juego, killfeed, munición persistente entre partidas, y penetración de
materiales. Todo eso es fase 2 o posterior.
