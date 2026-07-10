import { useState, useCallback } from "react";

export interface UseTagInputOptions {
  onAdd?: (value: string) => void;
}

export interface UseTagInputReturn {
  inputValue: string;
  setInputValue: (value: string) => void;
  handleAdd: () => void;
  reset: () => void;
}

/** Reset should be called explicitly when the modal closes. */
export function useTagInput(options: UseTagInputOptions = {}): UseTagInputReturn {
  const { onAdd } = options;
  const [inputValue, setInputValue] = useState("");

  const handleAdd = useCallback(() => {
    const value = inputValue.trim();
    if (value && onAdd) {
      onAdd(value);
      setInputValue("");
    }
  }, [inputValue, onAdd]);

  const reset = useCallback(() => {
    setInputValue("");
  }, []);

  return {
    inputValue,
    setInputValue,
    handleAdd,
    reset,
  };
}
