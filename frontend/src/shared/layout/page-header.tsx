import * as React from "react"
import Link from "next/link"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { ArrowLeft } from "lucide-react"
import type { LucideIcon } from "lucide-react"

type PageHeaderBack =
  | {
      label: React.ReactNode
      href: React.ComponentProps<typeof Link>["href"]
      onClick?: never
    }
  | {
      label: React.ReactNode
      href?: never
      onClick: () => void
    }

// Omit the HTML "title" attribute so our ReactNode title is not narrowed to string.
type PageHeaderProps = Omit<React.ComponentProps<"header">, "title"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  actionsPlacement?: "back" | "heading"
  back?: PageHeaderBack
  icon?: LucideIcon
  variant?: "default" | "listing"
}

function PageHeader({
  title,
  description,
  actions,
  actionsPlacement = "back",
  back,
  icon: Icon,
  variant = "default",
  children,
  className,
  ...props
}: PageHeaderProps) {
  const backButton = back ? (
    "href" in back ? (
      <Button asChild variant="outline" size="sm" data-slot="page-back" data-skeleton-key="page-back">
        <Link href={back.href}>
          <ArrowLeft />
          {back.label}
        </Link>
      </Button>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-slot="page-back"
        onClick={back.onClick}
      >
        <ArrowLeft />
        {back.label}
      </Button>
    )
  ) : null

  const heading = title || description || Icon ? (
    <Stack direction="horizontal" gap={3} align="center">
      {Icon ? (
        <Stack
          direction="horizontal"
          align="center"
          justify="center"
          className="size-12 shrink-0 rounded-full bg-primary/20 text-primary"
        >
          <Icon className="size-6" />
        </Stack>
      ) : null}
      <Stack direction="vertical" gap={1}>
        {title ? (
          <h1
            data-slot="page-header-title"
            data-skeleton-key="page-title"
            className="text-2xl font-semibold text-foreground"
          >
            {title}
          </h1>
        ) : null}
        {description ? (
          <p
            data-slot="page-header-description"
            data-skeleton-key="page-description"
            className="text-muted-foreground"
          >
            {description}
          </p>
        ) : null}
      </Stack>
    </Stack>
  ) : null

  const actionGroup = actions ? (
    <Stack
      data-slot="page-header-actions"
      data-skeleton-key="page-actions"
      direction="horizontal"
      gap={2}
      align="center"
      wrap
    >
      {actions}
    </Stack>
  ) : null
  const actionsBesideBack = Boolean(back && actionsPlacement === "back")

  return (
    <header
      data-slot="page-header"
      data-variant={variant}
      // Paint beyond the page gutters without widening or moving the header controls. A listing
      // header sits flush with the top of the scroller: PageFrame drops its top padding for it
      // (a negative margin cannot do this, since a sticky box never rises above the scroller's padding),
      // so the header's own small top padding is all the room under the navigation.
      // A viewport layout never scrolls beneath the header, so it drops that backdrop
      // and pulls its content up beneath the last header row (the filter bar).
      className={cn(variant === "listing" && "sticky top-0 z-20 isolate m-0 shrink-0 bg-background pt-5 pb-2 before:pointer-events-none before:absolute before:inset-y-0 before:left-1/2 before:-z-10 before:w-screen before:-translate-x-1/2 before:bg-background before:content-[''] in-data-[page-layout=viewport]:-mb-15 in-data-[page-layout=viewport]:bg-transparent in-data-[page-layout=viewport]:before:hidden", className)}
      {...props}
    >
      <Stack gap={variant === "listing" ? 3 : 4}>
        {back ? (
          <Stack
            direction="horizontal"
            gap={3}
            align="center"
            justify="between"
            wrap
          >
            {backButton}
            {actionsBesideBack ? actionGroup : null}
          </Stack>
        ) : null}
        {heading || (!actionsBesideBack && actionGroup) ? (
          <Stack
            direction="horizontal"
            gap={4}
            align="start"
            justify="between"
            wrap
          >
            {heading}
            {!actionsBesideBack ? actionGroup : null}
          </Stack>
        ) : null}
        {children}
      </Stack>
    </header>
  )
}

export { PageHeader }
export type { PageHeaderBack, PageHeaderProps }
