import * as React from "react"
import Link from "next/link"

import { Stack } from "@/shared/layout/stack"
import { cn } from "@/shared/lib/utils"
import { Button } from "@/shared/ui/button"
import { ArrowLeft } from "@/shared/ui/doodle-icons"
import type { LucideIcon } from "@/shared/ui/doodle-icons"

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

type PageHeaderProps = React.ComponentProps<"header"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  actionsPlacement?: "back" | "heading"
  back?: PageHeaderBack
  icon?: LucideIcon
}

function PageHeader({
  title,
  description,
  actions,
  actionsPlacement = "back",
  back,
  icon: Icon,
  className,
  ...props
}: PageHeaderProps) {
  const backButton = back ? (
    "href" in back ? (
      <Button asChild variant="secondary" size="sm" data-slot="page-back">
        <Link href={back.href}>
          <ArrowLeft />
          {back.label}
        </Link>
      </Button>
    ) : (
      <Button
        type="button"
        variant="secondary"
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
            className="text-2xl font-semibold text-foreground"
          >
            {title}
          </h1>
        ) : null}
        {description ? (
          <p
            data-slot="page-header-description"
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
    <header data-slot="page-header" className={cn(className)} {...props}>
      <Stack gap={4}>
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
      </Stack>
    </header>
  )
}

export { PageHeader }
export type { PageHeaderBack, PageHeaderProps }
