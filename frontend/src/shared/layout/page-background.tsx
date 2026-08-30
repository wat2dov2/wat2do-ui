/**
 * Global page background decoration: one school-colour glow in the bottom-left
 * corner.
 */
function PageBackground() {
  return (
    <div
      data-slot="page-background"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="bg-page-glow absolute inset-0" />
    </div>
  )
}

export { PageBackground }
