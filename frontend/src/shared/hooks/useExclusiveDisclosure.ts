import { useCallback, useEffect, useId, useState } from "react";

const EXCLUSIVE_DISCLOSURE_OPEN_EVENT = "wat2do:exclusive-disclosure-open";
const DEFAULT_DISCLOSURE_SCOPE = "floating-disclosure";

interface ExclusiveDisclosureDetail {
  id: string;
  scope: string;
}

interface UseExclusiveDisclosureOptions {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  scope?: string;
}

export function useExclusiveDisclosure({
  open,
  defaultOpen = false,
  onOpenChange,
  scope = DEFAULT_DISCLOSURE_SCOPE,
}: UseExclusiveDisclosureOptions) {
  const id = useId();
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const currentOpen = isControlled ? open : uncontrolledOpen;

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }
      onOpenChange?.(nextOpen);

      if (nextOpen && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent<ExclusiveDisclosureDetail>(EXCLUSIVE_DISCLOSURE_OPEN_EVENT, {
            detail: { id, scope },
          }),
        );
      }
    },
    [id, isControlled, onOpenChange, scope],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const closeWhenAnotherDisclosureOpens = (event: Event) => {
      const detail = (event as CustomEvent<ExclusiveDisclosureDetail>).detail;
      if (!detail || detail.scope !== scope || detail.id === id) return;

      if (!isControlled) {
        setUncontrolledOpen(false);
      }
      onOpenChange?.(false);
    };

    window.addEventListener(EXCLUSIVE_DISCLOSURE_OPEN_EVENT, closeWhenAnotherDisclosureOpens);
    return () => {
      window.removeEventListener(EXCLUSIVE_DISCLOSURE_OPEN_EVENT, closeWhenAnotherDisclosureOpens);
    };
  }, [id, isControlled, onOpenChange, scope]);

  return [currentOpen, setOpen] as const;
}
