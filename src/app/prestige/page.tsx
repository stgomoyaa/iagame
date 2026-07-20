import { Prestigio } from '@/ui/Prestigio'

export const metadata = {
  title: 'Prestigio · Arcade FPS',
  description: 'La escalera de prestigio propuesta y tu progreso hacia el techo de nivel.',
}

// Ruta nueva de la fase 5. El sistema de prestigio todavía no existe: la
// pantalla lo dice explícitamente (ver game/progression/prestige.ts).
export default function PrestigePage() {
  return <Prestigio />
}
