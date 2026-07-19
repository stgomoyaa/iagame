# Núcleo del viewmodel — spec de implementación

Cubre la Parte 2 del work order de armas. Matemática pura, sin Three.js, sin React,
sin DOM. La conversión al grafo de escena ocurre en el borde, igual que el resto del juego.

## Por qué procedural

40 armas por 5 animaciones cada una es trabajo de arte que no existe y que no vamos a
pagar. Toda la animación se compone por código como capas aditivas de transformación,
evaluadas por frame. El arma sólo aporta números en su config, no keyframes.

## Tipos

```ts
/** Offset de transformación. Rotación en radianes, posición en metros. */
interface VmTransform {
  px: number; py: number; pz: number
  rx: number; ry: number; rz: number
}

/** Configuración visual por arma. Todo lo que el rig necesita saber. */
interface WeaponVisual {
  hip: VmTransform
  ads: VmTransform
  adsTime: number        // segundos hip -> ads
  drawTime: number
  reloadTime: number
  kickMagnitude: number  // escala del culatazo
}
```

## Capas y orden de composición

El orden es fijo y determinista. Se testea que lo sea.

| # | Capa | Qué aporta | Se atenúa con |
|---|---|---|---|
| 1 | `base` | Interpolación `hip` → `ads` según `adsT` | — |
| 2 | `bob` | Figura de ocho por velocidad de movimiento | `(1 - adsT)`, y a cero en el aire |
| 3 | `sway` | Retardo respecto al mouse, resorte amortiguado | `(1 - adsT * 0.6)` |
| 4 | `kick` | Impulso atrás, arriba y roll, con retorno elástico | — |
| 5 | `reload` | Secuencia por código | — |
| 6 | `draw` | Sube desde abajo al cambiar de arma | — |

Las capas 2 a 6 son **aditivas** sobre la base. Ninguna reemplaza a otra: eso permite
disparar mientras se hace ADS, o recargar mientras se corre, sin casos especiales.

### base

`lerp(hip, ads, easeInOutCubic(adsT))`. `adsT` avanza hacia 0 o 1 a razón de
`dt / adsTime`, clampeado. **Debe alcanzar exactamente 1.0 al cumplirse `adsTime`, y no
pasarse.** Es un test explícito.

### bob

Figura de ocho clásica: la componente horizontal oscila al doble de frecuencia que la
vertical.

```
bobPhase += speed * dt * BOB_FREQ
px += sin(bobPhase) * amp
py += sin(bobPhase * 2) * amp * 0.5
```

`amp = BOB_AMP * clamp(speed / sprintSpeed, 0, 1) * (1 - adsT) * groundedBlend`

`groundedBlend` va a 0 en el aire con una constante de tiempo, no de golpe: cortar el bob
en seco al saltar se ve como un tirón.

La fase **no se resetea** al parar. Reiniciarla produce un salto visible cuando el jugador
vuelve a moverse.

### sway

El arma va atrás del mouse. Resorte amortiguado de segundo orden sobre el delta acumulado:

```
swayTarget = clamp(-mouseDelta * SWAY_SCALE, -SWAY_MAX, SWAY_MAX)
swayVel += (swayTarget - sway) * SWAY_STIFFNESS * dt
swayVel *= exp(-SWAY_DAMPING * dt)
sway += swayVel * dt
```

Amortiguación exponencial, no multiplicación por constante fija: tiene que ser
independiente del framerate, porque el render corre entre 120 y 240Hz.

Aporta posición y rotación: el arma se retrasa y además cabecea.

### kick

Impulso al disparar, retorno elástico. Mismo resorte que sway pero con objetivo cero y un
impulso instantáneo al gatillo:

```
kickVel.pz += kickMagnitude * KICK_BACK
kickVel.py += kickMagnitude * KICK_UP
kickVel.rz += kickMagnitude * KICK_ROLL * lado   // alterna para que no sea repetitivo
```

El roll alterna de signo entre disparos. Repetir el mismo culatazo idéntico es lo que hace
que un arma automática se vea muerta.

### reload

Secuencia por código con fracciones de `reloadTime`:

| Fracción | Evento |
|---|---|
| 0.00 - 0.25 | Baja e inclina |
| 0.25 | **emite `magOut`** |
| 0.25 - 0.55 | Sostiene abajo (cargador afuera) |
| 0.55 | **emite `magIn`** |
| 0.55 - 1.00 | Vuelve a la posición |

Los eventos se emiten **una sola vez** por recarga, en el tick donde se cruza la fracción.
La lógica de munición y el audio se cuelgan de ahí. Es un test explícito: se cruzan en la
fracción correcta y no se repiten.

### draw

Sube desde `DRAW_DROP` metros abajo hasta cero en `drawTime`, con `easeOutCubic`.

## Restricción de asignaciones

`stepViewmodel` corre por frame. Cero asignaciones: el estado vive en un objeto
preasignado y el resultado se escribe en un `out: VmTransform` que recibe el llamador.
Los eventos de recarga se reportan por flags en el estado (`emittedMagOut`,
`emittedMagIn`), no por callbacks ni arrays, que asignarían.

## Tests obligatorios

1. **Determinismo de composición.** Misma secuencia de entradas produce la misma
   transformación, bit a bit.
2. **ADS alcanza el objetivo exactamente en `adsTime`**, sin pasarse en ninguno de los dos
   extremos, y vuelve exacto a `hip` al soltar.
3. **Timing de eventos de recarga.** `magOut` y `magIn` se emiten en las fracciones
   especificadas de `reloadTime`, exactamente una vez cada uno.
4. **Independencia del framerate.** Correr la misma duración total en pasos de 1/120 y de
   1/240 converge al mismo estado dentro de una tolerancia chica. Es lo que valida que los
   resortes usen decaimiento exponencial y no una constante por tick.
5. **El bob se desvanece en el aire y en ADS**, y su fase no se resetea al detenerse.
6. **Cero asignaciones**: el heap no crece sobre muchos miles de pasos.

## Fuera de alcance

Nada de Three.js acá. Nada de importador `.mdl`. Nada de cargar GLB: eso es el pipeline de
assets, que va después. El rig se prueba contra números, no contra mallas.
