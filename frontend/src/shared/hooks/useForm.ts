import { useState, useEffect, useCallback, useMemo, useRef } from "react";

interface UseFormOptions<T extends object> {
  initialData?: T;
  isEditMode?: boolean;
  isOpen: boolean;
  validate?: (data: T, touched: Record<string, boolean>) => Record<string, string>;
  getDefaults?: () => T;
}

interface UseFormReturn<T> {
  formData: T;
  setFormData: React.Dispatch<React.SetStateAction<T>>;
  updateField: <K extends keyof T>(field: K, value: T[K]) => void;
  errors: Record<string, string>;
  touched: Record<string, boolean>;
  handleBlur: (field: string) => void;
  isValid: boolean;
  reset: () => void;
}

/**
 * Generic form hook for managing form state and validation
 * Works with any form data structure
 */
export function useForm<T extends object>(
  options: UseFormOptions<T>
): UseFormReturn<T> {
  const { initialData, isEditMode = false, isOpen, validate, getDefaults } = options;

  const getInitialFormData = useCallback((): T => {
    if (isEditMode && initialData) {
      return initialData;
    }
    if (getDefaults) {
      return getDefaults();
    }
    return {} as T;
  }, [isEditMode, initialData, getDefaults]);

  const [formData, setFormData] = useState<T>(getInitialFormData);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const prevIsOpenRef = useRef(isOpen);

  // Reset form when modal opens (only when transitioning from closed to open)
  // This prevents infinite loops while still resetting when the modal opens
  useEffect(() => {
    const wasClosed = !prevIsOpenRef.current && isOpen;
    if (wasClosed) {
      const newData = isEditMode && initialData
        ? initialData
        : (getDefaults ? getDefaults() : {} as T);
      setFormData(newData);
      setTouched({});
    }
    prevIsOpenRef.current = isOpen;
    // Only depend on isOpen to prevent loops - initialData changes are handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Compute errors via useMemo to avoid infinite loops when `validate` is not
  // memoized by the caller. This is the same pattern used in useEventForm.
  const errors = useMemo<Record<string, string>>(() => {
    if (!validate) return {};
    return validate(formData, touched);
    // We intentionally avoid depending on `validate` directly because callers
    // often pass an inline closure. The computed value only needs to refresh
    // when formData or touched changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, touched]);

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const updateField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  const reset = useCallback(() => {
    const newData = getInitialFormData();
    setFormData(newData);
    setTouched({});
  }, [getInitialFormData]);

  const isValid = Object.keys(errors).length === 0;

  return {
    formData,
    setFormData,
    updateField,
    errors,
    touched,
    handleBlur,
    isValid,
    reset,
  };
}
