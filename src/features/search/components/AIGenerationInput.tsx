import React from "react";
import { useTranslation } from "react-i18next";
import { X, Sparkles } from "lucide-react";
import { Input } from "@/shared/ui/input";

interface AIGenerationInputProps {
  aiPrompt: string;
  onAiPromptChange: (prompt: string) => void;
  onAiPromptClear: () => void;
  aiGenerating: boolean;
  onAiGenerate: () => void;
  error?: string;
  title?: string;
  placeholder?: string;
  generatingText?: string;
  className?: string;
  showTitle?: boolean;
}

export function AIGenerationInput({
  aiPrompt,
  onAiPromptChange,
  onAiPromptClear,
  aiGenerating,
  onAiGenerate,
  error,
  title,
  placeholder,
  generatingText,
  className = "mb-4 space-y-2",
  showTitle = true,
}: AIGenerationInputProps) {
  const { t } = useTranslation();

  const displayTitle = title || t("forms.aiEventGeneration");
  const displayPlaceholder = placeholder || (aiGenerating 
    ? (generatingText || t("common.generating"))
    : t("forms.aiPromptPlaceholder"));
  const displayError = error;

  return (
    <div className={className}>
      {showTitle && (
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-medium text-foreground">
            {displayTitle}
          </span>
        </div>
      )}
      <div className="relative">
        <Input
          type="text"
          placeholder={displayPlaceholder}
          value={aiPrompt}
          onChange={(e) => onAiPromptChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && aiPrompt.trim() && !aiGenerating) {
              onAiGenerate();
            }
          }}
          disabled={aiGenerating}
          className="bg-muted text-xs pr-8"
        />
        {aiPrompt && !aiGenerating && (
          <button
            onClick={onAiPromptClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
        {aiGenerating && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-3 h-3 border-2 border-gray-300 dark:border-gray-600 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>
      {displayError && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-[11px]">
          {displayError}
        </div>
      )}
    </div>
  );
}

export const AIFilterInput = AIGenerationInput;
