import { cn } from "@/shared/lib/utils";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded bg-gray-200/80 dark:bg-muted/80", className)}
      {...props}
    />
  );
}
