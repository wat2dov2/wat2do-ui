import { useCallback, type KeyboardEvent } from "react";

interface UseEnterKeySubmitOptions<TElement extends HTMLElement> {
  onSubmit: (event: KeyboardEvent<TElement>) => void | Promise<void>;
  disabled?: boolean;
}

export function useEnterKeySubmit<TElement extends HTMLElement>({
  onSubmit,
  disabled = false,
}: UseEnterKeySubmitOptions<TElement>) {
  return useCallback(
    (event: KeyboardEvent<TElement>) => {
      if (disabled || event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      void onSubmit(event);
    },
    [disabled, onSubmit],
  );
}
