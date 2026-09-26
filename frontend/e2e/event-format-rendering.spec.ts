import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as Select from "@radix-ui/react-select";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { getInstagramSlideLocale } from "../src/features/admin/lib/instagramSlides";

// As in card-entrance.spec.ts, use React's JSX runtime for server rendering.
const source = readFileSync(new URL("../src/features/events/components/EventFormatFilterSelect.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});

for (const language of ["en", "fr"] as const) {
  test(`format selection is present before hydration in ${language}`, async () => {
    const { t } = await getInstagramSlideLocale(language);
    const componentModule = { exports: {} as typeof import("../src/features/events/components/EventFormatFilterSelect") };
    const require = createRequire(import.meta.url);
    runInNewContext(outputText, {
      exports: componentModule.exports,
      require: (id: string) => {
        if (id === "react-i18next") return { useTranslation: () => ({ t }) };
        // Keep Radix's real SSR/portal behavior without app-specific styling or disclosure state.
        if (id === "@/shared/ui/select") return {
          Select: Select.Root, SelectTrigger: Select.Trigger, SelectValue: Select.Value,
          SelectContent: ({ children }: { children: React.ReactNode }) => createElement(Select.Portal, null, createElement(Select.Content, null, children)),
          SelectItem: Select.Item,
        };
        return require(id);
      },
    });
    for (const value of ["any", "inPerson", "online"] as const) {
      const html = renderToStaticMarkup(createElement(componentModule.exports.EventFormatFilterSelect, { value, onChange: () => {} }));
      const trigger = html.match(/<button\b[^>]*>(.*?)<\/button>/s)?.[1];
      expect(trigger).toContain(t(`events.formatFilter.${value}`));
    }
  });
}
