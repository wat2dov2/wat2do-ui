import { useState, useEffect, useCallback } from "react";
import type { EventFormData } from "@/types";
import {
  validateEventForm,
  isEventFormValid,
  markAllFieldsTouched,
} from "@/services/validationService";
import { generateEventWithAI } from "@/lib/openai";

interface ValidationErrors {
  title?: string;
  organization?: string;
  date?: string;
  time?: string;
  location?: string;
}

interface UseEventFormOptions {
  initialData?: EventFormData;
  isEditMode?: boolean;
  isOpen: boolean;
}

/**
 * Get smart defaults for form (today's date, next hour)
 */
function getSmartDefaults() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  const time = `${nextHour.getHours().toString().padStart(2, "0")}:00`;
  return { date: today, time };
}

/**
 * Custom hook for managing event form state and validation
 */
export function useEventForm(options: UseEventFormOptions) {
  const { initialData, isEditMode = false, isOpen } = options;

  const smartDefaults = getSmartDefaults();

  const [formData, setFormData] = useState<EventFormData>(() => {
    if (isEditMode && initialData) {
      return initialData;
    }
    return {
      title: "",
      description: "",
      date: smartDefaults.date,
      time: smartDefaults.time,
      location: "",
      category: "",
      price: 0,
      food: [],
      requiresRegistration: false,
      organization: "",
    };
  });

  // Date picker state - convert string date to Date object
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() => {
    const dateStr = isEditMode && initialData?.date ? initialData.date : smartDefaults.date;
    if (dateStr) {
      const date = new Date(dateStr);
      return isNaN(date.getTime()) ? undefined : date;
    }
    return undefined;
  });

  const [foodInput, setFoodInput] = useState("");
  const [errors, setErrors] = useState<ValidationErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // JSON Editor state
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState("");

  // AI state
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      const defaults = getSmartDefaults();

      if (isEditMode && initialData) {
        setFormData(initialData);
        if (initialData.date) {
          const date = new Date(initialData.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
      } else {
        setFormData({
          title: "",
          description: "",
          date: defaults.date,
          time: defaults.time,
          location: "",
          category: "",
          price: 0,
          food: [],
          requiresRegistration: false,
          organization: "",
        });
        if (defaults.date) {
          const date = new Date(defaults.date);
          setSelectedDate(isNaN(date.getTime()) ? undefined : date);
        } else {
          setSelectedDate(undefined);
        }
      }

      setErrors({});
      setTouched({});
      setJsonValue("");
      setJsonError("");
      setAiPrompt("");
      setFoodInput("");
    }
  }, [isOpen, isEditMode, initialData]);

  // Validate on change
  useEffect(() => {
    const newErrors = validateEventForm(formData, touched);
    setErrors(newErrors);
  }, [formData, touched]);

  const handleBlur = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  // Handle JSON changes
  const handleJsonChange = useCallback(
    (value: string | undefined) => {
      if (!value) return;
      setJsonValue(value);

      try {
        const parsed = JSON.parse(value);
        setJsonError("");

        // Update form data from JSON
        setFormData({
          title: parsed.title || "",
          description: parsed.description || "",
          date: parsed.date || smartDefaults.date,
          time: parsed.time || smartDefaults.time,
          location: parsed.location || "",
          category: parsed.category || "",
          price: typeof parsed.price === "number" ? parsed.price : 0,
          food: Array.isArray(parsed.food) ? parsed.food : [],
          requiresRegistration:
            typeof parsed.requiresRegistration === "boolean"
              ? parsed.requiresRegistration
              : false,
          organization: parsed.organization || "",
        });
      } catch {
        setJsonError("Invalid JSON format");
      }
    },
    [smartDefaults.date, smartDefaults.time]
  );

  // Handle AI generation
  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    setAiGenerating(true);
    setJsonError("");

    try {
      const newEvent = await generateEventWithAI(aiPrompt, (partialJson) => {
        setJsonValue(partialJson);
      });

      const generatedJson = JSON.stringify(newEvent, null, 2);
      setJsonValue(generatedJson);
      handleJsonChange(generatedJson);
    } catch (error) {
      setJsonError(
        error instanceof Error ? error.message : "Failed to generate event"
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, handleJsonChange]);

  // Add food item
  const addFood = useCallback(() => {
    if (foodInput.trim()) {
      setFormData((prev) => ({
        ...prev,
        food: [...prev.food, foodInput.trim()],
      }));
      setFoodInput("");
    }
  }, [foodInput]);

  // Remove food item
  const removeFood = useCallback((index: number) => {
    setFormData((prev) => ({
      ...prev,
      food: prev.food.filter((_, i) => i !== index),
    }));
  }, []);

  // Update form field
  const updateField = useCallback(
    <K extends keyof EventFormData>(
      field: K,
      value: EventFormData[K]
    ) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    []
  );

  // Sync selectedDate with formData.date
  const handleDateChange = useCallback((date: Date | undefined) => {
    setSelectedDate(date);
    if (date) {
      const dateStr = date.toISOString().split("T")[0];
      setFormData((prev) => ({ ...prev, date: dateStr }));
    }
  }, []);

  // Check if form is valid
  const isValid = isEventFormValid(formData, errors);

  // Sync formData to JSON when needed
  const syncToJSON = useCallback(() => {
    setJsonValue(JSON.stringify(formData, null, 2));
  }, [formData]);

  return {
    // Form data
    formData,
    setFormData,
    updateField,

    // Date picker
    selectedDate,
    handleDateChange,

    // Food management
    foodInput,
    setFoodInput,
    addFood,
    removeFood,

    // Validation
    errors,
    touched,
    handleBlur,
    isValid,

    // JSON editor
    jsonValue,
    setJsonValue,
    jsonError,
    setJsonError,
    handleJsonChange,
    syncToJSON,

    // AI generation
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,

    // Utilities
    markAllFieldsTouched: () => setTouched(markAllFieldsTouched()),
  };
}
