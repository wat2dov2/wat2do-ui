import React from "react";

type BadgeMaskVariant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface BadgeMaskProps {
  variant: BadgeMaskVariant;
  children: React.ReactNode;
}

// Inline SVG components matching the original SVG files exactly
const EventBadgeMaskTopLeft = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 0C28.6538 1.70751e-06 2.86696e-06 28.6538 0 64L0 0L64 0Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskTopRight = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 64C64 28.6538 35.3462 2.86696e-06 0 0H64V64Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskBottomLeft = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M0 0C1.70751e-06 35.3462 28.6538 64 64 64H0V0Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskBottomRight = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 0C63.9997 35.346 35.346 64 0 64H64V0Z" fill="currentColor"/>
  </svg>
);

export function BadgeMask({ variant, children }: BadgeMaskProps) {
  switch (variant) {
    case "top-left":
      return (
        <div className="absolute top-0 left-0 flex flex-col">
          <div className="flex">
            <div className="pb-1 pr-1 bg-background rounded-br-xl">{children}</div>
            <EventBadgeMaskTopLeft className="h-2 w-2 text-background" />
          </div>
          <EventBadgeMaskTopLeft className="h-2 w-2 text-background" />
        </div>
      );
    case "top-right":
      return (
        <div className="absolute top-0 right-0 flex flex-col">
          <div className="flex">
            <EventBadgeMaskTopRight className="h-2 w-2 text-background" />
            <div className="pb-1 pl-1 bg-background rounded-bl-xl">{children}</div>
          </div>
          <EventBadgeMaskTopRight className="h-2 w-2 ml-auto text-background" />
        </div>
      );
    case "bottom-left":
      return (
        <div className="absolute bottom-0 left-0 flex flex-col">
            <EventBadgeMaskBottomLeft className="h-2 w-2 text-background" />
          <div className="flex">
            <div className="pt-1 pr-1 bg-background rounded-tr-xl">{children}</div>
            <EventBadgeMaskBottomLeft className="h-2 w-2 mt-auto text-background" />
          </div>
        </div>
      );
    case "bottom-right":
      return (
        <div className="absolute bottom-0 right-0 flex flex-col">
          <EventBadgeMaskBottomRight className="h-2 w-2 ml-auto text-background" />
          <div className="flex">
            <EventBadgeMaskBottomRight className="h-2 w-2 mt-auto text-background" />
            <div className="pt-1 pl-1 bg-background rounded-tl-xl">{children}</div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

export default BadgeMask;
