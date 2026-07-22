import { cn } from "@/shared/lib/utils";

interface OnboardingDemoPillProps {
  label: string;
  selected?: boolean;
  onClick: () => void;
  className?: string;
}

export function OnboardingDemoPill({
  label,
  selected = false,
  onClick,
  className,
}: OnboardingDemoPillProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "rounded-full border px-4 py-2 text-sm transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        selected
          ? "border-primary bg-primary/10 text-primary font-medium"
          : "border-border bg-background text-foreground hover:bg-secondary-hover",
        className
      )}
    >
      {label}
    </button>
  );
}

interface OnboardingDemoPillGroupProps {
  children: React.ReactNode;
  label: string;
  className?: string;
}

export function OnboardingDemoPillGroup({
  children,
  label,
  className,
}: OnboardingDemoPillGroupProps) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {children}
    </div>
  );
}
