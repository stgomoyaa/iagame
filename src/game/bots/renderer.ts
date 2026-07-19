/**
 * Malla visual PLACEHOLDER de los bots: una cápsula (cuerpo) + una esfera
 * (cabeza) por bot, coloreadas según su estado de FSM -- nada de esto es
 * arte final. La consigna de esta tarea es cerebro y navegación reales
 * sobre cuerpos de relleno; los modelos rigged (Quaternius Ultimate Modular
 * Men + Universal Animation Library, sección 11 del spec) son una tarea
 * aparte, después de que el comportamiento ya esté probado.
 *
 * Uno de los archivos de src/game autorizados a importar three (ver
 * architecture.test.ts), junto con engine/renderer.ts, map/mesh.ts,
 * weapons/viewmodel/renderer.ts, combat/hitscan.ts y targets/renderer.ts --
 * mismo motivo que targets/renderer.ts: la lógica de bots (bots/bot.ts) es
 * matemática pura, y éste es el único punto de contacto con la escena real.
 *
 * Geometría y materiales se crean una sola vez en createBotsRenderer();
 * sync() (una vez por frame desde game.ts) sólo muta posiciones/colores de
 * objetos ya existentes -- cero asignaciones en el camino de frame.
 */

import { CapsuleGeometry, Color, Group, Mesh, MeshBasicMaterial, type Scene, SphereGeometry } from 'three'
import type { BotState } from '@/game/bots/bot'
import type { BotStateName } from '@/game/bots/fsm'
import { BOTS } from '@/game/bots/tuning'
import { PLAYER_CAPSULE } from '@/game/physics/capsule'

/** Color por estado de FSM: da lectura inmediata en el navegador de qué
 *  está pensando cada bot sin necesitar un HUD de debug aparte -- útil para
 *  verificar a ojo que la FSM transiciona de verdad al jugar. */
const STATE_COLOR: Record<BotStateName, Color> = {
  idle: new Color(0x6b7280),
  rotate: new Color(0xf5d90a),
  engage: new Color(0xff3b3b),
  reposition: new Color(0xff8c1a),
  retreat: new Color(0x3ba7ff),
}
const HEAD_COLOR = new Color(0xe6e8ec)

export interface BotsRenderer {
  /** Sincroniza posición, orientación y color de cada bot con su estado real.
   *  Llamar una vez por frame, después de stepAllBotsMotor(). */
  sync(bots: readonly BotState[]): void
  dispose(): void
}

export function createBotsRenderer(scene: Scene, bots: readonly BotState[]): BotsRenderer {
  const group = new Group()
  // CapsuleGeometry(radio, largo_del_cilindro, ...): el largo excluye las
  // dos tapas semiesféricas, así que para que la altura TOTAL coincida con
  // PLAYER_CAPSULE.height hay que restar los dos radios.
  const bodyGeometry = new CapsuleGeometry(
    PLAYER_CAPSULE.radius,
    PLAYER_CAPSULE.height - PLAYER_CAPSULE.radius * 2,
    4,
    8,
  )
  const headGeometry = new SphereGeometry(BOTS.headRadius, 8, 6)

  const bodyMeshes: Mesh[] = []
  const headMeshes: Mesh[] = []
  const bodyMaterials: MeshBasicMaterial[] = []
  const headMaterials: MeshBasicMaterial[] = []

  for (let i = 0; i < bots.length; i++) {
    const bodyMaterial = new MeshBasicMaterial({ color: STATE_COLOR.idle })
    const headMaterial = new MeshBasicMaterial({ color: HEAD_COLOR })
    bodyMaterials.push(bodyMaterial)
    headMaterials.push(headMaterial)

    const body = new Mesh(bodyGeometry, bodyMaterial)
    const head = new Mesh(headGeometry, headMaterial)
    group.add(body)
    group.add(head)
    bodyMeshes.push(body)
    headMeshes.push(head)
  }

  scene.add(group)

  return {
    sync(current: readonly BotState[]): void {
      const n = Math.min(current.length, bodyMeshes.length)
      for (let i = 0; i < n; i++) {
        const bot = current[i]
        const body = bodyMeshes[i]
        const head = headMeshes[i]

        const alive = bot.health.alive
        body.visible = alive
        head.visible = alive
        if (!alive) continue

        const centerY = bot.player.position.y + PLAYER_CAPSULE.height / 2
        body.position.set(bot.player.position.x, centerY, bot.player.position.z)
        // Sólo yaw: la cápsula no tiene "cara" que rotar en pitch, y hacerlo
        // giraría el cilindro de costado sin sentido visual.
        body.rotation.set(0, bot.aimMotor.yaw, 0)

        const headHitbox = bot.hitboxes[1]
        head.position.set(headHitbox.center.x, headHitbox.center.y, headHitbox.center.z)

        bodyMaterials[i].color.copy(STATE_COLOR[bot.fsm.current] ?? STATE_COLOR.idle)
      }
      for (let i = n; i < bodyMeshes.length; i++) {
        bodyMeshes[i].visible = false
        headMeshes[i].visible = false
      }
    },

    dispose(): void {
      bodyGeometry.dispose()
      headGeometry.dispose()
      for (const m of bodyMaterials) m.dispose()
      for (const m of headMaterials) m.dispose()
      scene.remove(group)
    },
  }
}
