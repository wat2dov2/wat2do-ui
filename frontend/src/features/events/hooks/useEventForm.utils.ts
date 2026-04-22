import type { EventFormData } from "@/shared/types";

/**
 * Map an AI-generated (or JSON-parsed) event object to EventFormData,
 * applying fallback defaults for missing fields.
 */
export function mapAiResponseToFormData(
  parsed: Record<string, unknown>,
  fallbackDefaults: { date: string; time: string },
): EventFormData {
  return {
    title: (parsed.title as string) || "",
    description: (parsed.description as string) || "",
    date: (parsed.date as string) || fallbackDefaults.date,
    time: (parsed.time as string) || fallbackDefaults.time,
    location: (parsed.location as string) || "",
    category: (parsed.category as string) || "",
    price: typeof parsed.price === "number" ? parsed.price : 0,
    food: Array.isArray(parsed.food) ? parsed.food : [],
    requiresRegistration:
      typeof parsed.requiresRegistration === "boolean"
        ? parsed.requiresRegistration
        : false,
    organization: (parsed.organization as string) || "",
  };
}

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
  };
}
