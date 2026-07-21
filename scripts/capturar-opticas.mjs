/**
 * Capturas del banco de ópticas (src/app/optics-harness) para el entregable:
 * armas de COD con una mira montada en el riel y su punto rojo visible.
 *
 * Maneja un Chrome AISLADO propio por CDP —no el navegador compartido de las
 * herramientas MCP— con perfil y puerto propios. Sortea las trampas de
 * AGENTS.md: navega a `localhost` (no `127.0.0.1`, que Next 16 bloquea en dev)
 * y no toca pointer lock (el banco no lo pide).
 *
 * Uso:
 *   node scripts/capturar-opticas.mjs <baseUrl> <dirSalida>
 *
 * No es parte del build ni corre en tests: es verificación.
 */

import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
// Puerto de depuración propio (el dev server usa 3230; Chrome va aparte).
const PORT = 3241
const PERFIL = '/tmp/optics-harness-chrome'
const [, , BASE = 'http://localhost:3230', DIR = 'docs/opticas-capturas'] = process.argv

const VISTA = { w: 1400, h: 800 }

/**
 * Las escenas del entregable: una por arma+óptica, cubriendo red dot,
 * holográfica y magnificada sobre 5 rifles de COD distintos.
 */
// Vista 3/4 trasera-alta: muestra a la vez la mira ASENTADA sobre el riel y el
// punto rojo (que apunta al tirador). NO se pasa `pos`: el ancla la resuelve el
// catálogo, así la captura verifica el MISMO dato que usa el juego.
const REAR = { camPos: [0.22, 0.2, 0.34], camTarget: [0, 0.11, 0.0] }
const ESCENAS = [
  { archivo: 'ak47-reddot.png', weapon: 'cod4_ak47', optic: 'optic_reddot_m68', ov: REAR },
  { archivo: 'acr-holo.png', weapon: 'mw2e_acr', optic: 'optic_holo_eotech', ov: REAR },
  { archivo: 'm4a1-acog.png', weapon: 'mw3e_m4a1', optic: 'optic_acog', ov: REAR },
  { archivo: 'scarl-reflex.png', weapon: 'mw3e_scarl', optic: 'optic_reflex_mw3', ov: REAR },
  { archivo: 'scar-hamr.png', weapon: 'mw2e_scar', optic: 'optic_hamr', ov: REAR },
  // Sexta óptica (holo CoD4) sobre el AK, arma de ancla conocida.
  { archivo: 'ak47-holo-cod4.png', weapon: 'cod4_ak47', optic: 'optic_holo_cod4', ov: REAR },
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
}

async function esperar(ses, expr, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await ses.eval(expr)) return true
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
    `--window-size=${VISTA.w},${VISTA.h}`,
    '--hide-scrollbars',
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    'about:blank',
  ])
  chrome.stderr.on('data', () => {})

  try {
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
    const { targetId } = await send(browser, 'Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await send(browser, 'Target.attachToTarget', { targetId, flatten: true })

    const ses = {
      send: (method, params = {}) => sendSes(browser, sessionId, method, params),
      eval: async (expression) => {
        const r = await sendSes(browser, sessionId, 'Runtime.evaluate', {
          expression,
          awaitPromise: true,
          returnByValue: true,
        })
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.result?.description ?? ''))
        return r.result.value
      },
    }

    await ses.send('Page.enable')
    await ses.send('Runtime.enable')
    await ses.send('Emulation.setDeviceMetricsOverride', {
      width: VISTA.w,
      height: VISTA.h,
      deviceScaleFactor: 2,
      mobile: false,
    })
    await ses.send('Page.navigate', { url: `${BASE}/optics-harness` })
    await esperar(ses, 'Boolean(window.__opticsHarness)', 30000)
    await ses.eval('window.dispatchEvent(new Event("resize")), true')

    for (const escena of ESCENAS) {
      const ov = escena.ov ? `, ${JSON.stringify(escena.ov)}` : ''
      await ses.eval(
        `window.__opticsHarness.mostrar(${JSON.stringify(escena.weapon)}, ${JSON.stringify(escena.optic)}${ov}).then(() => true)`,
      )
      // El GLB del arma y el de la óptica bajan async; darles tiempo.
      await sleep(1800)
      const err = await ses.eval('window.__opticsHarness.error()')
      const draws = await ses.eval('window.__opticsHarness.drawCalls()')
      const shot = await ses.send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(join(DIR, escena.archivo), Buffer.from(shot.data, 'base64'))
      console.log(`${escena.archivo.padEnd(22)} draws=${draws}  ${err ? 'ERROR: ' + err : 'ok'}`)
    }

    await send(browser, 'Target.closeTarget', { targetId }).catch(() => {})
  } finally {
    chrome.kill('SIGKILL')
  }
}

function send(browser, method, params = {}) {
  const id = ++browser.id
  return new Promise((resolve, reject) => {
    browser.pend.set(id, { resolve, reject })
    browser.ws.send(JSON.stringify({ id, method, params }))
  })
}

function sendSes(browser, sessionId, method, params = {}) {
  const id = ++browser.id
  return new Promise((resolve, reject) => {
    browser.pend.set(id, { resolve, reject })
    browser.ws.send(JSON.stringify({ id, method, params, sessionId }))
  })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
