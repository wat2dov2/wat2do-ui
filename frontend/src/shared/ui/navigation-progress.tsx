"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

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

/** Route fallbacks and busy lists own loading; clicks alone do not. */
export function NavigationProgress() {
  const [state, setState] = useState<ProgressState>(IDLE_STATE);
  const activeRef = useRef(false);
  const animationFrameRef = useRef<number | null>(null);
  const timersRef = useRef<number[]>([]);

  const clearScheduledUpdates = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    timersRef.current.forEach(window.clearTimeout);
    timersRef.current = [];
  }, []);

  const start = useCallback(() => {
    if (activeRef.current) {
      return;
    }

    clearScheduledUpdates();
    activeRef.current = true;
    animationFrameRef.current = window.requestAnimationFrame(() => {
      setState({
        phase: "priming",
        progress: 0,
        visible: true,
      });
      animationFrameRef.current = window.requestAnimationFrame(() => {
        setState((current) => ({
          phase: "starting",
          progress: Math.max(current.progress, 42),
          visible: true,
        }));
      });
    });

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

  useEffect(() => {
    const syncLoading = () => {
      if (document.querySelector(NAVIGATION_PENDING_SELECTOR)) {
        start();
      } else {
        finish();
      }
    };

    const loadingObserver = new MutationObserver(syncLoading);
    loadingObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy", "data-slot"],
    });
    syncLoading();
    return () => {
      loadingObserver.disconnect();
      clearScheduledUpdates();
      activeRef.current = false;
    };
  }, [clearScheduledUpdates, finish, start]);

  return (
    <div
      aria-hidden="true"
      data-slot="navigation-progress"
      data-state={state.phase}
      className={`pointer-events-none fixed inset-x-0 top-0 z-[var(--z-index-max)] h-0.5 overflow-hidden motion-reduce:transition-none ${state.visible ? "opacity-100 transition-none" : "opacity-0 transition-opacity duration-150"}`}
    >
      <div
        className={`h-full w-full origin-left bg-primary transition-transform ease-out motion-reduce:transition-none ${state.phase === "priming" ? "duration-0" : state.phase === "loading" ? "duration-700" : "duration-150"}`}
        style={{ transform: `scaleX(${state.progress / 100})` }}
      />
    </div>
  );
}
