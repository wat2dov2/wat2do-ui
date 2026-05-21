import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/shared/ui/button";
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
>(({ className, isLoading, loadingText, children, disabled, ...props }, ref) => {
  const { t } = useTranslation();
  const resolvedLoadingText = loadingText ?? t("common.pleaseWait");

  return (
    <Button
      ref={ref}
      className={cn(className)}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <Spinner className="size-4" aria-hidden />
          {resolvedLoadingText}
        </>
      ) : (
        children
      )}
    </Button>
  );
});

LoadingButton.displayName = "LoadingButton";
