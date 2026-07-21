# Golpe de vista (recoil que se SIENTE)

El retroceso tiene dos canales separados a propósito:

- **Apuntado** (`combat/recoil.ts`): el patrón determinista. Dice **dónde van las
  balas**. Arranca en cero en el primer tiro (bala precisa) y sube con el spray
  siguiendo una curva calibrada por arquetipo. Aprendible, como en CS. **No se
  tocó.**
- **Sensación** (`feedback/camera-punch.ts`): un golpe amortiguado que patea la
  cámara con la que se **renderiza**, y vuelve. **No toca el hitscan.** Por eso
  patea en CADA disparo (incluido el primero y cada tap), mientras el apuntado
  arranca en cero. Es lo que hace que un arma "se sienta" sin arruinar el spray.

El bug que esto arregla: el modelo viejo ponía la cámara en la posición
**absoluta** del patrón, y `pattern[0] = [0,0]` en toda arma, así que el primer
tiro movía la cámara **cero**. Como el índice del patrón se enfría en pocos ms,
tap-fire y todas las semi (pistolas, snipers, escopetas, DMR) disparaban siempre
con offset ~0: **cero pateo**. Ahora el pateo es un canal aparte que no depende
del índice del patrón.

## Magnitud por arma

El impulso vive en `archetype.recoil.viewKick` (radianes/seg). Escala por
**carácter de clase**: una escopeta o un cerrojo dan un golpe seco grande (evento
único); una SMG apenas un empujón por bala (cadencia altísima, muchos golpes
chicos que se acumulan bajo el tope). La variación arma-a-arma dentro de una
clase (dos pistolas distintas) es una capa aparte (diversidad de recoil), no esto.

Picos medidos con el trazador headless (`feedback/recoil-kick.trace.test.ts`), a
240 Hz. "1 tiro" es un tap; "sostenido" es un segundo de fuego a la cadencia real
del arma. El pico llega a los ~96 ms y asienta (vuelve bajo 0.05°) a los ~330 ms:
un golpe seco que se recupera en un tercio de segundo.

```
arquetipo        | viewKick° | pico 1 tiro° | pico@ms | asienta@ms | sostenido°
-----------------|-----------|--------------|---------|------------|-----------
smg-1            |      11.0 |        0.424 |      96 |        313 |      1.203
smg-2            |      12.0 |        0.462 |      96 |        317 |      1.177
ar-1             |      20.0 |        0.770 |      96 |        338 |      1.585
ar-2             |      24.0 |        0.924 |      96 |        342 |      1.271
ar-3             |      26.0 |        1.001 |      96 |        342 |      1.766
sniper-bolt      |      58.0 |        2.234 |      96 |        358 |      2.234
sniper-marksman  |      38.0 |        1.464 |      96 |        350 |      1.464
shotgun          |      62.0 |        2.388 |      96 |        358 |      2.391
lmg              |      14.0 |        0.539 |      96 |        325 |      1.285
pistol           |      21.0 |        0.809 |      96 |        338 |      1.181
```

Ordenado: la escopeta y el cerrojo pegan el golpe más fuerte (~2.3-2.4°), las SMG
el más suave (~0.42°). El fuego sostenido más brutal (ar-3, 1.77°) sigue bajo el
tope de `FEEDBACK.cameraKickPitchMax` (3.5°), así que el desfase entre la vista y
el apuntado real queda acotado: las balas nunca caen "muy lejos" de la retícula.

## Cómo tunearlo

Es un knob de **sensación** — hay que jugarlo, no calcularlo. Es el equivalente
del FOV o la velocidad de bots: los números de acá son un punto de partida
razonable, no la verdad final.

- Un arma se siente floja → subí su `viewKick` en `weapons/archetypes.ts`.
- Todo se siente demasiado → bajá `FEEDBACK.cameraKickPitchMax` (el tope) o los
  `viewKick` en bloque.
- El pico en grados es ~`0.0385 × viewKick°` (lineal): querés 1° de pico → poné
  `degToRad(26)`.
- Con `?debug=1`, `window.__combatDebug().feedback.cameraKickPitch/cameraKickYaw`
  leen el golpe en vivo, sin pointer lock.
