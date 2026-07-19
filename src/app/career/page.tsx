import { Career } from '@/ui/Career'

export const metadata = {
  title: 'Carrera · Arcade FPS',
  description: 'Tu rango, tu RR, tu nivel de cuenta y contra qué bots estás jugando.',
}

// Ruta /career según la sección 3 del spec (app/: /, /play, /armory, /career).
export default function CareerPage() {
  return <Career />
}
