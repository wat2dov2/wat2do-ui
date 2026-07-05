import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";

import { cn } from "@/shared/lib/utils";
import { useExclusiveDisclosure } from "@/shared/hooks/useExclusiveDisclosure";
import { useMouseSelectDedup, useMobileGridClickActivation } from "@/shared/hooks/useMouseDownPress";

const TRAILING_CLICK_SWALLOW_MS = 300;

function registerTrailingClickSwallow() {
  const swallowTrailingClick = (clickEvent: MouseEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    cleanup();
  };

  const cleanup = () => {
    document.removeEventListener("click", swallowTrailingClick, true);
    window.clearTimeout(timeoutId);
  };

  document.addEventListener("click", swallowTrailingClick, true);
  const timeoutId = window.setTimeout(cleanup, TRAILING_CLICK_SWALLOW_MS);
}

function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  modal = false,
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
      modal={modal}
      open={exclusiveOpen}
      onOpenChange={setExclusiveOpen}
      {...props}
    />
  );
}

function DropdownMenuTrigger({
  onPointerDown,
  onClick,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  const preferClick = useMobileGridClickActivation();

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      onPointerDown?.(event);
      if (preferClick && event.isTrusted && !event.defaultPrevented) {
        event.preventDefault();
      }
    },
    [onPointerDown, preferClick],
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (preferClick && event.isTrusted && !event.defaultPrevented) {
        const button = event.currentTarget;
        const pointerEvent = new PointerEvent("pointerdown", {
          bubbles: true,
          cancelable: true,
          pointerType: "touch",
        });
        button.dispatchEvent(pointerEvent);
      }
    },
    [onClick, preferClick],
  );

  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      {...props}
    />
  );
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
  const { markMouseSelect, shouldSkipSelect } = useMouseSelectDedup();

  const handleMouseDown = React.useCallback(
    (event: React.MouseEvent<React.ElementRef<typeof DropdownMenuPrimitive.Item>>) => {
      onMouseDown?.(event);
      if (event.button !== 0 || event.defaultPrevented) {
        return;
      }

      event.preventDefault();
      markMouseSelect();
      onSelect?.(event.nativeEvent);
      registerTrailingClickSwallow();
    },
    [markMouseSelect, onMouseDown, onSelect],
  );

  const handleSelect = React.useCallback(
    (event: Event) => {
      if (shouldSkipSelect()) {
        return;
      }
      onSelect?.(event);
      registerTrailingClickSwallow();
    },
    [onSelect, shouldSkipSelect],
  );

  const handleClick = React.useCallback(
    (event: React.MouseEvent<React.ElementRef<typeof DropdownMenuPrimitive.Item>>) => {
      event.preventDefault();
    },
    [],
  );

  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
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
  registerTrailingClickSwallow,
};
