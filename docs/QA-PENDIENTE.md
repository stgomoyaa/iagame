# QA de Santiago

Lo que ningún test ni ningún agente puede cerrar. Necesita una mano en un mouse.

**Cómo abrirlo:** `pnpm build && pnpm start --hostname 0.0.0.0`, y desde el PC
`http://192.168.1.82:3000`. Clic en el canvas para tomar el pointer lock.

Modo desarrollo también sirve (`pnpm dev`), pero arrastra overhead: para juzgar rendimiento
y fluidez usá el build de producción.

**Los paneles:** la tecla `` ` `` abre el de movimiento. Agregando `?debug=1` a la URL
aparece el de armas. Los dos escriben en vivo, sin recompilar.

---

## 0. Lo primero: confirmá los 240Hz

El contador arriba a la izquierda tiene que clavarse en **240**, no en 120 ni 60.

Si marca 60, casi seguro es la pantalla o el modo de ahorro de energía, no el juego (Apple
capa ProMotion a 60Hz en bajo consumo). **Decime qué número ves**: todo el presupuesto de
frame se diseñó contra 240 y esta es la primera vez que se puede verificar.

---

## 1. Movimiento (criterio de salida de la fase 0)

Estas tres mecánicas **nunca las ejecutó un humano**. El pointer lock no funciona en
navegadores de automatización, así que están cubiertas por tests y por nadie más.

- [ ] **Mouse-look.** ¿La sensibilidad se siente bien? ¿Hay tirón o aceleración rara?
- [ ] **Bunny hop.** Mantené espacio y girá el mouse mientras strafeás con A o D.
      **No uses W**: en línea recta no ganás nada, y eso es correcto, igual que en CS.
      La simulación llega a 14.4 m/s contra 8 de sprint. **¿Llegás vos?** Y más importante:
      ¿se puede *descubrir* la técnica o hay que adivinarla?
- [ ] **Mantle.** Corré contra las cajas de 1m saltando. ¿Sube limpio o se traba?
- [ ] **Slide y cancel.** Ctrl corriendo, después espacio. ¿El cancel invita a encadenar?
- [ ] **Salto.** El ápice es 0.96m contra cajas de 1.0m. ¿Se lee como "casi la hago" o como
      "el juego me robó"? Si es lo segundo, subí `salto` en el panel.

## 2. Disparo (criterio de salida de la fase 1)

- [ ] **El retroceso.** Tapeá 3 tiros: tiene que ser preciso. Después mantené el gatillo,
      la subida arranca suave y se empina. ¿Se parece al patrón de CS que mandaste?
- [ ] **La recuperación del spray.** Tirá 20 balas, soltá un segundo, volvé a tirar. El
      primer tiro tiene que salir limpio, no con el retroceso del final del cargador.
- [ ] **El ADS.** Clic derecho sostenido. ¿La mira queda alineada con el centro? ¿Se siente
      más lento de girar? Debería: hay multiplicador de sensibilidad.
- [ ] **El audio del hitmarker.** Ya reportaste delay. Si sigue, **decime cuándo aparece**:
      ¿al primer tiro de la sesión? ¿después de dejar la pestaña de lado? Eso distingue
      entre dos causas posibles y sin ese dato no lo puedo cerrar.
- [ ] **El punch de cámara.** Está marcado como casi invisible. ¿Coincidís?

## 3. Bots (criterio de salida de la fase 2)

- [ ] **¿Se sienten justos?** Uno que apunta perfecto se siente tramposo; uno que falla
      mucho se siente tonto. **El punto medio no se calcula, se juega.** Es lo que más
      probablemente necesite tuneo tuyo.
- [ ] ¿Te ven antes de que deberían? No pueden ver a través de paredes ni fuera de su cono.
- [ ] ¿El apuntado hace snap o gira? Nunca debería hacer snap.
- [ ] ¿Se quedan parados en algún lado?

## 4. Los tres mapas

- [ ] **arena** (3 carriles), **torre** (vertical), **bunker** (cerrado).
      ¿Juegan **distinto** o se sienten el mismo mapa con las cajas movidas?
- [ ] En torre, ¿la verticalidad cambia tus decisiones o podés ignorarla? Está marcado que
      el anillo a nivel del suelo es su punto débil.

## 5. Rangos

- [ ] Jugá varias partidas. ¿El RR que ganás y perdés **se siente justo**?
- [ ] ¿Notás que los bots cambian al subir de rango? Deberían: 400ms de reacción en Hierro
      contra 120ms en Radiante.
- [ ] El drop de skin al terminar está marcado como flojo: dos cuadrados y un nombre.

---

## Cómo tunear

Todo número de feel está en el panel y escribe en vivo. Movelo hasta que se sienta bien,
**anotá el valor y decímelo** para dejarlo fijo en el código.

Los que más mueven la aguja, en orden: `accel suelo`, `accel aire`, `gravedad`, `salto`,
`boost slide`. Para el arma: `kickMagnitude` y `adsTime`.

El panel de armas tiene un botón **EXPORT** que baja el archivo de tuning. Ponelo en
`public/` y el juego lo carga al arrancar.

## Seguridad

- [ ] **Regenerar la clave de Steam** en https://steamcommunity.com/dev/apikey. Quedó
      expuesta tres veces en el transcript. Toma 30 segundos e invalida la anterior.
