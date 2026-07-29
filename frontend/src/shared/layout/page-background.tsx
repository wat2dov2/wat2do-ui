"use client"

import { useEffect, useSyncExternalStore, type CSSProperties } from "react"

import {
  getOrganizationCategoryDoodleDecorations,
} from "@/shared/data/organizationCategoryStyles"
import {
  DEFAULT_SCHOOL,
  getHostnameSchoolStatus,
  getSchoolColors,
} from "@/shared/constants/schools"

const PAGE_DOODLES = getOrganizationCategoryDoodleDecorations(72)

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

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty("--page-school-primary", schoolColors.primary)
    root.style.setProperty("--page-school-secondary", schoolColors.ink)

    return () => {
      root.style.removeProperty("--page-school-primary")
      root.style.removeProperty("--page-school-secondary")
    }
  }, [schoolColors])

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
