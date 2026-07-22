/**
 * Global page background decoration: a stationary dotted grid plus a radial
 * glow whose centre sits on the bottom-left corner of the viewport.
 *
 * Mounted once in the root layout so every page inherits it - pages must never
 * add their own copy. The layer is fixed to the viewport at a negative z-index,
 * so it stays put while content scrolls and always paints below it. Tune the
 * look from the --page-* tokens in styles/decorative-tokens.css.
 */
function PageBackground() {
  return (
    <div
      data-slot="page-background"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="bg-page-dots absolute inset-0" />
      <div className="bg-page-glow absolute inset-0" />
    </div>
  )
}

export { PageBackground }
