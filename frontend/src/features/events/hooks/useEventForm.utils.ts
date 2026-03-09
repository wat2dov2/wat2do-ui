import type { EventFormData } from "@/shared/types";

/**
 * Get smart defaults for form (today's date, next hour)
 */
export function getSmartDefaults() {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  const nextHour = new Date(now.setHours(now.getHours() + 1, 0, 0, 0));
  const time = `${nextHour.getHours().toString().padStart(2, "0")}:00`;
  return { date: today, time };
}

/**
 * Get initial form state
 */
export function getInitialState(initialData?: EventFormData, isEditMode = false) {
  const smartDefaults = getSmartDefaults();
  const formData = isEditMode && initialData
    ? initialData
    : {
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

  const dateStr = formData.date || smartDefaults.date;
  const selectedDate = dateStr
    ? (() => {
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? undefined : date;
      })()
    : undefined;

  return {
    formData,
    selectedDate,
    foodInput: "",
    touched: {},
    jsonValue: "",
    jsonError: "",
    aiPrompt: "",
    aiGenerating: false,
  };
}
