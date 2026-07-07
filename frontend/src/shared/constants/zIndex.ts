/**
 * Shared z-index scale for consistent layering across the app.
 *
 * Every global z-index value should reference this scale so that
 * the stacking order is explicit and discoverable in one place.
 *
 * The numeric values are also registered in index.css as Tailwind v4
 * theme tokens (`--z-index-*`), producing utility classes like
 * `z-dropdown`, `z-modal`, etc.  Both inline styles and Tailwind
 * classes stay in sync through these two parallel definitions.
 *
 * Layer hierarchy (lowest to highest):
 *   BASE        (0)   — default stacking context
 *   SIDEBAR     (30)  — side navigation panel
 *   NAV         (40)  — top navigation bar (above sidebar)
 *   DROPDOWN    (50)  — dropdowns, selects, popovers, tooltips
 *   MODAL       (60)  — dialog overlays and content
 *   TOAST       (70)  — toast notifications (above modals)
 *   EASTER_EGG  (80)  — full-screen fun overlays
 *   MAX         (100) — highest layer: easter-egg toasts
 */

export const Z_INDEX = {
  /** Default stacking context. */
  BASE: 0,

  /** Side navigation panel. */
  SIDEBAR: 30,

  /** Top navigation bar (sits above sidebar). */
  NAV: 40,

  /** Dropdowns, selects, popovers, tooltips, calendar pickers. */
  DROPDOWN: 50,

  /** Dialog / modal overlays and content. */
  MODAL: 60,

  /** Toast notifications — should float above modals. */
  TOAST: 70,

  /** Full-screen easter-egg animations. */
  EASTER_EGG: 80,

  /** Highest layer: easter-egg toast messages. */
  MAX: 100,
} as const;
