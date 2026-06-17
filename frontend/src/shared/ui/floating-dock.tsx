import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export interface FloatingDockItem {
  title: string;
  icon: ReactNode;
  href?: string;
  onMouseDown?: () => void;
  isActive?: boolean;
}

export const FloatingDock = ({
  items,
  desktopClassName,
}: {
  items: FloatingDockItem[];
  desktopClassName?: string;
}) => {
  return <FloatingDockDesktop items={items} className={desktopClassName} />;
};

const FloatingDockDesktop = ({
  items,
  className,
}: {
  items: FloatingDockItem[];
  className?: string;
}) => {
  return (
    <div className="relative mx-auto flex items-end">
      <div
        className="absolute inset-x-0 bottom-1 h-9 bg-secondary/20 border border-foreground/10 rounded-md origin-bottom pointer-events-none shadow-lg backdrop-blur-md"
        style={{
          transform: "perspective(140px) rotateX(45deg) scaleX(1.15)",
        }}
      />
      {/* 2D Icons Container */}
      <div
        className={cn(
          "flex h-[60px] items-end gap-3 px-4 pb-2.5 relative z-10 sm:gap-4 sm:px-6",
          className,
        )}
      >
        {items.map((item) => (
          <IconContainer key={item.title} item={item} />
        ))}
      </div>
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
    <span
      data-elevation="control"
      className={cn(
        "group relative flex size-9 items-center justify-center rounded-full transition-[background-color,color,transform] duration-150 hover:-translate-y-1",
        isActive
          ? "bg-primary/20 border border-primary/30 backdrop-blur-md text-primary"
          : "bg-secondary/30 border border-foreground/10 backdrop-blur-md text-foreground shadow-sm",
      )}
    >
      <span
        className="pointer-events-none absolute -top-9 left-1/2 w-fit -translate-x-1/2 translate-y-1 rounded-md border border-border bg-popover px-2 py-0.5 text-xs whitespace-pre text-popover-foreground opacity-0 transition-[opacity,transform] duration-150 group-hover:translate-y-0 group-hover:opacity-100"
      >
        {title}
      </span>
      <span
        className="flex size-[18px] items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      >
        {icon}
      </span>
    </span>
  );

  if (onMouseDown) {
    return (
      <button type="button" onMouseDown={onMouseDown} className="cursor-pointer">
        {content}
      </button>
    );
  }

  if (href) {
    return (
      <Link to={href}>
        {content}
      </Link>
    );
  }

  return content;
}
