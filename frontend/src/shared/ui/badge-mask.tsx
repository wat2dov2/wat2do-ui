import React from "react";
import { cn } from "@/shared/lib/utils";
import { BADGE_MASK_PATHS, type BadgeMaskVariant } from "@/shared/ui/badge-mask-paths";

interface BadgeMaskProps {
  variant: BadgeMaskVariant;
  children: React.ReactNode;
  /** Draw a hairline along the mask groove curves (e.g. org cards without an image). */
  outlined?: boolean;
  outlineClassName?: string;
  /**
   * The surface behind is genuinely clipped, so skip the background-coloured
   * notch and its fillet glyphs - the clip path already provides both, and
   * painting them would fill the hole back in.
   */
  cutout?: boolean;
  /** Measured by `useEventImageCutouts` to size the notch. */
  containerRef?: React.Ref<HTMLDivElement>;
  /**
   * Take part in the parent's layout instead of being pinned over the corner,
   * so content below the badge flows under it however tall the badge wraps.
   * The parent still places it flush in its corner.
   */
  inFlow?: boolean;
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
  cutout = false,
  containerRef,
  inFlow = false,
}: BadgeMaskProps) {
  const surfaceClass = cutout ? "" : "bg-background";
  const placement = (corner: string) => (inFlow ? "relative min-w-0" : `absolute ${corner}`);
  switch (variant) {
    case "top-left":
      return (
        <div ref={containerRef} className={cn(placement("top-0 left-0"), "z-10 flex max-w-full flex-col pointer-events-none")}>
          <div className="flex min-w-0">
            <div className={`pointer-events-auto flex min-w-0 pr-(--notch-gap) pb-(--notch-gap) ${surfaceClass} rounded-br-(--notch-radius) ${outlined ? `border-r border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            {!cutout && <MaskSvg
              variant="top-left"
              className="size-(--notch-fillet) shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
          </div>
          {!cutout && <MaskSvg
            variant="top-left"
            className="size-(--notch-fillet) shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
        </div>
      );
    case "top-right":
      return (
        <div ref={containerRef} className={cn(placement("top-0 right-0"), "z-10 flex max-w-full flex-col pointer-events-none")}>
          <div className="flex min-w-0">
            {!cutout && <MaskSvg
              variant="top-right"
              className="size-(--notch-fillet) shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
            <div className={`pointer-events-auto flex min-w-0 pl-(--notch-gap) pb-(--notch-gap) ${surfaceClass} rounded-bl-(--notch-radius) ${outlined ? `border-l border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
          {!cutout && <MaskSvg
            variant="top-right"
            className="size-(--notch-fillet) ml-auto shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
        </div>
      );
    case "bottom-left":
      return (
        <div ref={containerRef} className={cn(placement("bottom-0 left-0"), "z-10 flex max-w-full flex-col pointer-events-none")}>
          {!cutout && <MaskSvg
            variant="bottom-left"
            className="size-(--notch-fillet) shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
          <div className="flex min-w-0">
            <div className={`pointer-events-auto flex min-w-0 pr-(--notch-gap) pt-(--notch-gap) ${surfaceClass} rounded-tr-(--notch-radius) ${outlined ? `border-r border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            {!cutout && <MaskSvg
              variant="bottom-left"
              className="size-(--notch-fillet) mt-auto shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
          </div>
        </div>
      );
    case "bottom-right":
      return (
        <div ref={containerRef} className={cn(placement("bottom-0 right-0"), "z-10 flex max-w-full flex-col pointer-events-none")}>
          {!cutout && <MaskSvg
            variant="bottom-right"
            className="size-(--notch-fillet) ml-auto shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
          <div className="flex min-w-0">
            {!cutout && <MaskSvg
              variant="bottom-right"
              className="size-(--notch-fillet) mt-auto shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
            <div className={`pointer-events-auto flex min-w-0 pl-(--notch-gap) pt-(--notch-gap) ${surfaceClass} rounded-tl-(--notch-radius) ${outlined ? `border-l border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}
