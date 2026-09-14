import type { ReactNode } from "react";
import { useHorizontalScrollFade } from "@/shared/hooks/useHorizontalScrollFade";
import { HorizontalScrollFade } from "@/shared/ui/horizontal-scroll-fade";
import { Stack } from "@/shared/layout/stack";

interface FilterBarProps {
  children: ReactNode;
  trailing?: ReactNode;
  refreshKey?: unknown;
  "aria-label"?: string;
  "data-testid"?: string;
}

/** One scrolling filter row, with optional controls pinned outside its fade. */
export function FilterBar({ children, trailing, refreshKey, ...props }: FilterBarProps) {
  const { scrollRef, scrollEndRef, showScrollFade, syncScrollFade,
    syncScrollFadeAfterWheel, dragScrollProps } = useHorizontalScrollFade({ refreshKey });
  return (
    <Stack direction="horizontal" align="center" gap={2}>
      <div className="relative min-w-0 flex-1">
        <HorizontalScrollFade
          ref={scrollRef}
          visible={showScrollFade}
          {...dragScrollProps}
          {...props}
          role="group"
          onScroll={syncScrollFade}
          onWheel={syncScrollFadeAfterWheel}
          onTouchEnd={syncScrollFade}
          className="no-visible-scrollbar flex min-w-0 cursor-grab flex-nowrap items-center gap-2 overflow-x-auto pb-1 active:cursor-grabbing"
        >
          {children}
          <span ref={scrollEndRef} aria-hidden="true" className="h-px w-px shrink-0" />
        </HorizontalScrollFade>
      </div>
      {trailing ? <div className="shrink-0 pb-1">{trailing}</div> : null}
    </Stack>
  );
}
