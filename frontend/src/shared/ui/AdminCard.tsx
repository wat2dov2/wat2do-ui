import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { ArrowRight } from "@/shared/ui/doodle-icons";

interface AdminCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  onMouseDown?: () => void;
  className?: string;
}

export function AdminCard({
  icon: Icon,
  title,
  description,
  onMouseDown,
  className = "",
}: AdminCardProps) {
  const baseClasses = "bg-secondary hover:bg-secondary-hover rounded-xl p-6 flex flex-col items-start gap-3 transition-colors text-left border border-border";

  const Component = onMouseDown ? "button" : "div";

  return (
    <Component
      onMouseDown={onMouseDown}
      className={`${baseClasses} ${className}`}
    >
      <div className="size-10 rounded-lg bg-primary/20 flex items-center justify-center">
        <Icon className="size-5 text-primary" />
      </div>
      <div className="flex-1">
        <h3 className="font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {onMouseDown && <ArrowRight className="size-4 text-muted-foreground" />}
    </Component>
  );
}
