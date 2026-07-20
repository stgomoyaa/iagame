import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const GAME_DIR = join(process.cwd(), 'src/game')

/** Únicos archivos de src/game autorizados a importar Three. */
const PUEDEN_USAR_THREE = [
  'engine/renderer.ts',
  'map/mesh.ts',
  'weapons/viewmodel/renderer.ts',
  // three-mesh-bvh (fase 1, hitscan) exige un Ray y una BufferGeometry
  // reales para raycastFirst(): no alcanza con un objeto {x,y,z} duck-typed.
  // El resto del sistema de combate es matemática pura y no importa three;
  // este es el único punto de contacto (ver el comentario de cabecera de
  // combat/hitscan.ts).
  'combat/hitscan.ts',
  // Efectos de disparo (fase 5): el estado de las partículas es puro y vive
  // en feedback/vfx.ts (anillos de instancias, sin three); este archivo es
  // el único punto de contacto con la GPU -- mallas instanciadas, shaders y
  // las texturas que se generan por canvas. Es la ÚNICA entrada nueva que
  // suma esa fase a esta lista.
  'feedback/vfx-renderer.ts',
  // Dianas (fase 1, sección 6): la lógica (targets/targets.ts) es
  // matemática pura, igual que combat/hitboxes.ts; este archivo es el
  // único punto de contacto con la escena real para dibujarlas (mismo
  // motivo que map/mesh.ts).
  'targets/renderer.ts',
  // Bots (fase 2, sección 8): el cerebro (bots/bot.ts) es matemática pura
  // igual que targets/targets.ts, y éste es el único punto de contacto con
  // la escena -- mismo motivo que targets/renderer.ts. Desde la tarea de
  // modelos dibuja personajes rigged con AnimationMixer en vez de cápsulas.
  'bots/renderer.ts',
  // Tinte de equipo del personaje: separado de bots/renderer.ts porque es
  // una pieza distinta (un material y su shader, no la escena) y porque el
  // criterio de legibilidad de equipos se lee mejor solo. Único archivo
  // NUEVO que esta tarea suma a la lista -- mismo criterio que
  // skins/material.ts, que ya hacía lo propio para las armas.
  'bots/character-material.ts',
  // Skins (fase 3, sección 7): el generador (skins/generator.ts y todo lo
  // que cuelga de él) es matemática pura y no importa three. Estos dos son
  // el borde contra la escena, mismo criterio que map/mesh.ts:
  // material.ts inyecta el shader de skin sobre el material del arma, y
  // preview.ts dibuja el arma en la armería.
  'skins/material.ts',
  'skins/preview.ts',
  // Mapas importados de Source: la matemática (map/source-map.ts -- escala,
  // brushes convexos, validación de spawns) es pura y NO importa three, que
  // es justo la parte donde esta tarea se podía romper en silencio. Este
  // archivo es sólo el borde: GLTFLoader para bajar el GLB y el recorrido de
  // BufferGeometry para hornear los triángulos del BVH de hitscan, dos cosas
  // que no se pueden hacer sin three real. Mismo criterio que map/mesh.ts.
  // Es la ÚNICA entrada nueva que suma esta tarea a la lista.
  'map/external-map.ts',
]

function archivosTs(dir: string, base = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const rel = base ? `${base}/${entry}` : entry
    if (statSync(full).isDirectory()) out.push(...archivosTs(full, rel))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(rel)
  }
  return out
}

describe('límites de arquitectura', () => {
  const archivos = archivosTs(GAME_DIR)

  it('encuentra archivos para revisar', () => {
    expect(archivos.length).toBeGreaterThan(5)
  })

  // Los import() dinámicos sólo se detectan cuando el specifier es un
  // string literal ('react', 'next/...', 'three'). import(unaVariable) o
  // import(`three${sufijo}`) evaden este chequeo: requieren un patrón
  // deliberado y poco común, no uno accidental, así que queda como hueco
  // conocido en vez de perseguir un análisis estático completo.
  it('src/game nunca importa React ni Next', () => {
    for (const f of archivos) {
      const src = readFileSync(join(GAME_DIR, f), 'utf8')
      expect(src, `${f} importa react`).not.toMatch(/from\s+['"]react['"]/)
      expect(src, `${f} importa react (import dinámico)`).not.toMatch(
        /import\s*\(\s*['"]react['"]\s*\)/,
      )
      expect(src, `${f} importa next`).not.toMatch(/from\s+['"]next[/'"]/)
      expect(src, `${f} importa next (import dinámico)`).not.toMatch(
        /import\s*\(\s*['"]next[/'"]/,
      )
    }
  })

  it('sólo el renderer y el mesh importan Three', () => {
    // El patrón cubre tanto 'three' pelado como cualquier subpath
    // ('three/examples/jsm/...', 'three/webgpu', etc.): un patrón que sólo
    // matcheara la raíz dejaba pasar cualquier subpath sin que el guard
    // fallara nunca, que es peor que no tener guard.
    for (const f of archivos) {
      const src = readFileSync(join(GAME_DIR, f), 'utf8')
      const importaThree =
        /from\s+['"]three(\/[^'"]*)?['"]/.test(src) ||
        /import\s*\(\s*['"]three(\/[^'"]*)?['"]\s*\)/.test(src)
      if (importaThree) {
        expect(PUEDEN_USAR_THREE, `${f} no está autorizado a importar three`).toContain(f)
      }
    }
  })
})
