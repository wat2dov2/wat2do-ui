import { useState, useEffect, useCallback, useRef } from "react";

interface UseFormOptions<T extends Record<string, unknown>> {
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
export function useForm<T extends Record<string, unknown>>(
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
  const [errors, setErrors] = useState<Record<string, string>>({});
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
      setErrors({});
      setTouched({});
    }
    prevIsOpenRef.current = isOpen;
    // Only depend on isOpen to prevent loops - initialData changes are handled separately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Validate on change
  useEffect(() => {
    if (validate) {
      const newErrors = validate(formData, touched);
      setErrors(newErrors);
    }
  }, [formData, touched, validate]);

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
    setErrors({});
    setTouched({});
  }, [getInitialFormData]);

  // Check if form is valid
  const isValid = validate
    ? Object.keys(validate(formData, touched)).length === 0
    : true;

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
