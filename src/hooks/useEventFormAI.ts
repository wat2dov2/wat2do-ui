import { useState, useCallback } from "react";
import { generateEventWithAI } from "@/lib/openai";
import type { EventFormData } from "@/types";

interface UseEventFormAIOptions {
  formData: EventFormData;
  setFormData: (data: EventFormData | ((prev: EventFormData) => EventFormData)) => void;
  setJsonValue: (value: string) => void;
  setJsonError: (error: string) => void;
}

/**
 * Hook for managing AI event generation in the form
 */
export function useEventFormAI({
  formData,
  setFormData,
  setJsonValue,
  setJsonError,
}: UseEventFormAIOptions) {
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiGenerating, setAiGenerating] = useState(false);

  const handleAiGenerate = useCallback(async () => {
    if (!aiPrompt.trim()) return;

    setAiGenerating(true);
    setJsonError("");

    try {
      const newEvent = await generateEventWithAI(aiPrompt, (partialJson: string) => {
        setJsonValue(partialJson);
      });

      const generatedJson = JSON.stringify(newEvent, null, 2);
      setJsonValue(generatedJson);
      
      // Update form data from generated event
      setFormData({
        title: newEvent.title || "",
        description: newEvent.description || "",
        date: newEvent.date || formData.date,
        time: newEvent.time || formData.time,
        location: newEvent.location || "",
        category: newEvent.category || "",
        price: typeof newEvent.price === "number" ? newEvent.price : 0,
        food: Array.isArray(newEvent.food) ? newEvent.food : [],
        requiresRegistration: typeof newEvent.requiresRegistration === "boolean"
          ? newEvent.requiresRegistration
          : false,
        organization: newEvent.organization || "",
      });
    } catch (error) {
      setJsonError(
        error instanceof Error ? error.message : "Failed to generate event"
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, setFormData, setJsonValue, setJsonError, formData]);

  return {
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,
  };
}
