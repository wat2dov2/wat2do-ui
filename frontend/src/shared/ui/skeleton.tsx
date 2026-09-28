import { cn } from "@/shared/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="skeleton"
      className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  );
}
