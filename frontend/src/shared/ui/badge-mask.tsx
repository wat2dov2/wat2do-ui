import React from "react";
import { BADGE_MASK_PATHS, type BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";

interface BadgeMaskProps {
  variant: BadgeMaskVariant;
  children: React.ReactNode;
  /** Draw a hairline along the mask groove curves (e.g. org cards without an image). */
  outlined?: boolean;
  outlineClassName?: string;
}

interface MaskSvgProps {
  variant: BadgeMaskVariant;
  className?: string;
  outlined?: boolean;
  outlineClassName?: string;
}

function MaskSvg({ variant, className, outlined, outlineClassName }: MaskSvgProps) {
  const { fillPath, curvePath } = BADGE_MASK_PATHS[variant];

  return (
    <svg
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path d={fillPath} fill="currentColor" />
      {outlined ? (
        <path
          d={curvePath}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className={outlineClassName}
        />
      ) : null}
    </svg>
  );
}

export function BadgeMask({
  variant,
  children,
  outlined = false,
  outlineClassName,
}: BadgeMaskProps) {
  switch (variant) {
    case "top-left":
      return (
        <div className="absolute top-0 left-0 z-10 flex flex-col pointer-events-none">
          <div className="flex">
            <div className={`pointer-events-auto pb-1 pr-1 bg-background rounded-br-xl ${outlined ? `border-r border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            <MaskSvg
              variant="top-left"
              className="size-2 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
          </div>
          <MaskSvg
            variant="top-left"
            className="size-2 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />
        </div>
      );
    case "top-right":
      return (
        <div className="absolute top-0 right-0 z-10 flex flex-col pointer-events-none">
          <div className="flex">
            <MaskSvg
              variant="top-right"
              className="size-2 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
            <div className={`pointer-events-auto pb-1 pl-1 bg-background rounded-bl-xl ${outlined ? `border-l border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
          <MaskSvg
            variant="top-right"
            className="size-2 ml-auto text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />
        </div>
      );
    case "bottom-left":
      return (
        <div className="absolute bottom-0 left-0 z-10 flex flex-col pointer-events-none">
          <MaskSvg
            variant="bottom-left"
            className="size-2 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />
          <div className="flex">
            <div className={`pointer-events-auto pt-1 pr-1 bg-background rounded-tr-xl ${outlined ? `border-r border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            <MaskSvg
              variant="bottom-left"
              className="size-2 mt-auto text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
          </div>
        </div>
      );
    case "bottom-right":
      return (
        <div className="absolute bottom-0 right-0 z-10 flex flex-col pointer-events-none">
          <MaskSvg
            variant="bottom-right"
            className="size-2 ml-auto text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />
          <div className="flex">
            <MaskSvg
              variant="bottom-right"
              className="size-2 mt-auto text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
            <div className={`pointer-events-auto pt-1 pl-1 bg-background rounded-tl-xl ${outlined ? `border-l border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}
