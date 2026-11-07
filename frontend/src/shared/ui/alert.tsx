import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/lib/utils";

const alertVariants = cva(
  "relative grid grid-cols-[auto_1fr] items-start gap-x-3 rounded-xl border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4",
  {
    variants: {
      variant: {
        default: "border-border bg-surface text-foreground",
        info: "border-primary/20 bg-primary/10 text-foreground [&>svg]:text-primary",
        success: "border-success/20 bg-success/10 text-foreground [&>svg]:text-success",
        warning: "border-warning/20 bg-warning/10 text-foreground [&>svg]:text-warning",
        destructive:
          "border-destructive/20 bg-destructive/10 text-foreground [&>svg]:text-destructive",
      },
      // An overlay alert floats above content it must not move: as wide as its
      // text, and raised off the surface below it.
      placement: {
        inline: "w-full",
        overlay: "w-fit max-w-sm shadow-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      placement: "inline",
    },
  },
);

function Alert({
  className,
  variant,
  placement,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      role="alert"
      data-slot="alert"
      className={cn(alertVariants({ variant, placement }), className)}
      {...props}
    />
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn("col-start-2 font-semibold leading-none", className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "col-start-2 grid gap-1 text-muted-foreground [&_p]:leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

/** What the reader can do about the alert, under its text. */
function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("col-start-2 mt-2 flex", className)}
      {...props}
    />
  );
}

export {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
};
