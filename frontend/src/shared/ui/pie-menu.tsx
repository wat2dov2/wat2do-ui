/**
 * Pie Menu Component
 * A radial menu that appears at cursor position with smooth animations
 */

import * as React from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { cn } from "@/shared/lib/utils";
import { Z_INDEX } from "@/shared/constants/zIndex";
import { Check } from "lucide-react";

export interface PieMenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}

export interface PieMenuProps {
  items: PieMenuItem[];
  isOpen: boolean;
  position: { x: number; y: number };
  onClose: () => void;
  onSelect?: (item: PieMenuItem) => void;
  selectedIds?: string[];
  closeOnSelect?: boolean;
  radius?: number;
  innerRadius?: number;
  startAngle?: number;
  className?: string;
}

function describeArc(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const startRad = toRad(startAngle);
  const endRad = toRad(endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;

  const ox1 = cx + outerR * Math.cos(startRad);
  const oy1 = cy + outerR * Math.sin(startRad);
  const ox2 = cx + outerR * Math.cos(endRad);
  const oy2 = cy + outerR * Math.sin(endRad);
  const ix1 = cx + innerR * Math.cos(endRad);
  const iy1 = cy + innerR * Math.sin(endRad);
  const ix2 = cx + innerR * Math.cos(startRad);
  const iy2 = cy + innerR * Math.sin(startRad);

  return `M ${ox1} ${oy1} A ${outerR} ${outerR} 0 ${largeArc} 1 ${ox2} ${oy2} L ${ix1} ${iy1} A ${innerR} ${innerR} 0 ${largeArc} 0 ${ix2} ${iy2} Z`;
}

export function PieMenu({
  items,
  isOpen,
  position,
  onClose,
  onSelect,
  selectedIds = [],
  closeOnSelect = true,
  radius = 140,
  innerRadius = 20,
  startAngle = -90,
  className,
}: PieMenuProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [isDarkMode, setIsDarkMode] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);

  // Detect dark mode
  React.useEffect(() => {
    const checkDarkMode = () => {
      setIsDarkMode(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();
    
    // Watch for changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // No gaps - slices touch each other
  const sliceAngle = items.length > 0 ? 360 / items.length : 0;
  const svgSize = radius * 2 + 20;
  const center = svgSize / 2;

  // Handle escape key and scroll lock
  React.useEffect(() => {
    if (!isOpen) {
      setHoveredIndex(null);
      return;
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  // Clamp position to viewport
  const getAdjustedPosition = () => {
    const pad = 10;
    const half = svgSize / 2;
    return {
      x: Math.max(half + pad, Math.min(window.innerWidth - half - pad, position.x)),
      y: Math.max(half + pad, Math.min(window.innerHeight - half - pad, position.y)),
    };
  };

  if (!isOpen || typeof window === "undefined") return null;

  const adjustedPos = getAdjustedPosition();

  // Calculate font size based on number of items
  const fontSize = items.length <= 4 ? 12 : items.length <= 6 ? 11 : items.length <= 8 ? 10 : 9;

  return createPortal(
    <div data-pie-menu style={{ position: "fixed", inset: 0, zIndex: Z_INDEX.PIE_MENU }}>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.1 }}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(0, 0, 0, 0.3)",
          pointerEvents: "all",
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          onClose();
        }}
      />

      {/* Menu */}
      <div
        ref={menuRef}
        className={cn("fixed", className)}
        style={{
          left: adjustedPos.x - svgSize / 2,
          top: adjustedPos.y - svgSize / 2,
          width: svgSize,
          height: svgSize,
          zIndex: Z_INDEX.MAX,
        }}
      >
        <motion.svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          style={{ overflow: "visible", filter: "drop-shadow(0 10px 25px rgba(0,0,0,0.2))", transformOrigin: "center center" }}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          {/* Center circle to close menu */}
          <circle
            cx={center}
            cy={center}
            r={innerRadius}
            fill="transparent"
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              onClose();
            }}
          />

          {items.map((item, index) => {
            const sliceStart = startAngle + index * sliceAngle;
            const sliceEnd = sliceStart + sliceAngle;
            const isHovered = hoveredIndex === index;
            const isSelected = selectedIds.includes(item.id);
            const isActive = isHovered || isSelected;

            const midAngle = ((sliceStart + sliceEnd) / 2) * (Math.PI / 180);

            // Position content in the middle of the slice
            const contentRadius = (radius + innerRadius) / 2;
            const contentX = center + contentRadius * Math.cos(midAngle);
            const contentY = center + contentRadius * Math.sin(midAngle);

            // Position checkmark at outer edge
            const checkRadius = radius + 2;
            const checkX = center + checkRadius * Math.cos(midAngle);
            const checkY = center + checkRadius * Math.sin(midAngle);

            const path = describeArc(center, center, radius, innerRadius, sliceStart, sliceEnd);

            return (
              <g key={item.id}>
                {/* Slice background */}
                <motion.path
                  d={path}
                  fill={
                    item.disabled 
                      ? (isDarkMode ? "var(--gray-700)" : "var(--muted)")
                      : isActive 
                        ? "var(--primary)" 
                        : (isDarkMode ? "var(--gray-800)" : "var(--background)")
                  }
                  stroke={
                    isSelected 
                      ? (isDarkMode ? "var(--blue-400)" : "var(--blue-600)")
                      : (isDarkMode ? "var(--gray-600)" : "var(--gray-200)")
                  }
                  strokeWidth={isSelected ? 2 : 1}
                  style={{
                    cursor: item.disabled ? "default" : "pointer",
                    transformOrigin: `${center}px ${center}px`,
                    pointerEvents: "all"
                  }}
                  onMouseEnter={() => !item.disabled && setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!item.disabled) {
                      item.onClick?.();
                      onSelect?.(item);
                      if (closeOnSelect) onClose();
                    }
                  }}
                  initial={false}
                  animate={{ scale: isHovered ? 1.03 : 1 }}
                  transition={{ duration: 0.1 }}
                />

                {/* Icon */}
                {item.icon && (
                  <foreignObject
                    x={contentX - 10}
                    y={contentY - (items.length > 6 ? 18 : 20)}
                    width={20}
                    height={20}
                    style={{ pointerEvents: "none" }}
                  >
                    <div
                      style={{
                        width: 20,
                        height: 20,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: isActive 
                          ? "white" 
                          : item.disabled 
                            ? "var(--gray-400)" 
                            : (isDarkMode ? "var(--gray-300)" : "var(--gray-600)"),
                      }}
                    >
                      {item.icon}
                    </div>
                  </foreignObject>
                )}

                {/* Label */}
                <text
                  x={contentX}
                  y={contentY + (item.icon ? (items.length > 6 ? 10 : 12) : 0)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  style={{
                    fontSize: `${fontSize}px`,
                    fontWeight: 500,
                    fill: isActive 
                      ? "white" 
                      : item.disabled 
                        ? "var(--gray-400)" 
                        : (isDarkMode ? "var(--gray-200)" : "var(--gray-700)"),
                    pointerEvents: "none",
                    userSelect: "none",
                  }}
                >
                  {item.label.length > 10 ? item.label.slice(0, 9) + "…" : item.label}
                </text>

                {/* Selection checkmark */}
                {isSelected && (
                  <g>
                    <circle
                      cx={checkX}
                      cy={checkY}
                      r={8}
                      fill="var(--success)"
                      stroke="#fff"
                      strokeWidth={2}
                    />
                    <foreignObject x={checkX - 6} y={checkY - 6} width={12} height={12} style={{ pointerEvents: "none" }}>
                      <div style={{ width: 12, height: 12, display: "flex", alignItems: "center", justifyContent: "center", color: "white" }}>
                        <Check size={10} strokeWidth={3} />
                      </div>
                    </foreignObject>
                  </g>
                )}
              </g>
            );
          })}
        </motion.svg>
      </div>
    </div>,
    document.body
  );
}

export default PieMenu;
