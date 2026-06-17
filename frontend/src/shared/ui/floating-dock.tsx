import { cn } from "@/shared/lib/utils";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MotionValue } from "motion/react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";

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
  const mouseX = useMotionValue(Infinity);
  return (
    <div className="relative mx-auto flex items-end">
      <div
        className="absolute inset-x-0 bottom-1 h-9 bg-secondary/20 border border-foreground/10 rounded-md origin-bottom pointer-events-none shadow-lg backdrop-blur-md"
        style={{
          transform: "perspective(140px) rotateX(45deg) scaleX(1.15)",
        }}
      />
      {/* 2D Icons Container */}
      <motion.div
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className={cn(
          "flex h-[60px] items-end gap-4 px-6 pb-2.5 relative z-10",
          className,
        )}
      >
        {items.map((item) => (
          <IconContainer mouseX={mouseX} key={item.title} item={item} />
        ))}
      </motion.div>
    </div>
  );
};

function IconContainer({
  mouseX,
  item,
}: {
  mouseX: MotionValue<number>;
  item: FloatingDockItem;
}) {
  const { title, icon, href, onMouseDown, isActive } = item;
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };

    return val - bounds.x - bounds.width / 2;
  });

  const widthTransform = useTransform(distance, [-150, 0, 150], [36, 74, 36]);
  const heightTransform = useTransform(distance, [-150, 0, 150], [36, 74, 36]);

  const widthTransformIcon = useTransform(distance, [-150, 0, 150], [18, 37, 18]);
  const heightTransformIcon = useTransform(
    distance,
    [-150, 0, 150],
    [18, 37, 18],
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
    <motion.div
      data-elevation="control"
      ref={ref}
      style={{ width, height }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={cn(
        "relative flex aspect-square items-center justify-center rounded-full",
        isActive
          ? "bg-primary/20 border border-primary/30 backdrop-blur-md text-primary"
          : "bg-secondary/30 border border-foreground/10 backdrop-blur-md text-foreground shadow-sm",
      )}
    >
      <AnimatePresence>
        {hovered && (
          <motion.div
            initial={{ opacity: 0, y: 10, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 2, x: "-50%" }}
            className="absolute -top-9 left-1/2 w-fit rounded-md border border-border bg-popover px-2 py-0.5 text-xs whitespace-pre text-popover-foreground shadow-sm"
          >
            {title}
          </motion.div>
        )}
      </AnimatePresence>
      <motion.div
        style={{ width: widthIcon, height: heightIcon }}
        className="flex items-center justify-center [&_svg]:h-full [&_svg]:w-full"
      >
        {icon}
      </motion.div>
    </motion.div>
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
      <Link
        to={href}
        onMouseDown={(e) => {
          if (e.button === 0) {
            e.preventDefault();
            navigate(href);
          }
        }}
      >
        {content}
      </Link>
    );
  }

  return content;
}
