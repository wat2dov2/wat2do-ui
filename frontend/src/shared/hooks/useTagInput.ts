import { useState, useCallback } from "react";

interface UseTagInputOptions {
  onAdd: (value: string) => void;
}

/** Reset should be called explicitly when the modal closes. */
export function useTagInput(options: UseTagInputOptions) {
  const { onAdd } = options;
  const [inputValue, setInputValue] = useState("");

  const handleAdd = useCallback(() => {
    const value = inputValue.trim();
    if (value) {
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
