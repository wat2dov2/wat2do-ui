import React, { useState, useRef } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";

interface FilterSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  indicator?: string;
  onClear?: () => void;
}

export const FilterSection = React.memo(function FilterSection({
  title,
  expanded,
  onToggle,
  children,
  indicator,
  onClear,
}: FilterSectionProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const titleRef = useRef<HTMLSpanElement>(null);

  const handleMouseEnter = () => {
    if (titleRef.current) {
      const rect = titleRef.current.getBoundingClientRect();
      setTooltipPosition({
        x: rect.left + rect.width / 2,
        y: rect.top - 8,
      });
      setShowTooltip(true);
    }
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };

  return (
    <div className={`space-y-2 relative -mx-4 ${expanded ? "border-y border-gray-200" : ""}`}>
      <button
        onClick={onToggle}
        className="flex items-center justify-between w-full group hover:opacity-80 transition-opacity py-3 px-4"
      >
        <div className="flex items-center gap-2">
          <span
            ref={titleRef}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            className="font-medium text-xs relative"
            style={{ color: "#111827" }}
          >
            {title}
            {showTooltip && (
              <span
                className="fixed z-[100] text-white font-medium text-[11px] px-2.5 py-1.5 rounded shadow-lg whitespace-nowrap pointer-events-none"
                style={{
                  left: `${tooltipPosition.x}px`,
                  top: `${tooltipPosition.y}px`,
                  transform: "translate(-50%, -100%)",
                  backgroundColor: "#374151",
                }}
              >
                {title}
                <span
                  className="absolute left-1/2 -bottom-1 -translate-x-1/2 w-2 h-2 rotate-45"
                  style={{ backgroundColor: "#374151" }}
                />
              </span>
            )}
          </span>
          {indicator && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              className="text-white font-medium text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 hover:opacity-90 transition-colors cursor-pointer"
              style={{ backgroundColor: "#3B82F6" }}
            >
              <X className="w-2.5 h-2.5" strokeWidth={3} />
              {indicator}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 transition-colors" style={{ color: "#9CA3AF" }} />
        ) : (
          <ChevronDown className="w-4 h-4 transition-colors" style={{ color: "#9CA3AF" }} />
        )}
      </button>
      {expanded && <div className="animate-in fade-in duration-200 px-4 pb-3">{children}</div>}
    </div>
  );
});
