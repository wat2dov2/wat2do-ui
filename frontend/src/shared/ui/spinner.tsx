import * as React from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/shared/lib/utils";

type SpinnerProps = React.ComponentProps<"svg">;

const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(
  ({ className, ...props }, ref) => {
    const { t } = useTranslation();

    return (
      <Loader2
        ref={ref}
        role="status"
        aria-label={props["aria-label"] ?? t("common.loadingStatus")}
        className={cn("size-4 animate-spin", className)}
        {...props}
      />
    );
  }
);
Spinner.displayName = "Spinner";

export { Spinner };
