import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Rendered with the real React runtime, as in event-view-rendering.unit.spec.ts.
const filename = new URL("../src/features/auth/components/SessionView.tsx", import.meta.url);
const nodeRequire = createRequire(filename);
const React: typeof import("react") = nodeRequire("react");
const { renderToStaticMarkup }: typeof import("react-dom/server") = nodeRequire("react-dom/server");

function loadSessionView(): typeof import("../src/features/auth/components/SessionView") {
  const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const loaded = { exports: {} };
  runInNewContext(outputText, {
    exports: loaded.exports,
    require: (id: string) =>
      id === "@/features/auth/hooks/useAuthState"
        ? // The server's HTML: the browser's session is not known yet.
          { useSessionKnown: () => false, useAuthState: () => ({ isAdmin: false, clubs: [] }) }
        : nodeRequire(id),
  });
  return loaded.exports as typeof import("../src/features/auth/components/SessionView");
}

const { ClubManagerView } = loadSessionView();

function serverHtml(admins?: boolean) {
  return renderToStaticMarkup(
    React.createElement(ClubManagerView, { clubId: 21500, admins }, "controls"),
  );
}

test("edit and delete controls are revealed before first paint for admins and the club's team", () => {
  expect(serverHtml()).toBe(
    '<div data-manager-for="21500" class="hidden in-data-[session-admin]:contents">controls</div>',
  );
});

test("tickets controls are revealed before first paint for the club's team alone, not admins", () => {
  expect(serverHtml(false)).toBe('<div data-manager-for="21500" class="hidden">controls</div>');
});
