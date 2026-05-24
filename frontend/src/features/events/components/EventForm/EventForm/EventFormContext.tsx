import React, { createContext, useContext } from "react";
import type { EventFormData, EventFormOccurrence, ValidationErrors } from "@/shared/types";

interface EventFormContextValue {
  formData: EventFormData;
  updateField: <K extends keyof EventFormData>(
    field: K,
    value: EventFormData[K]
  ) => void;
  errors: ValidationErrors;
  touched: Record<string, boolean>;
  handleBlur: (field: string) => void;
  updateOccurrence: (index: number, field: keyof EventFormOccurrence, value: string) => void;
  addOccurrence: () => void;
  removeOccurrence: (index: number) => void;
  foodInput: string;
  setFoodInput: (value: string) => void;
  addFood: () => void;
  removeFood: (index: number) => void;
  // JSON Editor state
  jsonValue: string;
  jsonError: string;
  handleJsonChange: (value: string | undefined) => void;
  syncToJSON: () => void;
  // Image upload
  imagePreview: string;
  imageFile: File | null;
  onImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveImage: () => void;
  // AI Generation state
  aiPrompt: string;
  setAiPrompt: (prompt: string) => void;
  aiGenerating: boolean;
  handleAiGenerate: () => Promise<void>;
  isDarkMode?: boolean;
}

const EventFormContext = createContext<EventFormContextValue | null>(null);

interface EventFormProviderProps {
  children: React.ReactNode;
  value: EventFormContextValue;
}

export function EventFormProvider({
  children,
  value,
}: EventFormProviderProps) {
  return (
    <EventFormContext.Provider value={value}>
      {children}
    </EventFormContext.Provider>
  );
}

// This file intentionally exports the provider and its colocated hook together
// to avoid touching the in-progress event form consumers during cleanup.
// eslint-disable-next-line react-refresh/only-export-components
export function useEventFormContext() {
  const context = useContext(EventFormContext);
  if (!context) {
    throw new Error(
      "useEventFormContext must be used within EventFormProvider"
    );
  }
  return context;
}
