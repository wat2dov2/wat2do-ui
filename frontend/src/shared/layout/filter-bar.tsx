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

/** The sticky listing header a filter bar sits in, which pins at the top of the page's scroller. */
const LISTING_HEADER_SELECTOR = '[data-slot="page-header"]';

/**
 * Where an element would sit in its scroller if nothing pinned it. A sticky
 * element reports where it is pinned, so it is measured as a plain one for a moment.
 */
function restingOffset(element: HTMLElement, root: HTMLElement): number {
  const { position } = element.style;
  element.style.position = "relative";
  const offset = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  element.style.position = position;
  return Math.round(offset);
}

/**
 * Brings a new search or filter's results into view: the scroller moves to
 * where the header pins, so the results start right under it. It never goes to
 * the top of the page, so whatever sits above the header (a page's highlights)
 * stays where it was, a scroll up away.
 */
function showNewResults(bar: HTMLElement) {
  const root = bar.closest<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR);
  if (!root) return;
  root.scrollTo({ top: restingOffset(bar.closest<HTMLElement>(LISTING_HEADER_SELECTOR) ?? bar, root), behavior: "instant" });
}

const subscribeToHydration = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

/** One scrolling filter row, with optional controls pinned outside its fade. */
export function FilterBar({ children, trailing, refreshKey, appliedQueryKey, disabled = false, ...props }: FilterBarProps) {
  const barRef = useRef<HTMLFieldSetElement>(null);
  const previousQueryKey = useRef(appliedQueryKey);
  useEffect(() => {
    if (previousQueryKey.current === appliedQueryKey) return;
    previousQueryKey.current = appliedQueryKey;
    if (barRef.current) showNewResults(barRef.current);
  }, [appliedQueryKey]);

  const hydrated = useSyncExternalStore(subscribeToHydration, clientReady, serverReady);
  const unavailable = disabled || !hydrated;
  const { scrollRef, scrollEndRef, showScrollFade, syncScrollFade,
    syncScrollFadeAfterWheel, dragScrollProps } = useHorizontalScrollFade({ refreshKey });
  return (
    <fieldset ref={barRef} data-skeleton-key="filter-bar" data-activation="click" disabled={unavailable} aria-busy={unavailable} className="min-w-0 border-0 p-0 disabled:pointer-events-none">
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
