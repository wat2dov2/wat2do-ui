import { useTranslation } from "react-i18next";
import { X, Sparkles } from "@/shared/ui/doodle-icons";
import { Input } from "@/shared/ui/input";
import { Spinner } from "@/shared/ui/spinner";
import { cn } from "@/shared/lib/utils";

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
  titleClassName?: string;
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
  titleClassName,
  showTitle = true,
}: AIGenerationInputProps) {
  const { t } = useTranslation();

  const displayTitle = title || t("forms.aiEventGeneration");
  const displayPlaceholder = placeholder || (aiGenerating
    ? (generatingText || t("common.generating"))
    : t("forms.aiPromptPlaceholder"));

  return (
    <div className={className}>
      {showTitle && (
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className={cn("text-xs font-medium text-foreground", titleClassName)}>
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
            if (e.key !== "Enter") return;
            e.preventDefault();
            e.stopPropagation();
            if (aiPrompt.trim() && !aiGenerating) onAiGenerate();
          }}
          disabled={aiGenerating}
          className="bg-secondary text-xs pr-8"
        />
        {aiPrompt && !aiGenerating && (
          <button
            type="button"
            onClick={onAiPromptClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        )}
        {aiGenerating && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner className="size-3" />
          </div>
        )}
      </div>
      {error && (
        <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-3 py-2 rounded-lg text-[11px]">
          {error}
        </div>
      )}
    </div>
  );
}
