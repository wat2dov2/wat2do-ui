import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/shared/ui/field";
import { useEventFormContext } from "@/features/events/components/EventForm/EventForm/EventFormContext";
import { JSON_EDITOR_FONT_SIZE } from "@/shared/constants/ui";

// Monaco is heavy; load only when the JSON tab mounts.
const Editor = lazy(() => import("@monaco-editor/react"));

export function EventFormJSON() {
  const { t } = useTranslation();
  const {
    jsonValue,
    jsonError,
    handleJsonChange,
    isDarkMode,
  } = useEventFormContext();

  return (
    <FieldGroup>
      <Field>
        <FieldLabel className="text-sm font-medium text-foreground">
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
        <FieldError>{jsonError || null}</FieldError>
      </Field>
    </FieldGroup>
  );
}
