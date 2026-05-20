import React from "react";

interface BentoGridProps {
  children: React.ReactNode;
  columns?: number;
  gap?: number;
  style?: React.CSSProperties;
}

export const BentoGrid: React.FC<BentoGridProps> = ({
  children,
  columns = 3,
  gap = 12,
  style,
}) => {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap,
        alignItems: "start",
        ...style,
      }}
    >
      {children}
    </div>
  );
};
