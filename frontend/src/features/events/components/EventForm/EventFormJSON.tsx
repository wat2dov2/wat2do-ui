import React, { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/shared/ui/field";
import { AIGenerationInput } from "@/features/search";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { useDarkMode } from "@/shared/hooks/useDarkMode";
import { JSON_EDITOR_FONT_SIZE } from "@/shared/constants/ui";

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
    <FieldGroup>
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
        />
      </Field>

      <FieldSeparator />

      <Field>
        <FieldLabel className="text-xs font-medium text-foreground">
          {t("forms.jsonEditor")}
        </FieldLabel>
        <div className="border border-border rounded-xl overflow-hidden">
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-[350px] bg-secondary">
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
                fontSize: JSON_EDITOR_FONT_SIZE,
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
    </FieldGroup>
  );
}
