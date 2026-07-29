import type { CSSProperties } from "react"

import {
  getOrganizationCategoryDoodleDecorations,
} from "@/shared/data/organizationCategoryStyles"

const PAGE_DOODLES = getOrganizationCategoryDoodleDecorations(72)

/**
 * Global page background decoration: a tilted field of category doodles plus
 * a school-colour glow whose centre sits on the bottom-left viewport corner.
 */
function PageBackground() {
  return (
    <div
      data-slot="page-background"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      <div className="page-doodle-grid">
        {PAGE_DOODLES.map((doodle, index) => (
          <span
            key={`${doodle.icon}-${index}`}
            className="page-doodle-icon"
            style={
              {
                "--doodle-icon": `url("${doodle.icon}")`,
                "--doodle-color": `var(--page-school-${doodle.color})`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="bg-page-glow absolute inset-0" />
    </div>
  )
}

export { PageBackground }
