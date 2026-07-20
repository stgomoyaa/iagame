import { MatchSetup } from '@/ui/MatchSetup'

// El menú es la pantalla de configuración de partida: lo que hay entre abrir
// el juego y disparar (ui/MatchSetup.tsx). Antes esta ruta era un placeholder
// con dos botones; ahora es donde el jugador elige partida o ranked, mapa y
// tamaño de equipo, y de acá se lanza a /play con esa configuración en la URL.
export default function Home() {
  return <MatchSetup />
}
