import { ComponentGallery } from './ComponentGallery'
import { CorkDefs, CORK_FILTER_ID, PushPin } from './cork/primitives'

export function StickerSheet() {
  return (
    <div className="min-h-svh bg-[#2a1f18] px-3 py-6 text-ink sm:px-5 sm:py-10">
      <CorkDefs />

      <div className="mx-auto max-w-5xl">
        <div
          className={[
            'rounded-md p-2 sm:p-3',
            'bg-linear-to-b from-[#5c3d2e] via-[#4a3228] to-[#3d281f]',
            'shadow-[0_25px_50px_-12px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)]',
            'ring-1 ring-black/40',
          ].join(' ')}
        >
          <div className="rounded-sm bg-[#2d1f17] p-1 shadow-[inset_0_2px_8px_rgba(0,0,0,0.5)]">
            <div className="relative min-h-[min(100vh,920px)] overflow-hidden rounded-sm">
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundColor: '#b8936a',
                  backgroundImage: [
                    'radial-gradient(ellipse 120% 80% at 15% 25%, rgba(212, 175, 120, 0.55) 0%, transparent 50%)',
                    'radial-gradient(ellipse 90% 70% at 85% 15%, rgba(160, 110, 65, 0.35) 0%, transparent 45%)',
                    'radial-gradient(ellipse 70% 50% at 70% 80%, rgba(100, 65, 40, 0.2) 0%, transparent 40%)',
                    'radial-gradient(ellipse 50% 35% at 30% 60%, rgba(200, 160, 110, 0.4) 0%, transparent 35%)',
                    'radial-gradient(ellipse 40% 30% at 50% 50%, rgba(140, 95, 55, 0.15) 0%, transparent 25%)',
                  ].join(', '),
                  filter: `url(#${CORK_FILTER_ID})`,
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.55] mix-blend-multiply"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.6'/%3E%3C/svg%3E")`,
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 opacity-[0.25] mix-blend-overlay"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 128 128' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='f'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.6' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23f)' opacity='0.7'/%3E%3C/svg%3E")`,
                }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 rounded-sm shadow-[inset_0_0_120px_rgba(40,25,15,0.4)]"
                aria-hidden
              />
              <div
                className="pointer-events-none absolute inset-0 rounded-sm bg-linear-to-br from-white/[0.07] via-transparent to-black/12"
                aria-hidden
              />

              <PushPin color="sky" className="absolute left-[6%] top-[8%] z-2 scale-75 opacity-90" />
              <PushPin color="coral" className="absolute right-[8%] top-[14%] z-2 scale-[0.65] opacity-85" />
              <PushPin color="sage" className="absolute bottom-[12%] left-[10%] z-2 scale-[0.7] opacity-80" />

              <div className="relative z-3 px-4 py-6 sm:px-6 sm:py-8">
                <header className="relative mx-auto mb-10 max-w-2xl -rotate-[0.8deg] transition-transform hover:rotate-0">
                  <div className="pointer-events-none absolute inset-x-8 top-[85%] h-16 rounded-[50%] bg-black/15 blur-xl" />
                  <div
                    className={[
                      'relative rounded-sm bg-[#FFFEF9]',
                      'shadow-[2px_3px_0_rgba(0,0,0,0.05),6px_12px_24px_rgba(30,20,10,0.22)]',
                      'ring-1 ring-black/7',
                    ].join(' ')}
                  >
                    <PushPin color="mustard" className="absolute left-[18%] top-0 z-10 -translate-y-1/2" />
                    <div className="px-6 py-6 sm:px-8 sm:py-7">
                      <p className="text-xs font-medium uppercase tracking-[0.25em] text-gray-500">
                        Design system essentials
                      </p>
                      <h1 className="mt-2 font-serif text-2xl tracking-tight text-ink sm:text-3xl">
                        Corkboard gallery
                      </h1>
                      <p className="mt-3 text-sm leading-relaxed text-gray-600">
                        Reusable primitives in{' '}
                        <code className="rounded bg-black/5 px-1.5 py-0.5 font-mono text-xs">
                          src/components/ui
                        </code>
                        — buttons, forms, overlays, and feedback. Excludes charts, data tables,
                        sidebars, OTP, etc.
                      </p>
                    </div>
                  </div>
                </header>

                <ComponentGallery />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
