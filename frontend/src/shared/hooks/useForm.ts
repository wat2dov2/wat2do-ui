import { useState, useEffect, useCallback, useMemo, useRef } from "react";

interface UseFormOptions<T extends object> {
  initialData?: T;
  isEditMode?: boolean;
  isOpen: boolean;
  validate?: (data: T, touched: Record<string, boolean>) => Record<string, string>;
  getDefaults: () => T;
}

export function useForm<T extends object>(
  options: UseFormOptions<T>
) {
  const { initialData, isEditMode = false, isOpen, validate, getDefaults } = options;

  const getInitialFormData = useCallback((): T => {
    if (isEditMode && initialData) {
      return initialData;
    }
    return getDefaults();
  }, [isEditMode, initialData, getDefaults]);

  const [formData, setFormData] = useState<T>(getInitialFormData);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const prevIsOpenRef = useRef(isOpen);

  const reset = useCallback(() => {
    const newData = getInitialFormData();
    setFormData(newData);
    setTouched({});
  }, [getInitialFormData]);

  // Reset only when opening, not when input props change while editing.
  useEffect(() => {
    const wasClosed = !prevIsOpenRef.current && isOpen;
    if (wasClosed) {
      reset();
    }
    prevIsOpenRef.current = isOpen;
  }, [isOpen, reset]);

  const errors = useMemo<Record<string, string>>(() => {
    if (!validate) return {};
    return validate(formData, touched);
    // Preserve validation on field/touched changes, not callback identity.
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
