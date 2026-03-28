import React from 'react'

/** Unique filter id so SSR/hydration stays stable */
export const CORK_FILTER_ID = 'cork-grain-filter'

export function CorkDefs() {
  return (
    <svg className="pointer-events-none absolute h-0 w-0 overflow-hidden" aria-hidden>
      <defs>
        <filter id={CORK_FILTER_ID} x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="4"
            stitchTiles="stitch"
            result="noise"
          />
          <feColorMatrix
            in="noise"
            type="matrix"
            values="0 0 0 0 0.42
                    0 0 0 0 0.30
                    0 0 0 0 0.16
                    0 0 0 0.38 0"
            result="coloredNoise"
          />
          <feBlend in="SourceGraphic" in2="coloredNoise" mode="multiply" />
        </filter>
      </defs>
    </svg>
  )
}

export function PushPin({
  color = 'coral',
  className = '',
}: {
  color?: 'coral' | 'mustard' | 'sage' | 'sky'
  className?: string
}) {
  const fill =
    color === 'mustard'
      ? '#E8A82E'
      : color === 'sage'
        ? '#8FBF6E'
        : color === 'sky'
          ? '#6BA8E8'
          : '#E86B52'

  return (
    <div className={`pointer-events-none ${className}`}>
      <svg width="44" height="52" viewBox="0 0 44 52" aria-hidden className="drop-shadow-md">
        <ellipse cx="22" cy="48" rx="5" ry="2" fill="rgba(0,0,0,0.22)" />
        <path
          d="M22 18 L22 46"
          stroke="rgba(60,40,20,0.55)"
          strokeWidth="1.2"
          strokeLinecap="round"
        />
        <circle cx="22" cy="16" r="12" fill={fill} />
        <circle cx="18" cy="12" r="4" fill="rgba(255,255,255,0.45)" />
        <ellipse cx="22" cy="18" rx="12" ry="10" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="1" />
      </svg>
    </div>
  )
}

export function DoodleBall({
  variant = 'beach',
  className,
}: {
  variant?: 'beach' | 'tennis' | 'basket'
  className?: string
}) {
  const palette =
    variant === 'tennis'
      ? { a: '#A9D18E', b: '#92C5F9', c: '#F48C76' }
      : variant === 'basket'
        ? { a: '#F1B457', b: '#F48C76', c: '#92C5F9' }
        : { a: '#92C5F9', b: '#F48C76', c: '#A9D18E' }

  return (
    <svg viewBox="0 0 140 140" className={className} aria-hidden="true" focusable="false">
      <path
        d="M70 13
           C93 12, 114 25, 124 45
           C135 66, 129 92, 114 110
           C99 128, 73 134, 52 127
           C30 120, 12 100, 12 74
           C12 47, 28 14, 70 13Z"
        fill="#FAF9F6"
        stroke="#2D2D2D"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M30 52
           C42 35, 60 24, 75 23
           C72 40, 64 62, 49 79
           C42 70, 34 61, 30 52Z"
        fill={palette.a}
        opacity="0.95"
      />
      <path
        d="M76 23
           C96 24, 112 38, 120 56
           C108 64, 92 71, 73 73
           C76 55, 78 39, 76 23Z"
        fill={palette.b}
        opacity="0.92"
      />
      <path
        d="M49 80
           C64 62, 72 40, 75 24
           C80 50, 79 74, 72 97
           C63 98, 55 93, 49 80Z"
        fill={palette.c}
        opacity="0.9"
      />
      <path
        d="M44 46 C50 38, 60 33, 67 33"
        fill="none"
        stroke="#ffffff"
        strokeWidth="5"
        strokeLinecap="round"
        opacity="0.85"
      />
      <path
        d="M30 52
           C45 67, 56 78, 72 97"
        fill="none"
        stroke="#2D2D2D"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M76 23
           C78 47, 76 61, 73 73"
        fill="none"
        stroke="#2D2D2D"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
    </svg>
  )
}

export function StickerPolaroid({
  title,
  subtitle,
  ball = 'beach',
  pinColor = 'mustard',
  polaroidId = 'ds',
  stagger = false,
  children,
}: {
  title: string
  subtitle?: string
  ball?: 'beach' | 'tennis' | 'basket'
  pinColor?: 'coral' | 'mustard' | 'sage' | 'sky'
  polaroidId?: string
  stagger?: boolean
  children: React.ReactNode
}) {
  const tilt =
    ball === 'tennis'
      ? '-rotate-[1.8deg]'
      : ball === 'basket'
        ? 'rotate-[2deg]'
        : 'rotate-[1.2deg]'

  return (
    <section
      className={[
        'group relative',
        'transition-transform duration-300 ease-out',
        tilt,
        stagger ? 'md:translate-y-5' : '',
        'hover:z-10 hover:rotate-0 hover:scale-[1.01]',
      ].join(' ')}
    >
      <div
        className="pointer-events-none absolute inset-x-4 top-[60%] h-24 rounded-[50%] bg-black/20 blur-2xl"
        aria-hidden
      />

      <div
        className={[
          'relative overflow-visible',
          'rounded-sm bg-[#FAFAF8]',
          'shadow-[2px_3px_0_rgba(0,0,0,0.06),8px_14px_28px_rgba(30,20,10,0.28),0_1px_0_rgba(255,255,255,0.9)_inset]',
          'ring-1 ring-black/8',
        ].join(' ')}
      >
        <PushPin
          color={pinColor}
          className="absolute left-1/2 top-0 z-30 -translate-x-1/2 -translate-y-1/2"
        />

        <div className="pointer-events-none absolute -left-3 top-10 z-10 -rotate-12 opacity-70">
          <div className="h-7 w-20 rounded-[2px] bg-[#F5E6D3]/90 shadow-sm ring-1 ring-black/5" />
        </div>

        <DoodleBall
          variant={ball}
          className="pointer-events-none absolute -right-5 -top-6 z-20 h-24 w-24 rotate-[8deg] opacity-[0.97] drop-shadow-[4px_8px_14px_rgba(0,0,0,0.15)] sm:h-28 sm:w-28"
        />

        <div className="relative px-5 pb-6 pt-9 sm:px-6 sm:pb-7 sm:pt-10">
          <div className="mb-4 rounded-md bg-linear-to-b from-[#FFFCF7] to-[#F5F0E8] p-4 shadow-[inset_0_0_0_1px_rgba(45,45,45,0.07),inset_0_2px_8px_rgba(255,255,255,0.6)]">
            <h2 className="font-serif text-xl text-ink">{title}</h2>
            {subtitle ? <p className="mt-1 text-sm text-gray-600">{subtitle}</p> : null}
          </div>
          <div className="rounded-md bg-[#F6F3ED] p-4 shadow-[inset_0_0_0_1px_rgba(45,45,45,0.06)]">
            {children}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-black/6 pt-3 text-[10px] uppercase tracking-[0.2em] text-gray-400">
            <span>Polaroid</span>
            <span className="font-mono tracking-normal">{polaroidId}</span>
          </div>
        </div>
      </div>
    </section>
  )
}
