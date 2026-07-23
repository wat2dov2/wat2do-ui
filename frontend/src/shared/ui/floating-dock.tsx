import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AnimatePresence,
  m,
  type MotionValue,
  useMotionValue,
  useSpring,
  useTransform,
} from "framer-motion";

export interface FloatingDockItem {
  title: string;
  icon: ReactNode;
  href?: string;
  onMouseDown?: () => void;
  isActive?: boolean;
}

/** Resting icon circle matches BackToTopButton (`size-9` / 36px). */
const DOCK_ICON_SIZE = 36;
const DOCK_ICON_SIZE_ZOOMED = 72;
const DOCK_GLYPH_SIZE = 18;
const DOCK_GLYPH_SIZE_ZOOMED = 36;

/**
 * Aceternity Floating Dock magnification pattern:
 * https://ui.aceternity.com/components/floating-dock
 * Mouse X drives per-icon distance → spring width/height. The growing
 * icon must own layout (no fixed hitbox size); the row uses items-end so
 * icons scale upward from a shared baseline.
 */
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
  const mouseX = useMotionValue(Infinity);
  const [canMagnify, setCanMagnify] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(hover: hover) and (min-width: 480px)");
    const syncCanMagnify = () => setCanMagnify(query.matches);
    syncCanMagnify();
    query.addEventListener("change", syncCanMagnify);
    return () => query.removeEventListener("change", syncCanMagnify);
  }, []);

  return (
    <div className="relative mx-auto inline-flex w-fit max-w-full items-end justify-center">
      <m.div
        onMouseMove={(e) => mouseX.set(e.clientX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className={cn(
          // Height/baseline come from AppLayout bottom chrome; items-end grows upward.
          "relative z-10 flex max-w-full items-end justify-center gap-4 px-2 sm:px-6",
          className,
        )}
      >
        {items.map((item) => (
          <IconContainer mouseX={mouseX} canMagnify={canMagnify} key={item.title} item={item} />
        ))}
      </m.div>
    </div>
  );
};

function IconContainer({
  mouseX,
  canMagnify,
  item,
}: {
  mouseX: MotionValue<number>;
  canMagnify: boolean;
  item: FloatingDockItem;
}) {
  const { title, icon, href, onMouseDown, isActive } = item;
  const ref = useRef<HTMLDivElement>(null);

  const distance = useTransform(mouseX, (val) => {
    if (!canMagnify) return Infinity;
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const widthTransform = useTransform(
    distance,
    [-150, 0, 150],
    [DOCK_ICON_SIZE, DOCK_ICON_SIZE_ZOOMED, DOCK_ICON_SIZE],
  );
  const heightTransform = useTransform(
    distance,
    [-150, 0, 150],
    [DOCK_ICON_SIZE, DOCK_ICON_SIZE_ZOOMED, DOCK_ICON_SIZE],
  );

  const widthTransformIcon = useTransform(
    distance,
    [-150, 0, 150],
    [DOCK_GLYPH_SIZE, DOCK_GLYPH_SIZE_ZOOMED, DOCK_GLYPH_SIZE],
  );
  const heightTransformIcon = useTransform(
    distance,
    [-150, 0, 150],
    [DOCK_GLYPH_SIZE, DOCK_GLYPH_SIZE_ZOOMED, DOCK_GLYPH_SIZE],
  );

  const width = useSpring(widthTransform, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });
  const height = useSpring(heightTransform, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const widthIcon = useSpring(widthTransformIcon, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });
  const heightIcon = useSpring(heightTransformIcon, {
    mass: 0.1,
    stiffness: 150,
    damping: 12,
  });

  const [hovered, setHovered] = useState(false);

  const content = (
    <m.div
      ref={ref}
      style={canMagnify ? { width, height } : undefined}
      onMouseEnter={() => {
        if (canMagnify) {
          setHovered(true);
        }
      }}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full",
        !canMagnify && "size-9",
        isActive
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-secondary text-foreground/80 hover:text-foreground hover:bg-secondary-hover",
      )}
    >
      <AnimatePresence>
        {hovered && (
          <m.div
            initial={{ opacity: 0, y: 10, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 2, x: "-50%" }}
            className="absolute -top-9 left-1/2 w-fit rounded-md border border-border bg-surface-elevated px-2 py-0.5 text-xs whitespace-pre text-foreground shadow-sm"
          >
            {title}
          </m.div>
        )}
      </AnimatePresence>
      <m.div
        style={canMagnify ? { width: widthIcon, height: heightIcon } : undefined}
        className="flex size-[18px] items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      >
        {icon}
      </m.div>
    </m.div>
  );

  // No fixed size on the wrapper - the animated icon must drive layout width
  // or neighbors will not part and magnification looks broken.
  const hitboxClassName = "flex items-end justify-center touch-manipulation";

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
      <Link href={href} aria-label={title} className={hitboxClassName}>
        {content}
      </Link>
    );
  }

  return content;
}
