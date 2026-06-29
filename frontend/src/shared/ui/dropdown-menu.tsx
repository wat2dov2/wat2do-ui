import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "@/shared/lib/utils";
import { useExclusiveDisclosure } from "@/shared/hooks/useExclusiveDisclosure";

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [exclusiveOpen, setExclusiveOpen] = useExclusiveDisclosure({
    open,
    defaultOpen,
    onOpenChange,
  });

  return (
    <DropdownMenuPrimitive.Root
      data-slot="dropdown-menu"
      open={exclusiveOpen}
      onOpenChange={setExclusiveOpen}
      {...props}
    />
  );
}

function DropdownMenuTrigger({
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return <DropdownMenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />;
}

function DropdownMenuContent({
  className,
  onMouseDown,
  onPointerDown,
  sideOffset = 4,
  stopPropagation = false,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & {
  stopPropagation?: boolean;
}) {
  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<React.ElementRef<typeof DropdownMenuPrimitive.Content>>) => {
      onMouseDown?.(event);
      if (stopPropagation) {
        event.stopPropagation();
      }
    },
    [onMouseDown, stopPropagation],
  );
  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<React.ElementRef<typeof DropdownMenuPrimitive.Content>>) => {
      onPointerDown?.(event);
      if (stopPropagation) {
        event.stopPropagation();
      }
    },
    [onPointerDown, stopPropagation],
  );

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        sideOffset={sideOffset}
        onMouseDown={handleMouseDown}
        onPointerDown={handlePointerDown}
        className={cn(
          "bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-modal min-w-32 origin-(--radix-dropdown-menu-content-transform-origin) overflow-hidden rounded-xl border p-1 shadow-md",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

function DropdownMenuItem({
  className,
  inset,
  onMouseDown,
  onSelect,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean;
  variant?: "default" | "destructive";
}) {
  const handledMouseSelectRef = React.useRef(false);
  const preventedMouseSelectRef = React.useRef(false);

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<React.ElementRef<typeof DropdownMenuPrimitive.Item>>) => {
      onMouseDown?.(event);
      if (event.defaultPrevented || event.button !== 0 || !onSelect) return;

      const selectEvent = new Event("select", { cancelable: true });
      onSelect(selectEvent);
      handledMouseSelectRef.current = true;
      preventedMouseSelectRef.current = selectEvent.defaultPrevented;

      // Items select on pointer-down, but parent cards often activate on click.
      // When the menu unmounts before mouse-up, that click lands on the card.
      event.preventDefault();
      const swallowTrailingClick = (clickEvent: MouseEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        document.removeEventListener("click", swallowTrailingClick, true);
      };
      document.addEventListener("click", swallowTrailingClick, true);
      window.setTimeout(() => {
        document.removeEventListener("click", swallowTrailingClick, true);
      }, 0);
    },
    [onMouseDown, onSelect],
  );

  const handleSelect = React.useCallback(
    (event: Event) => {
      if (handledMouseSelectRef.current) {
        handledMouseSelectRef.current = false;
        if (preventedMouseSelectRef.current) {
          event.preventDefault();
          preventedMouseSelectRef.current = false;
        }
        return;
      }

      onSelect?.(event);
    },
    [onSelect],
  );

  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onMouseDown={handleMouseDown}
      onSelect={handleSelect}
      className={cn(
        "focus:bg-secondary focus:text-foreground data-[variant=destructive]:text-error data-[variant=destructive]:focus:bg-error/10 data-[variant=destructive]:focus:text-error relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-1.5 text-xs outline-hidden transition-colors data-disabled:pointer-events-none data-disabled:opacity-50 data-[inset=true]:pl-8 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
};
