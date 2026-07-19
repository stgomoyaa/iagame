import { Armoury } from '@/ui/Armoury'

export const metadata = {
  title: 'Armería · Arcade FPS',
  description: 'Elige tu primaria, tu secundaria y las skins con las que entras a la partida.',
}

// Ruta /armory según la sección 3 del spec (app/: /, /play, /armory, /career).
export default function ArmoryPage() {
  return <Armoury />
}
