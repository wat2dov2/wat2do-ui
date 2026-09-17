import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { COARSE_POINTER_MEDIA } from "@/shared/hooks/useCoarsePointer"
import { cn } from "@/shared/lib/utils"
import { useTranslation } from "react-i18next"
import { Button } from "@/shared/ui/button"
import { ChevronLeft, ChevronRight, type LucideIcon } from "@/shared/ui/doodle-icons"

/**
 * The open drawer's content element, or null outside a drawer.
 *
 * A drawer locks scrolling to its own subtree, so any overlay that portals to
 * `document.body` lands outside the lock and stops scrolling entirely. Overlays
 * portal into this node instead when there is one, which also lets the drawer's
 * drag handler recognise them as scrollable rather than as a dismiss gesture.
 */
const DrawerContentNodeContext = React.createContext<HTMLElement | null>(null)

export function useDrawerPortalContainer(): HTMLElement | null {
  return React.useContext(DrawerContentNodeContext)
}

function Drawer({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return (
    <DrawerPrimitive.Root
      data-slot="drawer"
      repositionInputs={false}
      {...props}
    />
  )
}

function DrawerPortal({
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DrawerPrimitive.Overlay
    ref={ref}
    data-slot="drawer-overlay"
    className={cn(
      "fixed inset-0 z-modal bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
DrawerOverlay.displayName = "DrawerOverlay"

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DrawerPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DrawerPrimitive.Content> & { size?: "default" | "wide" }
>(({ className, children, size = "default", ...props }, ref) => {
  // Opening a drawer moves focus to the first focusable child. When that is a
  // text field on a touch device, the keyboard opens and the browser scales the
  // page into the field before the user has chosen to type. Hold focus outside
  // on coarse pointers; the drawer stays modal either way, and a caller that
  // genuinely wants a field focused can pass its own handler through props.
  const handleOpenAutoFocus = React.useCallback((event: Event) => {
    if (!window.matchMedia(COARSE_POINTER_MEDIA).matches) return
    event.preventDefault()
  }, [])

  // State, not a ref: descendants must re-render once the node exists so their
  // portals mount inside it rather than falling back to the document body.
  const [contentNode, setContentNode] = React.useState<HTMLElement | null>(null)
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      setContentNode(node)
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )

  return (
      <DrawerPortal data-slot="drawer-portal">
        <DrawerOverlay />
        <DrawerPrimitive.Content
          ref={setRefs}
          data-slot="drawer-content"
          onOpenAutoFocus={handleOpenAutoFocus}
          className={cn(
            "group/drawer-content fixed z-modal flex h-auto flex-col overflow-hidden bg-background",
            "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0 data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh] data-[vaul-drawer-direction=top]:rounded-b-xl data-[vaul-drawer-direction=top]:border-b",
            "data-[vaul-drawer-direction=bottom]:bottom-0 data-[vaul-drawer-direction=bottom]:left-1/2 data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:max-w-screen-md data-[vaul-drawer-direction=bottom]:-translate-x-1/2 data-[vaul-drawer-direction=bottom]:mt-16 data-[vaul-drawer-direction=bottom]:max-h-[85dvh] data-[vaul-drawer-direction=bottom]:rounded-t-xl data-[vaul-drawer-direction=bottom]:border-t",
            "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0 data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:sm:max-w-sm",
            "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0 data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:sm:max-w-sm",
            size === "wide" && "data-[vaul-drawer-direction=bottom]:max-w-screen-2xl lg:data-[vaul-drawer-direction=bottom]:h-[85dvh]",
            className
          )}
          {...props}
        >
          <div
            data-slot="drawer-handle"
            className="mx-auto mt-4 hidden h-2 w-24 shrink-0 rounded-full bg-muted group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
          />
          <DrawerContentNodeContext.Provider value={contentNode}>
            {children}
          </DrawerContentNodeContext.Provider>
        </DrawerPrimitive.Content>
      </DrawerPortal>
  )
})
DrawerContent.displayName = "DrawerContent"

function DrawerHeader({ className, children, navigation, icon: Icon, ...props }: React.ComponentProps<"div"> & {
  navigation?: { previous?: () => void; next?: () => void }
  icon?: LucideIcon
}) {
  const { t } = useTranslation()
  const container = useDrawerPortalContainer()
  React.useEffect(() => {
    if (!navigation || !container) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      const target = event.target
      if (target instanceof Element && target.closest('input,textarea,select,[contenteditable=true],[role=combobox],[role=listbox],[role=menu]')) return
      const dialogs = document.querySelectorAll('[role=dialog][data-state=open]')
      if (dialogs.length && dialogs[dialogs.length - 1] !== container) return
      const navigate = event.key === "ArrowLeft" ? navigation.previous : event.key === "ArrowRight" ? navigation.next : undefined
      if (navigate) { event.preventDefault(); navigate() }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [container, navigation])
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-0.5 p-4 text-center group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center group-data-[vaul-drawer-direction=top]/drawer-content:text-center md:gap-1.5",
        className
      )}
      {...props}
    >
      {Icon ? (
        <div data-slot="drawer-header-icon" aria-hidden="true" className="mx-auto mb-1 flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
      ) : null}
      {navigation ? (
        <div className="flex items-start justify-between gap-3">
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="icon" aria-label={t("admin.previous")} disabled={!navigation.previous} onClick={navigation.previous}><ChevronLeft /></Button>
            <Button variant="outline" size="icon" aria-label={t("admin.next")} disabled={!navigation.next} onClick={navigation.next}><ChevronRight /></Button>
          </div>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      ) : children}
    </div>
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn("mt-auto flex shrink-0 flex-col gap-4 p-4 sm:p-6", className)}
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
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
}
