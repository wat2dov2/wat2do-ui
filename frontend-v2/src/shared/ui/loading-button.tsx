import * as React from "react";
import { Button, buttonVariants } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import { cn } from "@/shared/lib/utils";

interface LoadingButtonProps
  extends React.ComponentProps<typeof Button> {
  isLoading?: boolean;
  loadingText?: string;
}

export const LoadingButton = React.forwardRef<
  HTMLButtonElement,
  LoadingButtonProps
>(({ className, isLoading, loadingText = "Please wait...", children, disabled, ...props }, ref) => (
  <Button
    ref={ref}
    className={cn(className)}
    disabled={disabled || isLoading}
    {...props}
  >
    {isLoading ? (
      <>
        <Spinner className="size-4" aria-hidden />
        {loadingText}
      </>
    ) : (
      children
    )}
  </Button>
));

LoadingButton.displayName = "LoadingButton";
