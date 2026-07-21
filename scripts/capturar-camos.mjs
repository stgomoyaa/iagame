/**
 * Capturas del banco de camuflajes (src/app/camo-harness) para el entregable.
 *
 * Maneja un Chrome AISLADO propio por CDP —no el navegador compartido de las
 * herramientas MCP— y guarda un PNG por escena. Sortea las dos trampas del
 * proyecto documentadas en AGENTS.md:
 *   - navega a `localhost` y no a `127.0.0.1`: Next 16 bloquea el segundo como
 *     origen cruzado en dev y React nunca hidrata, en silencio.
 *   - no toca pointer lock (el harness no lo pide), así que no hace falta el
 *     stub de document.pointerLockElement.
 *
 * Uso:
 *   node scripts/capturar-camos.mjs <baseUrl> <dirSalida>
 *
 * No es parte del build ni corre en tests: es una herramienta de verificación.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PORT = 9411
const PERFIL = '/tmp/camo-harness-chrome'
const [, , BASE = 'http://localhost:3000', DIR = 'docs/camos-capturas'] = process.argv

const SLUG = 'assaultrifle-1'

/** Un arma sola, de perfil, entra en horizontal: la vista ancha la muestra
 *  entera sin cortar el cañón. */
const HORIZONTAL = { w: 1400, h: 640 }
/** El atril de comparación apila cuatro armas: necesita vertical. */
const VERTICAL = { w: 900, h: 1300 }

/** Los 17 camos del catálogo, en orden. Una captura por camo para verlos y
 *  tunearlos contra las referencias. Si el catálogo cambia, se actualiza esta
 *  lista. */
const CAMOS = [
  'elemento-115', 'otromundo',
  'nebulosa', 'aurora',
  'humo-tactico',
  'magma', 'ceniza',
  'damasco-acero', 'filigrana-oro',
  'marmol', 'obsidiana',
  'materia-oscura', 'grieta-carmesi',
  'cota', 'radar',
  'mercurio', 'oro-liquido',
]

/** Cada escena es una captura: qué mostrar, con qué encuadre. */
const ESCENAS = [
  // Escalera de rareza: de un común mate a un exótico encendido, apilados, para
  // ver de un vistazo cómo el brillo escala con la rareza. Es la prueba visual
  // del punto nuevo de la tarea (más legendario = más brillante).
  {
    archivo: 'escalera-rareza.png',
    vista: VERTICAL,
    descriptores: [
      { kind: 'camo', ref: 'humo-tactico' }, // común: mate, el piso
      { kind: 'camo', ref: 'mercurio' }, // raro: reflejo, sin glow
      { kind: 'camo', ref: 'magma' }, // legendario: lava encendida
      { kind: 'camo', ref: 'elemento-115' }, // exótico: neón radiactivo
    ],
  },
  // Comparación contra un camo procedural legendario, como el entregable.
  {
    archivo: 'comparacion.png',
    vista: VERTICAL,
    descriptores: [
      { kind: 'family', ref: 'demo:1', family: 'damasco' },
      { kind: 'camo', ref: 'elemento-115' },
      { kind: 'camo', ref: 'grieta-carmesi' },
      { kind: 'camo', ref: 'nebulosa' },
    ],
  },
  // Un arma sola por camo, para comparar cada uno contra su referencia.
  ...CAMOS.map((ref) => ({
    archivo: `camo-${ref}.png`,
    vista: HORIZONTAL,
    descriptores: [{ kind: 'camo', ref }],
  })),
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Cliente CDP mínimo sobre el WebSocket global de Node. */
class CDP {
  constructor(ws) {
    this.ws = ws
    this.id = 0
    this.pend = new Map()
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && this.pend.has(msg.id)) {
        const { resolve, reject } = this.pend.get(msg.id)
        this.pend.delete(msg.id)
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
      }
    })
  }
  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true })
      ws.addEventListener('error', rej, { once: true })
    })
    return new CDP(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pend.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
    return r.result.value
  }
}

async function esperar(cdp, expr, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await cdp.eval(expr)) return true
    await sleep(150)
  }
  throw new Error(`timeout esperando: ${expr}`)
}

async function main() {
  mkdirSync(DIR, { recursive: true })
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PERFIL}`,
    '--window-size=900,1200',
    '--hide-scrollbars',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank',
  ])
  chrome.stderr.on('data', () => {})

  try {
    // Endpoint de la pestaña.
    let wsUrl
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`http://localhost:${PORT}/json/version`)
        wsUrl = (await res.json()).webSocketDebuggerUrl
        if (wsUrl) break
      } catch {
        /* aún no levantó */
      }
      await sleep(250)
    }
    if (!wsUrl) throw new Error('Chrome no expuso el puerto de depuración')

    const browser = await CDP.connect(wsUrl)
    const { targetId } = await browser.send('Target.createTarget', {
      url: 'about:blank',
    })
    const { sessionId } = await browser.send('Target.attachToTarget', {
      targetId,
      flatten: true,
    })
    // Un CDP por sesión: reusa el mismo socket con sessionId en cada mensaje.
    const page = {
      send: (method, params = {}) =>
        browser.send(method, params).catch(() => {}) && sendSes(method, params),
    }
    function sendSes(method, params) {
      const id = ++browser.id
      return new Promise((resolve, reject) => {
        browser.pend.set(id, { resolve, reject })
        browser.ws.send(JSON.stringify({ id, method, params, sessionId }))
      })
    }
    const ses = { send: sendSes, eval: (e) => CDP.prototype.eval.call({ send: sendSes }, e) }

    await ses.send('Page.enable')
    await ses.send('Runtime.enable')
    await ses.send('Page.navigate', { url: `${BASE}/camo-harness` })
    await esperar(ses, 'Boolean(window.__camoHarness)', 30000)

    for (const escena of ESCENAS) {
      // Encuadre por escena: un arma sola en horizontal, el atril en vertical.
      await ses.send('Emulation.setDeviceMetricsOverride', {
        width: escena.vista.w,
        height: escena.vista.h,
        deviceScaleFactor: 1,
        mobile: false,
      })
      // El canvas es 100vw/100vh y sigue al viewport, pero el renderer sólo se
      // entera del nuevo tamaño por el evento resize que la vitrina escucha.
      await ses.eval('window.dispatchEvent(new Event("resize")), true')
      await ses.eval(
        `window.__camoHarness.mostrar(${JSON.stringify(SLUG)}, ${JSON.stringify(escena.descriptores)}), true`,
      )
      // Los patrones bajan async y el atril se arma; darle tiempo a cargar y a
      // que la oscilación llegue a un ángulo con brillo visible.
      await sleep(2600)
      const err = await ses.eval('window.__camoHarness.error()')
      const draws = await ses.eval('window.__camoHarness.drawCalls()')
      const shot = await ses.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(DIR, escena.archivo), Buffer.from(shot.data, 'base64'))
      console.log(`${escena.archivo.padEnd(34)} draws=${draws}  ${err ? 'ERROR: ' + err : 'ok'}`)
    }

    await browser.send('Target.closeTarget', { targetId }).catch(() => {})
  } finally {
    chrome.kill('SIGKILL')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
