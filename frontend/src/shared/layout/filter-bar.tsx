import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { useHorizontalScrollFade } from "@/shared/hooks/useHorizontalScrollFade";
import { HorizontalScrollFade } from "@/shared/ui/horizontal-scroll-fade";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";
import { Stack } from "@/shared/layout/stack";

interface FilterBarProps {
  children: ReactNode;
  trailing?: ReactNode;
  refreshKey?: unknown;
  /** Changes only when a search or filter is applied, never when results refresh. */
  appliedQueryKey?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "data-testid"?: string;
}

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** One scrolling filter row, with optional controls pinned outside its fade. */
export function FilterBar({ children, trailing, refreshKey, appliedQueryKey, disabled = false, ...props }: FilterBarProps) {
  const previousQueryKey = useRef(appliedQueryKey);
  useEffect(() => {
    if (previousQueryKey.current === appliedQueryKey) return;
    previousQueryKey.current = appliedQueryKey;
    document.querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR)
      ?.scrollTo({ top: 0, behavior: "instant" });
  }, [appliedQueryKey]);

  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const unavailable = disabled || !hydrated;
  const { scrollRef, scrollEndRef, showScrollFade, syncScrollFade,
    syncScrollFadeAfterWheel, dragScrollProps } = useHorizontalScrollFade({ refreshKey });
  return (
    <fieldset data-activation="click" disabled={unavailable} aria-busy={unavailable} className="min-w-0 border-0 p-0 disabled:pointer-events-none">
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
    </fieldset>
  );
}
