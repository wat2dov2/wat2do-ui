import {
  forwardRef,
  type ComponentPropsWithoutRef,
} from "react";

import { cn } from "@/shared/lib/utils";

const HORIZONTAL_SCROLL_FADE_MASK =
  "linear-gradient(to right, #000 0%, #000 calc(100% - 6rem), transparent 100%)";

interface HorizontalScrollFadeProps extends ComponentPropsWithoutRef<"div"> {
  visible: boolean;
}

/**
 * Fades overflowing scroll content to transparency at the right edge.
 *
 * The mask removes only the scroll content, so the real page backdrop remains
 * visible beneath it instead of being approximated by a solid-color overlay.
 */
export const HorizontalScrollFade = forwardRef<
  HTMLDivElement,
  HorizontalScrollFadeProps
>(({ visible, className, style, ...props }, ref) => (
  <div
    ref={ref}
    data-scroll-fade={visible ? "visible" : "hidden"}
    className={cn(className)}
    style={{
      ...style,
      maskImage: visible ? HORIZONTAL_SCROLL_FADE_MASK : undefined,
      maskRepeat: visible ? "no-repeat" : undefined,
      WebkitMaskImage: visible ? HORIZONTAL_SCROLL_FADE_MASK : undefined,
      WebkitMaskRepeat: visible ? "no-repeat" : undefined,
    }}
    {...props}
  />
));

HorizontalScrollFade.displayName = "HorizontalScrollFade";
