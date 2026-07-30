import { useCallback, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { cn } from "@/shared/lib/utils";

interface TruncatedTextProps {
  /** Full text. Rendered clipped, and revealed on hover only when it overflows. */
  text: string;
  className?: string;
}

/**
 * Single-line text that reveals its full value on hover when clipped.
 *
 * The tooltip is suppressed when the text already fits, so short labels do not
 * sprout a redundant hover card. Overflow is measured on hover rather than on
 * render because the box width is only known after layout, and it can change
 * with the viewport.
 */
export function TruncatedText({ text, className }: TruncatedTextProps) {
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const syncOverflow = useCallback(() => {
    const element = textRef.current;
    if (!element) return;
    setIsOverflowing(element.scrollWidth > element.clientWidth);
  }, []);

  return (
    <Tooltip open={isOverflowing ? undefined : false}>
      <TooltipTrigger asChild>
        <span
          ref={textRef}
          className={cn("block min-w-0 truncate", className)}
          onMouseEnter={syncOverflow}
          onFocus={syncOverflow}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs break-words">{text}</TooltipContent>
    </Tooltip>
  );
}
