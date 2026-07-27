"use client"

import { useSyncExternalStore, type CSSProperties } from "react"

import {
  ORGANIZATION_CATEGORY_STYLE_SLUGS,
  getOrganizationCategoryConfig,
} from "@/shared/data/organizationCategoryStyles"
import {
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  getSchoolColors,
} from "@/shared/constants/schools"

const PAGE_DOODLE_ICON_OPTIONS = ORGANIZATION_CATEGORY_STYLE_SLUGS.map(
  (slug) => getOrganizationCategoryConfig(slug).icon,
)

const PAGE_DOODLE_ICONS = (() => {
  const icons = Array.from(
    { length: 72 },
    (_, index) => PAGE_DOODLE_ICON_OPTIONS[index % PAGE_DOODLE_ICON_OPTIONS.length],
  )

  // A stable shuffle looks random without changing between server and client.
  let seed = 853
  for (let index = icons.length - 1; index > 0; index -= 1) {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
    const randomIndex = seed % (index + 1)
    const currentIcon = icons[index]
    icons[index] = icons[randomIndex]
    icons[randomIndex] = currentIcon
  }

  return icons
})()

const DEFAULT_SCHOOL_COLORS = getSchoolColors(DEFAULT_SCHOOL)

function subscribeToHostname(): () => void {
  return () => undefined
}

function getBrowserSchoolColors() {
  const school = getHostnameSchoolStatus(window.location.hostname).school
  return getSchoolColors(school)
}

/**
 * Global page background decoration: a tilted field of category doodles plus
 * a school-colour glow whose centre sits on the bottom-left viewport corner.
 */
function PageBackground() {
  const schoolColors = useSyncExternalStore(
    subscribeToHostname,
    getBrowserSchoolColors,
    () => DEFAULT_SCHOOL_COLORS,
  )

  return (
    <div
      data-slot="page-background"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={
        {
          "--page-school-primary": schoolColors.primary,
          "--page-school-secondary": schoolColors.ink,
        } as CSSProperties
      }
    >
      <div className="page-doodle-grid">
        {PAGE_DOODLE_ICONS.map((icon, index) => (
          <span
            key={`${icon}-${index}`}
            className="page-doodle-icon"
            style={{ "--page-doodle-icon": `url("${icon}")` } as CSSProperties}
          />
        ))}
      </div>
      <div className="bg-page-glow absolute inset-0" />
    </div>
  )
}

export { PageBackground }
