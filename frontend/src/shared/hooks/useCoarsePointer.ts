import { useEffect, useState } from "react";

/** Touch and stylus pointers, which have no hover state. */
export const COARSE_POINTER_MEDIA = "(hover: none), (pointer: coarse)";

/**
 * Whether the device is driven by a coarse pointer (touch).
 *
 * Starts `false` so the server and the first client render agree; the real
 * value lands in the effect. Callers must therefore treat `false` as "not yet
 * known to be touch" rather than "definitely a mouse".
 *
 * Used to suppress autofocus on touch devices: focusing an input on mount pops
 * the on-screen keyboard and makes mobile browsers scroll and scale into the
 * field before the user has chosen to type.
 */
export function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(COARSE_POINTER_MEDIA);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCoarsePointer(media.matches);

    const listener = (event: MediaQueryListEvent) => {
      setIsCoarsePointer(event.matches);
    };

    media.addEventListener("change", listener);
    return () => media.removeEventListener("change", listener);
  }, []);

  return isCoarsePointer;
}
