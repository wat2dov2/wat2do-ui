import * as React from "react"
import { useTranslation } from "react-i18next"
import { Drawer as DrawerPrimitive } from "vaul"
import { X } from "@/shared/ui/doodle-icons"

import { cn } from "@/shared/lib/utils"

const DRAWER_CLOSE_ANIMATION_MS = 280

/** Let the page receive touches while the drawer exit animation finishes. */
function releaseDrawerTouchCapture() {
  if (typeof document === "undefined") return

  document.documentElement.dataset.drawerScrollRelease = ""
  document.querySelectorAll("[data-vaul-drawer], [data-vaul-overlay]").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.style.pointerEvents = "none"
      node.style.touchAction = "pan-y"
    }
  })
}

function resetDrawerTouchCapture() {
  if (typeof document === "undefined") return

  delete document.documentElement.dataset.drawerScrollRelease
  document.querySelectorAll("[data-vaul-drawer], [data-vaul-overlay]").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.style.pointerEvents = ""
      node.style.touchAction = ""
    }
  })
}

/** Release scroll/pointer locks as soon as a drawer starts closing. */
function releaseDrawerScrollLock() {
  if (typeof document === "undefined") return

  const { body, documentElement: html } = document

  let scrollX = 0
  let scrollY = 0
  if (body.style.position === "fixed") {
    scrollY = -parseInt(body.style.top, 10) || 0
    scrollX = -parseInt(body.style.left, 10) || 0
  }

  body.style.pointerEvents = ""
  body.style.overflow = ""
  body.style.position = ""
  body.style.top = ""
  body.style.left = ""
  body.style.height = ""
  body.style.right = ""
  body.style.paddingRight = ""
  html.style.overflow = ""
  html.style.paddingRight = ""

  if (scrollY !== 0 || scrollX !== 0) {
    requestAnimationFrame(() => {
      window.scrollTo(scrollX, scrollY)
    })
  }
}

function isNestedPortalTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest("[data-pie-menu]") ||
      target.closest("[data-slot='dropdown-menu-content']") ||
      target.closest("[data-slot='dropdown-menu-trigger']") ||
      target.closest("[aria-haspopup='menu']") ||
      target.closest("[data-slot='popover-content']") ||
      target.closest("[data-slot='popover-trigger']") ||
      target.closest("[aria-haspopup='dialog']")
  )
}

function Drawer({
  onOpenChange,
  onClose,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  const handleClose = React.useCallback(() => {
    releaseDrawerTouchCapture()
    onClose?.()
  }, [onClose])

  const handleOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) {
        releaseDrawerTouchCapture()
        queueMicrotask(() => {
          releaseDrawerScrollLock()
        })
        window.setTimeout(() => {
          resetDrawerTouchCapture()
        }, DRAWER_CLOSE_ANIMATION_MS)
      }
      onOpenChange?.(open)
    },
    [onOpenChange],
  )

  React.useEffect(() => {
    if (props.open) {
      resetDrawerTouchCapture()
    }
  }, [props.open])

  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      onOpenChange={handleOpenChange}
      onClose={handleClose}
      {...props}
    />
  )
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

export const drawerCloseButtonClassName =
  "pointer-events-auto touch-manipulation absolute right-3 top-3 z-50 flex size-9 items-center justify-center rounded-xl bg-background/90 text-foreground opacity-80 shadow-sm transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    data-slot="drawer-overlay"
    className={cn(
      "fixed inset-0 z-modal bg-black/50 [animation-duration:280ms] data-[state=closed]:pointer-events-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    onMouseDown={(event) => {
      if (isNestedPortalTarget(event.target)) {
        event.stopPropagation()
      }
    }}
    {...props}
  />
))
DrawerOverlay.displayName = "DrawerOverlay"

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & {
    hideClose?: boolean
  }
>(({ className, children, hideClose = false, ...props }, ref) => {
  const { t } = useTranslation()

  return (
  <DrawerPortal data-slot="drawer-portal">
    <DrawerOverlay />
    <DrawerPrimitive.Content
      ref={ref}
      data-slot="drawer-content"
      className={cn(
        "group/drawer-content fixed z-modal flex h-auto flex-col bg-background [animation-duration:280ms] data-[state=closed]:pointer-events-none",
        "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b",
        "data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:left-1/2 data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:max-w-screen-md data-[vaul-drawer-direction=bottom]:-translate-x-1/2 data-[vaul-drawer-direction=bottom]:mt-16 data-[vaul-drawer-direction=bottom]:max-h-[92dvh] data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t",
        "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm",
        "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm",
        className
      )}
      onPointerDownOutside={(event) => {
        if (isNestedPortalTarget(event.target)) {
          event.preventDefault()
        }
      }}
      onInteractOutside={(event) => {
        if (isNestedPortalTarget(event.target)) {
          event.preventDefault()
        }
      }}
      onFocusOutside={(event) => {
        if (isNestedPortalTarget(event.target)) {
          event.preventDefault()
        }
      }}
      {...props}
    >
      <div
        data-slot="drawer-handle"
        className="mx-auto mt-4 hidden h-1.5 w-12 shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
      />
      {children}
      {!hideClose && (
        <DrawerClose asChild>
          <button
            type="button"
            className={drawerCloseButtonClassName}
            aria-label={t("common.close")}
          >
            <X className="size-4" />
          </button>
        </DrawerClose>
      )}
    </DrawerPrimitive.Content>
  </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 text-center group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("text-lg leading-none font-semibold text-foreground", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
