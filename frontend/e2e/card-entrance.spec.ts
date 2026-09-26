import { expect, test } from "@playwright/test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Playwright's JSX transform creates browser component-test descriptors.
// Compile this primitive with the real React JSX runtime for server rendering.
const source = readFileSync(new URL("../src/shared/ui/card-entrance.tsx", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
});
const componentModule = { exports: {} as typeof import("../src/shared/ui/card-entrance") };
runInNewContext(outputText, {
  require: createRequire(import.meta.url),
  exports: componentModule.exports,
});
const { CardEntrance } = componentModule.exports;

test("server-rendered discovery cards remain visible before hydration at every index", () => {
  for (const index of [0, 7, 8, 100]) {
    const html = renderToStaticMarkup(createElement(CardEntrance, {
      index,
      className: "h-full min-w-0",
      role: "listitem",
      children: createElement("article", null, "Upcoming campus event"),
    }));
    expect(html).toBe('<div class="h-full min-w-0" role="listitem"><article>Upcoming campus event</article></div>');
  }
});
