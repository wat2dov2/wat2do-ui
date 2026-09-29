import { useEffect, useState } from "react";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

interface DateAnchor {
  top: number;
  date: string;
}

export interface ScrollDateGroup {
  key: string;
  dates: readonly string[];
}

/** Use rendered rows where available and estimate the rest of the cached feed. */
function measureFeedAnchors(root: HTMLElement, groups?: readonly ScrollDateGroup[]): DateAnchor[] {
  const rootTop = root.getBoundingClientRect().top;
  const anchors: DateAnchor[] = [];
  const append = (top: number, date: string) => {
    if (anchors.at(-1)?.date !== date) anchors.push({ top, date });
  };
  if (!groups) {
    let previousRowTop = -Infinity;
    for (const node of root.querySelectorAll<HTMLElement>("[data-scroll-date]")) {
      const top = node.getBoundingClientRect().top - rootTop + root.scrollTop;
      if (Math.abs(previousRowTop - top) < 2) continue;
      previousRowTop = top;
      append(top, node.dataset.scrollDate ?? "");
    }
    return anchors;
  }

  const grids = new Map(
    Array.from(root.querySelectorAll<HTMLElement>("[data-scroll-date-group]"), grid => [grid.dataset.scrollDateGroup, grid]),
  );
  const firstGrid: HTMLElement | undefined = grids.values().next().value;
  if (!firstGrid) return anchors;
  // Computed tracks already account for viewport width, page gutters and rem size.
  // Reuse the grid's CSS instead of duplicating its responsive breakpoints here.
  const style = getComputedStyle(firstGrid);
  const columns = Math.max(1, style.gridTemplateColumns.split(/\s+/).length);
  const rowGap = parseFloat(style.rowGap) || 0;
  const firstCard = firstGrid.querySelector<HTMLElement>("[data-scroll-date]");
  if (!firstCard) return anchors;
  const firstRect = firstCard.getBoundingClientRect();
  const section = firstGrid.closest<HTMLElement>("[data-scroll-date-section]");
  const sectionGap = section
    ? firstGrid.getBoundingClientRect().top - section.getBoundingClientRect().top + (parseFloat(getComputedStyle(section).marginBottom) || 0)
    : 0;
  let estimatedHeight = firstRect.height;
  let nextTop = firstRect.top - rootTop + root.scrollTop;

  for (const group of groups) {
    const grid = grids.get(group.key);
    const renderedRows: { top: number; height: number }[] = [];
    if (grid) {
      // One geometry read per rendered row, never per cached event or scroll tick.
      for (let index = 0; index < grid.children.length; index += columns) {
        const card = grid.children[index].querySelector<HTMLElement>("[data-scroll-date]");
        if (!card) break;
        const rect = card.getBoundingClientRect();
        renderedRows.push({ top: rect.top - rootTop + root.scrollTop, height: rect.height });
      }
    }
    if (renderedRows.length) {
      estimatedHeight = renderedRows.reduce((sum, row) => sum + row.height, 0) / renderedRows.length;
    }
    for (let index = 0; index < group.dates.length; index += columns) {
      const row = renderedRows[index / columns];
      const top = row?.top ?? nextTop;
      append(top, group.dates[index]);
      nextTop = top + (row?.height ?? estimatedHeight) + rowGap;
    }
    nextTop += sectionGap - rowGap;
  }
  return anchors;
}

/** Cached feed forecasts are optional: filtered lists continue to follow actual DOM rows. */
export function useScrollDateWheel(groups?: readonly ScrollDateGroup[]) {
  const [state, setState] = useState({
    visible: false,
    rotation: 0,
    dates: [] as string[],
    active: 0,
  });

  useEffect(() => {
    const root = document.querySelector<HTMLElement>(MAIN_CONTENT_SCROLL_ROOT_SELECTOR);
    if (!root) return;
    let anchors: DateAnchor[] = [];
    let dates: string[] = [];
    let frame = 0;
    let hideTimer: ReturnType<typeof setTimeout>;
    let scrolling = false;
    let needsMeasure = true;

    const sync = () => {
      frame = 0;
      if (needsMeasure) {
        anchors = measureFeedAnchors(root, groups);
        dates = anchors.map(anchor => anchor.date);
        needsMeasure = false;
      }
      const readingLine = root.scrollTop + root.clientHeight * 0.42;
      // Binary search keeps scroll work bounded even for a complete cached feed.
      let active = 0;
      let upper = anchors.length;
      while (active + 1 < upper) {
        const middle = Math.floor((active + upper) / 2);
        if (anchors[middle].top <= readingLine) active = middle;
        else upper = middle;
      }
      const current = anchors[active];
      const next = anchors[active + 1];
      const progress = current && next
        ? Math.max(0, Math.min(1, (readingLine - current.top) / (next.top - current.top)))
        : 0;
      setState({
        visible: scrolling && root.scrollTop > 12 && anchors.length > 0,
        rotation: (active + progress) * 36,
        dates,
        active,
      });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const measure = () => {
      needsMeasure = true;
      schedule();
    };
    const onScroll = () => {
      scrolling = true;
      clearTimeout(hideTimer);
      schedule();
      hideTimer = setTimeout(() => {
        scrolling = false;
        schedule();
      }, 400);
    };
    const mutations = new MutationObserver(measure);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-scroll-date", "data-scroll-date-group"] });
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    for (const child of root.children) resize.observe(child);
    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", measure);
    measure();
    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", measure);
      mutations.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(hideTimer);
    };
  }, [groups]);

  return state;
}
