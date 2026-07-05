import React from "react";

type BadgeMaskVariant = "top-left" | "top-right" | "bottom-left";

interface BadgeMaskProps {
  variant: BadgeMaskVariant;
  children: React.ReactNode;
  /** Draw a hairline along the mask groove curves (e.g. org cards without an image). */
  outlined?: boolean;
  outlineClassName?: string;
}

const TOP_LEFT_FILL = "M64 0C28.65 0 0 28.65 0 64L0 0L64 0Z";
const TOP_LEFT_CURVE = "M64 0C28.65 0 0 28.65 0 64";

const TOP_RIGHT_FILL = "M64 64C64 28.65 35.35 0 0 0H64V64Z";
const TOP_RIGHT_CURVE = "M0 0C35.35 0 64 28.65 64 64";

const BOTTOM_LEFT_FILL = "M0 0C0 35.35 28.65 64 64 64H0V0Z";
const BOTTOM_LEFT_CURVE = "M0 0C0 35.35 28.65 64 64 64";

interface MaskSvgProps {
  fillPath: string;
  curvePath: string;
  className?: string;
  outlined?: boolean;
  outlineClassName?: string;
}

function MaskSvg({ fillPath, curvePath, className, outlined, outlineClassName }: MaskSvgProps) {
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
              fillPath={TOP_LEFT_FILL}
              curvePath={TOP_LEFT_CURVE}
              className="size-2 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
          </div>
          <MaskSvg
            fillPath={TOP_LEFT_FILL}
            curvePath={TOP_LEFT_CURVE}
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
              fillPath={TOP_RIGHT_FILL}
              curvePath={TOP_RIGHT_CURVE}
              className="size-2 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
            <div className={`pointer-events-auto pb-1 pl-1 bg-background rounded-bl-xl ${outlined ? `border-l border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
          <MaskSvg
            fillPath={TOP_RIGHT_FILL}
            curvePath={TOP_RIGHT_CURVE}
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
            fillPath={BOTTOM_LEFT_FILL}
            curvePath={BOTTOM_LEFT_CURVE}
            className="size-2 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />
          <div className="flex">
            <div className={`pointer-events-auto pt-1 pr-1 bg-background rounded-tr-xl ${outlined ? `border-r border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            <MaskSvg
              fillPath={BOTTOM_LEFT_FILL}
              curvePath={BOTTOM_LEFT_CURVE}
              className="size-2 mt-auto text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />
          </div>
        </div>
      );
    default:
      return null;
  }
}
