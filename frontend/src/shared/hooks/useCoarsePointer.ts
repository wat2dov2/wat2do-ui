import { useEffect, useState } from "react";

/** Touch and stylus pointers, which have no hover state. */
export const COARSE_POINTER_MEDIA = "(hover: none), (pointer: coarse)";

/**
 * Whether the device is driven by a coarse pointer (touch).
 *
 * Resolved synchronously on the first client render, not in an effect. Callers
 * gate mount-time behaviour on this - React applies `autoFocus` during the
 * initial commit, so a value that only arrives in an effect lands after the
 * decision it was meant to inform has already been made.
 *
 * Server renders get `false`, since the device is unknowable there. Markup that
 * is server-rendered and depends on this therefore hydrates from the desktop
 * branch; surfaces that mount client-side, such as drawer content, get the real
 * value immediately.
 *
 * Used to suppress autofocus on touch: focusing an input on mount pops the
 * on-screen keyboard and makes mobile browsers scroll and scale into the field
 * before the user has chosen to type.
 */
export function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window === "undefined"
      ? false
      : window.matchMedia(COARSE_POINTER_MEDIA).matches,
  );

  useEffect(() => {
    const media = window.matchMedia(COARSE_POINTER_MEDIA);
    if (media.matches !== isCoarsePointer) {
      setIsCoarsePointer(media.matches);
    }

    const listener = (event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches);
    };

    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
    // Sync once on mount and then follow the media query; re-subscribing on
    // every value change would tear down the listener that reported it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return isCoarsePointer;
}
