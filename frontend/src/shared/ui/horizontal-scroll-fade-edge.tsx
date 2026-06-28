import { cn } from "@/shared/lib/utils";

interface HorizontalScrollFadeEdgeProps {
  visible: boolean;
  className?: string;
}

export function HorizontalScrollFadeEdge({
  visible,
  className,
}: HorizontalScrollFadeEdgeProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute -right-px bottom-1 top-0 z-20 w-24 bg-linear-to-l from-background from-20% via-background/55 via-60% to-transparent transition-opacity duration-150",
        className,
      )}
      style={{ opacity: visible ? 1 : 0 }}
    />
  );
}
