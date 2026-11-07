"use client"

import type * as React from "react"
import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"

import { PageHeader } from "@/shared/layout/page-header"
import { PAGE_SHELLS, type PageShell } from "@/shared/constants/pageShells"
import { ROUTES } from "@/shared/constants/routes"

const BACK_LINKS = {
  admin: { href: ROUTES.ADMIN, labelKey: "admin.backToDashboard" },
  clubPanel: { href: ROUTES.CLUB_PANEL, labelKey: "clubPanel.backToPanel" },
  events: { href: ROUTES.EVENTS, labelKey: "events.allEvents" },
  positions: { href: ROUTES.POSITIONS, labelKey: "navigation.positions" },
  clubs: { href: ROUTES.CLUBS, labelKey: "clubs.allClubs" },
} as const satisfies Record<NonNullable<PageShell["back"]>, { href: string; labelKey: string }>

interface PageShellHeaderProps {
  /** The route whose shell (icon, title, description, back link) this header shows. */
  route: string
  /** Data-dependent copy that replaces the shell's once it exists. */
  title?: React.ReactNode
  description?: React.ReactNode
  icon?: LucideIcon
  actions?: React.ReactNode
}

/**
 * A page's header, drawn from its shell in PAGE_SHELLS. The route's loading
 * state renders this same component, so a page and its skeleton share a header.
 */
export function PageShellHeader({ route, title, description, icon, actions }: PageShellHeaderProps) {
  const { t } = useTranslation()
  const shell = PAGE_SHELLS[route]
  const back = shell.back ? BACK_LINKS[shell.back] : undefined

  return (
    <PageHeader
      icon={icon ?? shell.icon}
      title={title ?? t(shell.titleKey)}
      description={description ?? (shell.descriptionKey ? t(shell.descriptionKey) : undefined)}
      back={back ? { href: back.href, label: t(back.labelKey) } : undefined}
      actions={actions}
    />
  )
}
