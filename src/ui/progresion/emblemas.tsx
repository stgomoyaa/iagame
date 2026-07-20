'use client'

/**
 * Insignias de progresión: rangos, prestigios y medallas.
 *
 * Los tres se dibujan en SVG acá mismo, portados del diseño
 * (docs/design/progresion.dc.html). **Eso no es un placeholder a la espera
 * de los PNG**: es el respaldo permanente.
 *
 *
 * POR QUÉ LOS ICONOS SE MONTAN ENCIMA Y NO EN LUGAR DEL SVG
 *
 * Los 34 iconos (9 rangos, 10 prestigios, 15 medallas) se generan aparte y
 * todavía no existen. El enganche está listo, pero el orden importa:
 *
 * - Lo obvio sería `<img>` con `onError` que cambia a SVG. Eso muestra el
 *   ícono roto del navegador durante el instante entre que la request falla
 *   y React re-renderiza, y en algunos navegadores deja el alt-text feo.
 * - Acá el SVG se renderiza SIEMPRE como capa de abajo y el `<img>` va
 *   encima con `opacity:0`, subiendo a 1 sólo en `onLoad`. Si el archivo no
 *   está, el `<img>` nunca se muestra y nadie se entera: no hay estado
 *   intermedio roto, ni parpadeo, ni layout shift.
 *
 * El color del tier (`rankColor`) es lo que pinta el SVG, así que el
 * respaldo no es genérico: un Deidad sin PNG sigue siendo dorado y un
 * Hierro sigue siendo gris.
 */

import { useState } from 'react'
import { rankColor, rankName, TIERS } from '@/game/progression/ranks'
import type { MedalDef } from '@/game/progression/medals'

/**
 * CONTRATO DE NOMBRES DE ICONO. Lo consume el generador de assets.
 *
 * `public/assets/ui/<tamaño>/<nombre>.png`, con `<tamaño>` en `256` (héroes,
 * detalle) y `64` (grillas, filas). Ejemplos:
 *
 *   /assets/ui/256/rango-deidad.png
 *   /assets/ui/64/prestigio-07.png
 *   /assets/ui/64/medalla-headshot.png
 *
 * Si el generador termina usando otro esquema, se cambia acá y en ningún
 * otro lado: nadie más arma estas rutas.
 */
export type IconSize = 64 | 256

function iconUrl(nombre: string, size: IconSize): string {
  return `/assets/ui/${size}/${nombre}.png`
}

/** Slug de tier para el nombre de archivo: "Grand Master" -> "grand-master". */
export function tierSlug(tier: string): string {
  return tier
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
}

export function rankIconName(rankIndex: number): string {
  return `rango-${tierSlug(rankName(rankIndex).tier)}`
}

export function prestigeIconName(level: number): string {
  return `prestigio-${String(level).padStart(2, '0')}`
}

export function medalIconName(key: string): string {
  return `medalla-${key}`
}

/**
 * Capa de icono opcional. Ver la cabecera: se monta encima del respaldo y
 * sólo se hace visible si el archivo cargó de verdad.
 */
function CapaIcono({ nombre, size, alt }: { nombre: string; size: IconSize; alt: string }) {
  const [cargo, setCargo] = useState(false)

  // Se usa `<img>` y no `next/image` a propósito: el optimizador registra un
  // error en consola por cada archivo que no existe, y acá que no exista es
  // el caso NORMAL hasta que se generen los 34 iconos. Son PNG de 64/256px
  // ya dimensionados, así que no hay nada que optimizar, y el LCP de estas
  // pantallas no depende de ellos.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl(nombre, size)}
      alt={alt}
      width={size}
      height={size}
      onLoad={() => setCargo(true)}
      className="absolute inset-0 h-full w-full object-contain transition-opacity duration-150"
      style={{ opacity: cargo ? 1 : 0 }}
      aria-hidden={!cargo}
    />
  )
}

/**
 * Insignia de rango. `tier` es el índice 0..8 dentro de `TIERS` y decide
 * cuánta parafernalia lleva: alas desde Platino, corona desde Master, y de
 * una a tres gemas. Es la misma progresión visual del diseño, y no es
 * decorativa: hace que un rango alto se lea como alto sin leer el texto.
 */
export function RankEmblem({
  rankIndex,
  size = 46,
  animado = false,
}: {
  rankIndex: number
  size?: number
  animado?: boolean
}) {
  const color = rankColor(rankIndex)
  const nombre = rankName(rankIndex)
  const tier = TIERS.indexOf(nombre.tier)
  const gemas = Math.min(3, Math.floor(tier / 3) + 1)
  const alto = Math.round(size * 1.16)

  return (
    <span
      className="relative inline-block"
      style={{ width: size, height: alto }}
      title={nombre.label}
    >
      <svg
        viewBox="0 0 100 116"
        width={size}
        height={alto}
        className={animado ? 'pg-anim-glow block' : 'block'}
        style={{
          color,
          filter: `drop-shadow(0 0 ${animado ? 12 : 6}px ${color}${animado ? 'cc' : '77'})`,
        }}
        role="img"
        aria-label={`Insignia de ${nombre.label}`}
      >
        <polygon points="50,3 91,24 91,70 50,113 9,70 9,24" fill="#0a130e" stroke={color} strokeWidth={2} />
        <polygon points="50,12 82,29 82,66 50,100 18,66 18,29" fill="none" stroke={color} strokeOpacity={0.35} strokeWidth={1} />
        {tier >= 3 && (
          <>
            <path d="M9,32 L-1,27 L1,54 L9,60 Z" fill={color} fillOpacity={0.5} />
            <path d="M91,32 L101,27 L99,54 L91,60 Z" fill={color} fillOpacity={0.5} />
          </>
        )}
        {tier >= 6 && <path d="M30,15 L35,1 L44,12 L50,-1 L56,12 L65,1 L70,15 Z" fill={color} />}
        {Array.from({ length: gemas }, (_, g) => {
          const cy = gemas === 1 ? 56 : gemas === 2 ? 46 + g * 18 : 40 + g * 16
          return (
            <path
              key={g}
              d={`M50,${cy - 8} L58,${cy} L50,${cy + 8} L42,${cy} Z`}
              fill={g === 0 ? color : 'none'}
              stroke={color}
              strokeWidth={1.6}
              fillOpacity={0.9}
            />
          )
        })}
      </svg>
      <CapaIcono nombre={rankIconName(rankIndex)} size={size > 90 ? 256 : 64} alt={`Insignia de ${nombre.label}`} />
    </span>
  )
}

