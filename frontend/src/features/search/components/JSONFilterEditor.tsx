import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { JSON_EDITOR_DEBOUNCE_MS, JSON_EDITOR_FONT_SIZE } from "@/shared/constants/ui";
import { useDebouncedCallback } from "@/shared/hooks/useDebouncedCallback";

// Lazy load Monaco Editor (3.6MB) - only needed for JSON filter view
const Editor = lazy(() => import("@monaco-editor/react"));

interface JSONFilterEditorProps {
  jsonValue: string;
  onJsonChange: (value: string | undefined) => void;
  isDarkMode: boolean;
}

export function JSONFilterEditor({
  jsonValue,
  onJsonChange,
  isDarkMode,
}: JSONFilterEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(jsonValue);
  const debouncedOnJsonChange = useDebouncedCallback(
    onJsonChange,
    JSON_EDITOR_DEBOUNCE_MS,
  );

  useEffect(() => {
    setDraft(jsonValue);
  }, [jsonValue]);

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[11px] leading-relaxed">
        {t("filters.editJsonDirectly")}
      </p>
      <div className="border border-border rounded-xl overflow-hidden">
        <Suspense
          fallback={
            <div className="flex items-center justify-center h-[250px] bg-secondary">
              <div className="text-muted-foreground text-sm">
                {t("forms.loadingEditor")}
              </div>
            </div>
          }
        >
          <Editor
            key={isDarkMode ? "dark" : "light"}
            height="250px"
            defaultLanguage="json"
            value={draft}
            onChange={(value) => {
              if (value === undefined) return;
              setDraft(value);
              debouncedOnJsonChange(value);
            }}
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
    </div>
  );
}
