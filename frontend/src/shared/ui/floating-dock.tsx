import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";
import Link from "next/link";

export interface FloatingDockItem {
  title: string;
  icon: ReactNode;
  href?: string;
  onMouseDown?: () => void;
  isActive?: boolean;
}

/**
 * Shared navigation dock. Each hovered item expands its own layout box, so
 * neighbouring items still move aside without loading a runtime animation
 * engine into every public route.
 */
export const FloatingDock = ({
  items,
  desktopClassName,
}: {
  items: FloatingDockItem[];
  desktopClassName?: string;
}) => {
  return (
    <div
      className={cn(
        "relative z-10 mx-auto flex w-fit max-w-full items-end justify-center gap-4 px-2 sm:px-6",
        desktopClassName,
      )}
    >
      {items.map((item) => (
        <IconContainer key={item.title} item={item} />
      ))}
    </div>
  );
};

function IconContainer({
  item,
}: {
  item: FloatingDockItem;
}) {
  const { title, icon, href, onMouseDown, isActive } = item;

  const content = (
    <div
      className={cn(
        "relative flex size-11 items-center justify-center rounded-full transition-[width,height] duration-150 ease-out motion-reduce:transition-none group-hover:size-[76px] group-focus-visible:size-[76px]",
        isActive
          ? "border border-primary bg-primary text-primary-foreground shadow-md"
          : "border border-border bg-secondary text-foreground/80 shadow-md hover:bg-secondary-hover hover:text-foreground",
      )}
    >
      <div className="pointer-events-none absolute -top-9 left-1/2 w-fit -translate-x-1/2 translate-y-2 rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-xs whitespace-pre text-foreground opacity-0 shadow-sm transition-[opacity,transform] duration-150 motion-reduce:transition-none group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100">
        {title}
      </div>
      <div
        className="flex size-[22px] items-center justify-center transition-[width,height] duration-150 ease-out motion-reduce:transition-none group-hover:size-[38px] group-focus-visible:size-[38px] [&_svg]:h-full [&_svg]:w-full"
      >
        {icon}
      </div>
    </div>
  );

  const hitboxClassName = "group flex items-end justify-center touch-manipulation";

  if (onMouseDown) {
    return (
      <button
        type="button"
        aria-label={title}
        onMouseDown={onMouseDown}
        className={cn(hitboxClassName, "cursor-pointer")}
      >
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link
        href={href}
        aria-label={title}
        aria-current={isActive ? "page" : undefined}
        className={hitboxClassName}
      >
        {content}
      </Link>
    );
  }

  return <div className={hitboxClassName}>{content}</div>;
}
