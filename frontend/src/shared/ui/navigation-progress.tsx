"use client";

import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

type ProgressPhase =
  | "idle"
  | "priming"
  | "starting"
  | "loading"
  | "completing";

interface ProgressState {
  phase: ProgressPhase;
  progress: number;
  visible: boolean;
}

const IDLE_STATE: ProgressState = {
  phase: "idle",
  progress: 0,
  visible: false,
};

const PROGRESS_STAGES = [
  { delay: 180, progress: 58 },
  { delay: 500, progress: 70 },
  { delay: 900, progress: 79 },
  { delay: 1_500, progress: 86 },
  { delay: 2_400, progress: 91 },
  { delay: 3_600, progress: 94 },
] as const;

const NAVIGATION_PENDING_SELECTOR =
  '[data-slot="loading-page"], [aria-busy="true"]';

function isHashOnlyNavigation(currentUrl: URL, destinationUrl: URL) {
  return (
    currentUrl.origin === destinationUrl.origin &&
    currentUrl.pathname === destinationUrl.pathname &&
    currentUrl.search === destinationUrl.search &&
    currentUrl.hash !== destinationUrl.hash
  );
}

function getClickedDestination(event: MouseEvent) {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return null;
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const anchor = target.closest<HTMLAnchorElement>("a[href]");
  if (
    !anchor ||
    anchor.hasAttribute("download") ||
    anchor.getAttribute("aria-disabled") === "true" ||
    (anchor.target && anchor.target !== "_self")
  ) {
    return null;
  }

  const destinationUrl = new URL(anchor.href, window.location.href);
  if (!["http:", "https:"].includes(destinationUrl.protocol)) {
    return null;
  }

  const currentUrl = new URL(window.location.href);
  if (
    destinationUrl.href === currentUrl.href ||
    isHashOnlyNavigation(currentUrl, destinationUrl)
  ) {
    return null;
  }

  return destinationUrl;
}

/**
 * Global visual feedback for route changes.
 *
 * Next App Router does not expose route lifecycle events, so navigation starts
 * are observed at their browser entry points. A committed URL identifies the
 * destination, then the shared loading primitives keep the bar active until the
 * destination content is ready.
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [state, setState] = useState<ProgressState>(IDLE_STATE);
  const activeRef = useRef(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);
  const previousRouteKeyRef = useRef(routeKey);
  const routeCommittedRef = useRef(false);

  const clearScheduledUpdates = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
  }, []);

  const start = useCallback((synchronous = false) => {
    clearScheduledUpdates();
    activeRef.current = true;
    routeCommittedRef.current = false;
    const prime = () => {
      setState({
        phase: "priming",
        progress: 0,
        visible: true,
      });
    };

    const advance = () => {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setState((current) => ({
          phase: "starting",
          progress: Math.max(current.progress, 42),
          visible: true,
        }));
      });
    };

    if (synchronous) {
      flushSync(prime);
      progressBarRef.current?.getBoundingClientRect();
      advance();
    } else {
      // Next may update history inside an insertion effect; defer React state writes.
      animationFrameRef.current = window.requestAnimationFrame(() => {
        prime();
        advance();
      });
    }

    PROGRESS_STAGES.forEach(({ delay, progress }) => {
      timersRef.current.push(
        window.setTimeout(() => {
          if (!activeRef.current) {
            return;
          }
          setState((current) => ({
            phase: "loading",
            progress: Math.max(current.progress, progress),
            visible: true,
          }));
        }, delay),
      );
    });
  }, [clearScheduledUpdates]);

  const finish = useCallback(() => {
    if (!activeRef.current) {
      return;
    }

    activeRef.current = false;
    routeCommittedRef.current = false;
    clearScheduledUpdates();
    setState({ phase: "completing", progress: 100, visible: true });

    timersRef.current.push(
      window.setTimeout(() => {
        setState({ phase: "idle", progress: 100, visible: false });
      }, 180),
      window.setTimeout(() => {
        setState(IDLE_STATE);
      }, 340),
    );
  }, [clearScheduledUpdates]);

  const finishWhenContentIsReady = useCallback(() => {
    if (
      !routeCommittedRef.current ||
      document.querySelector(NAVIGATION_PENDING_SELECTOR)
    ) {
      return;
    }

    finish();
  }, [finish]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (getClickedDestination(event)) {
        start(true);
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [start]);

  useEffect(() => {
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    const shouldStartForHistoryUrl = (url?: string | URL | null) => {
      if (url === undefined || url === null) {
        return false;
      }

      const currentUrl = new URL(window.location.href);
      const destinationUrl = new URL(url.toString(), currentUrl);
      return (
        destinationUrl.href !== currentUrl.href &&
        !isHashOnlyNavigation(currentUrl, destinationUrl)
      );
    };

    const patchedPushState: History["pushState"] = function (data, unused, url) {
      if (shouldStartForHistoryUrl(url)) {
        start();
      }
      return originalPushState.call(window.history, data, unused, url);
    };
    const patchedReplaceState: History["replaceState"] = function (data, unused, url) {
      if (shouldStartForHistoryUrl(url)) {
        start();
      }
      return originalReplaceState.call(window.history, data, unused, url);
    };
    const handlePopState = () => start();

    window.history.pushState = patchedPushState;
    window.history.replaceState = patchedReplaceState;
    window.addEventListener("popstate", handlePopState);

    return () => {
      if (window.history.pushState === patchedPushState) {
        window.history.pushState = originalPushState;
      }
      if (window.history.replaceState === patchedReplaceState) {
        window.history.replaceState = originalReplaceState;
      }
      window.removeEventListener("popstate", handlePopState);
    };
  }, [start]);

  useEffect(() => {
    const loadingObserver = new MutationObserver(finishWhenContentIsReady);
    loadingObserver.observe(document.body, { childList: true, subtree: true });
    return () => loadingObserver.disconnect();
  }, [finishWhenContentIsReady]);

  useEffect(() => {
    if (routeKey === previousRouteKeyRef.current) {
      return;
    }

    previousRouteKeyRef.current = routeKey;
    routeCommittedRef.current = true;
    const completionFrame = window.requestAnimationFrame(
      finishWhenContentIsReady,
    );
    return () => window.cancelAnimationFrame(completionFrame);
  }, [finishWhenContentIsReady, routeKey]);

  useEffect(() => clearScheduledUpdates, [clearScheduledUpdates]);

  return (
    <div
      aria-hidden="true"
      data-slot="navigation-progress"
      data-state={state.phase}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[var(--z-index-max)] h-0.5 overflow-hidden motion-reduce:transition-none ${state.visible ? "opacity-100 transition-none" : "opacity-0 transition-opacity duration-150"}`}
    >
      <div
        ref={progressBarRef}
        className={`h-full w-full origin-left bg-primary transition-transform ease-out motion-reduce:transition-none ${state.phase === "priming" ? "duration-0" : state.phase === "loading" ? "duration-700" : "duration-150"}`}
        style={{ transform: `scaleX(${state.progress / 100})` }}
      />
    </div>
  );
}
