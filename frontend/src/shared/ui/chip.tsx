import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/shared/lib/utils";
import {
  createAdaptivePressHandlers,
  useMobileGridClickActivation,
} from "@/shared/hooks/useMouseDownPress";

const chipVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-all cursor-pointer select-none outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 shrink-0",
  {
    variants: {
      active: {
        true: "bg-foreground text-background hover:bg-foreground dark:bg-[#e7e5e4] dark:text-[#1c1917] dark:hover:bg-[#e7e5e4]",
        false:
          "bg-secondary text-muted-foreground hover:bg-muted/60 dark:hover:bg-muted/60",
      },
      size: {
        sm: "px-1.5 py-0.5 text-[10px] rounded-md gap-1",
        md: "px-3 py-1.5 text-xs rounded-xl",
        lg: "px-3 py-2.5 text-xs rounded-xl",
      },
    },
    defaultVariants: {
      active: false,
      size: "md",
    },
  }
);

export interface ChipProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof chipVariants> {
  asChild?: boolean;
  icon?: React.ReactNode;
}

const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  (
    {
      className,
      active,
      size,
      asChild = false,
      icon,
      onClick,
      onMouseDown,
      disabled,
      type = "button",
      children,
      ...props
    },
    ref
  ) => {
    const Comp = asChild ? Slot : "button";
    const preferClick = useMobileGridClickActivation();
    const pressHandlers = createAdaptivePressHandlers({
      onMouseDown,
      onClick,
      disabled,
      preferClick,
    });

    return (
      <Comp
        ref={ref}
        type={asChild ? undefined : type}
        disabled={disabled}
        className={cn(chipVariants({ active, size }), className)}
        {...props}
        {...pressHandlers}
      >
        {icon && <span className="shrink-0 [&_svg]:size-3.5">{icon}</span>}
        {children}
      </Comp>
    );
  }
);

Chip.displayName = "Chip";

export { Chip, chipVariants };
