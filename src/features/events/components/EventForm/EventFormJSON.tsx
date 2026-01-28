import React, { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  Field,
  FieldLabel,
} from "@/shared/ui/field";
import { AIGenerationInput } from "@/features/search";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { useDarkMode } from "@/shared/hooks/useDarkMode";

// Lazy load Monaco Editor
const Editor = lazy(() => import("@monaco-editor/react"));

export function EventFormJSON() {
  const { t } = useTranslation();
  const { isDarkMode } = useDarkMode();
  const {
    jsonValue,
    jsonError,
    aiPrompt,
    setAiPrompt,
    aiGenerating,
    handleAiGenerate,
    handleJsonChange,
  } = useEventFormContext();

  return (
    <Field>
      {/* AI Generation Input */}
      <Field>
        <AIGenerationInput
          aiPrompt={aiPrompt}
          onAiPromptChange={setAiPrompt}
          onAiPromptClear={() => setAiPrompt("")}
          aiGenerating={aiGenerating}
          onAiGenerate={handleAiGenerate}
          error={jsonError}
          title={t("forms.aiEventGeneration")}
          placeholder={t("forms.aiPromptPlaceholder")}
          generatingText={t("common.generating")}
          className="space-y-2"
          inputClassName="w-full bg-muted text-xs px-3 py-2 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary focus:border-gray-600 dark:focus:border-gray-700 border border-border placeholder:text-muted-foreground disabled:opacity-60"
        />
      </Field>

      <Field>
        <FieldLabel className="text-xs font-medium text-foreground">
          {t("forms.jsonEditor")}
        </FieldLabel>
        <div className="border border-border rounded-xl overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[350px] bg-muted">
                <div className="text-muted-foreground text-sm">
                  {t("forms.loadingEditor")}
                </div>
              </div>
            }
          >
            <Editor
              key={isDarkMode ? "dark" : "light"}
              height="350px"
              defaultLanguage="json"
              value={jsonValue}
              onChange={handleJsonChange}
              theme={isDarkMode ? "vs-dark" : "vs-light"}
              options={{
                minimap: { enabled: false },
                fontSize: 12,
                lineNumbers: "off",
                scrollBeyondLastLine: false,
                wordWrap: "on",
                wrappingIndent: "indent",
                automaticLayout: true,
                tabSize: 2,
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          </Suspense>
        </div>
      </Field>
    </Field>
  );
}
