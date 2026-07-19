import Link from 'next/link'

// Placeholder hasta que llegue la UI real (fase posterior del spec, sección
// de rutas: /, /play, /armory, /career). Hoy sólo /play existe: el único
// trabajo de esta página es no dejarla huérfana detrás de una URL que nadie
// conoce.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-[#05070b] px-6 text-center">
      <p className="font-mono text-xs tracking-[0.2em] text-[#e6e8ec]/50 uppercase">
        Arcade FPS
      </p>
      <h1 className="mt-3 max-w-md text-3xl font-semibold text-[#e6e8ec]">
        Corre en el navegador, sin instalar nada.
      </h1>
      <p className="mt-4 max-w-sm text-[#e6e8ec]/70">
        Movimiento rápido, salto encadenado y un arsenal todavía en construcción.
      </p>
      <Link
        href="/play"
        className="mt-10 rounded border border-[#19e5e5]/40 px-6 py-3 font-mono text-sm text-[#19e5e5] transition-colors hover:border-[#19e5e5] hover:bg-[#19e5e5]/10 focus-visible:border-[#19e5e5] focus-visible:bg-[#19e5e5]/10 focus-visible:outline-none"
      >
        Jugar
      </Link>
    </main>
  )
}
