import * as React from "react";

type Event = MouseEvent | TouchEvent;

export function useOnClickOutside<T extends HTMLElement = HTMLElement>(
  ref: React.RefObject<T>,
  handler: (event: Event) => void
) {
  React.useEffect(() => {
    const listener = (event: Event) => {
      const el = ref?.current;

      // Do nothing if clicking ref's element or descendent elements
      if (!el || el.contains((event?.target as Node) || null)) {
        return;
      }

      handler(event);
    };

    document.addEventListener("mousedown", listener);
    // Listener never calls preventDefault, so passive is safe and avoids
    // blocking scroll on touch devices.
    document.addEventListener("touchstart", listener, { passive: true });

    return () => {
      document.removeEventListener("mousedown", listener);
      document.removeEventListener("touchstart", listener);
    };
  }, [ref, handler]);
}

