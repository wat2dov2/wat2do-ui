import { useEffect, useState } from "react";
import { MAIN_CONTENT_SCROLL_ROOT_SELECTOR } from "@/shared/constants/ui";

interface DateAnchor {
  top: number;
  date: string;
}

/** Track the actual card rows, including filtered and progressively loaded results. */
export function useScrollDateWheel() {
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
        const rootTop = root.getBoundingClientRect().top;
        anchors = [];
        let previousRowTop = -Infinity;
        for (const node of root.querySelectorAll<HTMLElement>("[data-scroll-date]")) {
          const top = node.getBoundingClientRect().top - rootTop + root.scrollTop;
          const date = node.dataset.scrollDate ?? "";
          // A grid row gets one date. Repeated dates do not waste wheel stops.
          if (Math.abs(previousRowTop - top) < 2) continue;
          previousRowTop = top;
          if (anchors.at(-1)?.date === date) continue;
          anchors.push({ top, date });
        }
        dates = anchors.map(anchor => anchor.date);
        needsMeasure = false;
      }
      const readingLine = root.scrollTop + root.clientHeight * 0.42;
      let active = 0;
      for (let index = 1; index < anchors.length; index++) {
        if (anchors[index].top > readingLine) break;
        active = index;
      }
      setState({
        visible: scrolling && root.scrollTop > 12 && anchors.length > 0,
        rotation: root.scrollTop / 4,
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
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-scroll-date"] });
    const resize = new ResizeObserver(measure);
    resize.observe(root);
    // The page's content height changes when more cards or translated copy arrive.
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
  }, []);

  return state;
}
