import { cn } from "@/shared/lib/utils";

function ShowcaseBlock({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-2", className)}>
      <p className="text-sm font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

export { ShowcaseBlock };