/**
 * Silueta de "todavía sin rango". Se usa mientras el jugador está en
 * colocaciones: no hay rango que mostrar y poner el de Hierro sería mentir
 * (ver la rama de colocación en Career).
 */
export function RankEmblemVacio({ size = 118 }: { size?: number }) {
  const g = 'var(--pg-pendiente)'
  return (
    <svg
      viewBox="0 0 100 116"
      width={size}
      height={Math.round(size * 1.16)}
      className="block"
      style={{ filter: 'drop-shadow(0 0 10px rgba(138,125,255,.4))' }}
      role="img"
      aria-label="Todavía sin rango"
    >
      <polygon points="50,3 91,24 91,70 50,113 9,70 9,24" fill="#0c0a1a" stroke={g} strokeWidth={2} strokeDasharray="4 4" />
      <polygon points="50,14 80,30 80,64 50,98 20,64 20,30" fill="none" stroke={g} strokeOpacity={0.4} strokeWidth={1} />
      <text x={50} y={66} fill={g} fontSize={34} textAnchor="middle" fontWeight={700} className="pg-mono">
        ?
      </text>
    </svg>
  )
}

/** Insignia de prestigio. Alas desde el V, estrella desde el VIII. */
export function PrestigeBadge({
  level,
  color,
  roman,
  size = 54,
  activo = false,
}: {
  level: number
  color: string
  roman: string
  size?: number
  activo?: boolean
}) {
  return (
    <span className="relative inline-block" style={{ width: size, height: size }}>
      <svg
        viewBox="-4 -4 108 108"
        width={size}
        height={size}
        className={activo && level === 10 ? 'pg-anim-glow block' : 'block'}
        style={{
          color,
          filter: `drop-shadow(0 0 ${activo ? 14 : 6}px ${color}${activo ? 'cc' : '55'})`,
        }}
        role="img"
        aria-label={`Insignia de Prestigio ${roman}`}
      >
        <polygon points="50,2 93,26 93,74 50,98 7,74 7,26" fill="#0a0d16" stroke={color} strokeWidth={2.4} />
        <polygon points="50,11 84,31 84,69 50,89 16,69 16,31" fill="none" stroke={color} strokeOpacity={0.4} strokeWidth={1} />
        {level >= 5 && (
          <>
            <path d="M7,34 L-3,29 L-1,58 L7,64 Z" fill={color} fillOpacity={0.55} />
            <path d="M93,34 L103,29 L101,58 L93,64 Z" fill={color} fillOpacity={0.55} />
          </>
        )}
        {level >= 8 && <path d="M50,-2 L54,8 L64,8 L56,15 L59,25 L50,19 L41,25 L44,15 L36,8 L46,8 Z" fill={color} />}
        <text
          x={50}
          y={62}
          fill={color}
          fontSize={roman.length > 2 ? 20 : 28}
          fontWeight={700}
          textAnchor="middle"
          className="pg-display"
        >
          {roman}
        </text>
      </svg>
      <CapaIcono nombre={prestigeIconName(level)} size={size > 90 ? 256 : 64} alt={`Insignia de Prestigio ${roman}`} />
    </span>
  )
}

/**
 * Medalla. `obtenida` la pinta con su color y un halo; sin obtener queda en
 * gris. `bloqueada` es un tercer estado que el diseño no tenía y que hizo
 * falta: una medalla que todavía no se puede conseguir porque su disparador
 * no existe (ver progression/medals.ts) no es lo mismo que una que no
 * sacaste, y mostrarlas iguales le prometería al jugador algo que hoy no
 * puede cumplir.
 */
export function MedalBadge({
  medalla,
  obtenida,
  size = 62,
}: {
  medalla: MedalDef
  obtenida: boolean
  size?: number
}) {
  const col = obtenida ? medalla.color : '#3a4a40'

  return (
    <span
      className="pg-hex relative inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: obtenida
          ? `radial-gradient(circle at 50% 35%, ${medalla.color}2e, #070d0a 70%)`
          : '#070d0a',
        border: `1px solid ${col}${obtenida ? '' : '55'}`,
        filter: obtenida ? `drop-shadow(0 0 8px ${medalla.color}66)` : 'none',
      }}
      role="img"
      aria-label={`${medalla.nombre}${obtenida ? ', obtenida' : ', sin obtener'}`}
    >
      <span
        className="pg-mono leading-none"
        style={{ color: col, fontSize: size * 0.42, opacity: obtenida ? 1 : 0.55 }}
        aria-hidden
      >
        {medalla.glyph}
      </span>
      <CapaIcono nombre={medalIconName(medalla.key)} size={size > 90 ? 256 : 64} alt="" />
    </span>
  )
}
