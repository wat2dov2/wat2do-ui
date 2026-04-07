import { useReducer, useCallback } from "react";
import { generateEventWithAI } from "@/shared/lib/openai";
import type { EventFormData } from "@/shared/types";
import { aiReducer, initialAIState } from "@/features/events/hooks/useEventFormAI.reducer";

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
  const [state, dispatch] = useReducer(aiReducer, initialAIState);

  const handleAiGenerate = useCallback(async () => {
    if (!state.aiPrompt.trim()) return;

    dispatch({ type: "SET_AI_GENERATING", payload: true });
    setJsonError("");

    try {
      const newEvent = await generateEventWithAI(state.aiPrompt, (partialJson: string) => {
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
      console.error("AI event generation failed:", error);
      setJsonError(
        error instanceof Error ? error.message : "Failed to generate event"
      );
    } finally {
      dispatch({ type: "SET_AI_GENERATING", payload: false });
    }
  }, [state.aiPrompt, setFormData, setJsonValue, setJsonError, formData]);

  return {
    aiPrompt: state.aiPrompt,
    setAiPrompt: (value: string) =>
      dispatch({ type: "SET_AI_PROMPT", payload: value }),
    aiGenerating: state.aiGenerating,
    handleAiGenerate,
  };
}
