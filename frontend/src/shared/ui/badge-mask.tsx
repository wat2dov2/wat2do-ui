import React, { type SVGProps } from "react";
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
  /** Measured by `useCardCutouts` to size the notch. */
  containerRef?: React.Ref<HTMLDivElement>;
}

interface MaskSvgProps {
  variant: BadgeMaskVariant;
  className?: string;
  outlined?: boolean;
  outlineClassName?: string;
}

/**
 * The bare corner glyph, reusable as a knockout shape.
 *
 * `fill` defaults to `currentColor` so existing call sites are unchanged; the
 * cutout mask passes `fill="black"`. Same artwork, no duplicated asset.
 */
export function BadgeMaskShape({
  variant,
  ...props
}: { variant: BadgeMaskVariant } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path d={BADGE_MASK_PATHS[variant].fillPath} fill={props.fill ?? "currentColor"} />
    </svg>
  );
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
}: BadgeMaskProps) {
  const surfaceClass = cutout ? "" : "bg-background";
  switch (variant) {
    case "top-left":
      return (
        <div ref={containerRef} className="absolute top-0 left-0 z-10 flex max-w-full flex-col pointer-events-none">
          <div className="flex min-w-0">
            <div className={`pointer-events-auto flex min-w-0 pb-1 pr-1 ${surfaceClass} rounded-br-xl ${outlined ? `border-r border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            {!cutout && <MaskSvg
              variant="top-left"
              className="size-2 shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
          </div>
          {!cutout && <MaskSvg
            variant="top-left"
            className="size-2 shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
        </div>
      );
    case "top-right":
      return (
        <div ref={containerRef} className="absolute top-0 right-0 z-10 flex max-w-full flex-col pointer-events-none">
          <div className="flex min-w-0">
            {!cutout && <MaskSvg
              variant="top-right"
              className="size-2 shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
            <div className={`pointer-events-auto flex min-w-0 pb-1 pl-1 ${surfaceClass} rounded-bl-xl ${outlined ? `border-l border-b border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
          {!cutout && <MaskSvg
            variant="top-right"
            className="size-2 ml-auto shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
        </div>
      );
    case "bottom-left":
      return (
        <div ref={containerRef} className="absolute bottom-0 left-0 z-10 flex max-w-full flex-col pointer-events-none">
          {!cutout && <MaskSvg
            variant="bottom-left"
            className="size-2 shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
          <div className="flex min-w-0">
            <div className={`pointer-events-auto flex min-w-0 pt-1 pr-1 ${surfaceClass} rounded-tr-xl ${outlined ? `border-r border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
            {!cutout && <MaskSvg
              variant="bottom-left"
              className="size-2 mt-auto shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
          </div>
        </div>
      );
    case "bottom-right":
      return (
        <div ref={containerRef} className="absolute bottom-0 right-0 z-10 flex max-w-full flex-col pointer-events-none">
          {!cutout && <MaskSvg
            variant="bottom-right"
            className="size-2 ml-auto shrink-0 text-background"
            outlined={outlined}
            outlineClassName={outlineClassName}
          />}
          <div className="flex min-w-0">
            {!cutout && <MaskSvg
              variant="bottom-right"
              className="size-2 mt-auto shrink-0 text-background"
              outlined={outlined}
              outlineClassName={outlineClassName}
            />}
            <div className={`pointer-events-auto flex min-w-0 pt-1 pl-1 ${surfaceClass} rounded-tl-xl ${outlined ? `border-l border-t border-current ${outlineClassName}` : ""}`}>
              {children}
            </div>
          </div>
        </div>
      );
    default:
      return null;
  }
}
