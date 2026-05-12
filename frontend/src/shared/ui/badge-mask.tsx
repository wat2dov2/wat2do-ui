import React from "react";

type BadgeMaskVariant = "top-left" | "top-right" | "bottom-left" | "bottom-right";

interface BadgeMaskProps {
  variant: BadgeMaskVariant;
  children: React.ReactNode;
}

// Inline SVG components matching the original SVG files exactly
const EventBadgeMaskTopLeft = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 0C28.65 0 0 28.65 0 64L0 0L64 0Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskTopRight = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 64C64 28.65 35.35 0 0 0H64V64Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskBottomLeft = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M0 0C0 35.35 28.65 64 64 64H0V0Z" fill="currentColor"/>
  </svg>
);

const EventBadgeMaskBottomRight = ({ className }: { className?: string }) => (
  <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M64 0C64 35.35 35.35 64 0 64H64V0Z" fill="currentColor"/>
  </svg>
);

export function BadgeMask({ variant, children }: BadgeMaskProps) {
  switch (variant) {
    case "top-left":
      return (
        <div className="absolute top-0 left-0 flex flex-col">
          <div className="flex">
            <div className="pb-1 pr-1 bg-background rounded-br-xl">{children}</div>
            <EventBadgeMaskTopLeft className="size-2 text-background" />
          </div>
          <EventBadgeMaskTopLeft className="size-2 text-background" />
        </div>
      );
    case "top-right":
      return (
        <div className="absolute top-0 right-0 flex flex-col">
          <div className="flex">
            <EventBadgeMaskTopRight className="size-2 text-background" />
            <div className="pb-1 pl-1 bg-background rounded-bl-xl">{children}</div>
          </div>
          <EventBadgeMaskTopRight className="size-2 ml-auto text-background" />
        </div>
      );
    case "bottom-left":
      return (
        <div className="absolute bottom-0 left-0 flex flex-col">
            <EventBadgeMaskBottomLeft className="size-2 text-background" />
          <div className="flex">
            <div className="pt-1 pr-1 bg-background rounded-tr-xl">{children}</div>
            <EventBadgeMaskBottomLeft className="size-2 mt-auto text-background" />
          </div>
        </div>
      );
    case "bottom-right":
      return (
        <div className="absolute bottom-0 right-0 flex flex-col">
          <EventBadgeMaskBottomRight className="size-2 ml-auto text-background" />
          <div className="flex">
            <EventBadgeMaskBottomRight className="size-2 mt-auto text-background" />
            <div className="pt-1 pl-1 bg-background rounded-tl-xl">{children}</div>
          </div>
        </div>
      );
    default:
      return null;
  }
}

