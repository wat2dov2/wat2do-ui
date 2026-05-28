import { cn } from "@/shared/lib/utils";

interface LightRaysProps {
  className?: string;
}

export function LightRays({ className }: LightRaysProps) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 -z-10",
        "bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))]",
        "from-primary/20 via-transparent to-transparent",
        className
      )}
      aria-hidden="true"
    />
  );
}
