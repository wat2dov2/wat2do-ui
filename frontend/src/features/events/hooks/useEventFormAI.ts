import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { generateEventWithAI } from "@/shared/lib/openai";
import type { EventFormData } from "@/shared/types";
import { mapAiResponseToFormData } from "@/features/events/hooks/useEventForm.utils";

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
  const { t } = useTranslation();
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
      setFormData(
        mapAiResponseToFormData(newEvent as Record<string, unknown>, {
          date: formData.date,
          time: formData.time,
        }),
      );
    } catch (error) {
      console.error("AI event generation failed:", error);
      setJsonError(
        error instanceof Error ? error.message : t("forms.aiGenerationFailed")
      );
    } finally {
      setAiGenerating(false);
    }
  }, [aiPrompt, setFormData, setJsonValue, setJsonError, formData, t]);

  return {
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,
  };
}
