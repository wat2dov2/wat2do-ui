"use client";
/**
 * Note: Use position fixed according to your needs
 * Desktop navbar is better positioned at the bottom
 * Mobile navbar is better positioned at bottom right.
 **/

import { cn } from "@/shared/lib/utils";
import {
  AnimatePresence,
  MotionValue,
  motion,
  useMotionValue,
  useSpring,
  useTransform,
} from "motion/react";

import { Link } from "react-router-dom";
import { useRef, useState } from "react";

export interface FloatingDockItem {
  title: string;
  icon: React.ReactNode;
  href?: string;
  onClick?: () => void;
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
    <motion.div
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      className={cn(
        "mx-auto flex h-[60px] items-end gap-4 rounded-2xl bg-secondary/60 px-4 pb-3 backdrop-blur-sm",
        className,
      )}
    >
      {items.map((item) => (
        <IconContainer mouseX={mouseX} key={item.title} item={item} />
      ))}
    </motion.div>
  );
};

function IconContainer({
  mouseX,
  item,
}: {
  mouseX: MotionValue;
  item: FloatingDockItem;
}) {
  const { title, icon, href, onClick, isActive } = item;
  const ref = useRef<HTMLDivElement>(null);

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
          ? "bg-primary text-primary-foreground"
          : "bg-muted text-foreground shadow-sm",
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

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="cursor-pointer">
        {content}
      </button>
    );
  }

  if (href) {
    return <Link to={href}>{content}</Link>;
  }

  return content;
}
