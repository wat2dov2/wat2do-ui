"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether anything has asked to show a toast yet.
 *
 * The toast library injects its stylesheet as soon as it is imported, which makes
 * the browser recalculate every style on the page. Most visits never show a toast,
 * so the Toaster mounts (and the library loads) only once the first one is asked for.
 */
let requested = false;
const listeners = new Set<() => void>();

export function requestToaster(): void {
  if (requested) return;
  requested = true;
  listeners.forEach((listener) => listener());
}

export function useToasterRequested(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => requested,
    () => false,
  );
}

type ShowToast = (toast: typeof import("sonner").toast) => void;

let mountedToast: typeof import("sonner").toast | null = null;
const queued: ShowToast[] = [];

/** Show a toast now if the Toaster is up, otherwise as soon as it mounts. */
export function whenToasterReady(show: ShowToast): void {
  if (mountedToast) {
    show(mountedToast);
    return;
  }
  queued.push(show);
  requestToaster();
}

/** Called by the Toaster once it has subscribed, so queued toasts are not lost. */
export function toasterMounted(toast: typeof import("sonner").toast): void {
  mountedToast = toast;
  queued.splice(0).forEach((show) => show(toast));
}
