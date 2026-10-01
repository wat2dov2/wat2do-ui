import { expect, test } from "@playwright/test";
import type { ComponentProps, MouseEvent } from "react";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { createAdaptivePressHandlers } from "../src/shared/hooks/useMouseDownPress";

// Inspect the real primitives using their JSX event props without a browser.
const require = createRequire(import.meta.url);
function loadUI(name: string, disclosure?: { open: boolean; setOpen: (open: boolean) => void }) {
  const source = readFileSync(new URL(`../src/shared/ui/${name}.tsx`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const componentModule = { exports: {} as Record<string, unknown> };
  runInNewContext(outputText, {
    require: (id: string) => {
      if (id === "react" && disclosure) return { ...require("react"), useContext: () => disclosure };
      if (id === "@/shared/hooks/useMouseDownPress") return { createAdaptivePressHandlers };
      if (id === "@/shared/ui/doodle-icons") return { Check: () => null };
      if (id === "@/shared/ui/button") return { OUTLINE_CONTROL_STYLES: "" };
      if (id === "@/shared/ui/drawer" || id === "@/shared/hooks/useExclusiveDisclosure") return {};
      if (id === "@/shared/lib/utils") return { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") };
      return require(id);
    },
    exports: componentModule.exports,
  });
  return componentModule.exports;
}
const { Button } = loadUI("button") as unknown as typeof import("../src/shared/ui/button");

function handlers(props: ComponentProps<typeof Button>) {
  // forwardRef's render has no hooks; exercise the actual rendered event props.
  const render = (Button as unknown as {
    render: (props: ComponentProps<typeof Button>, ref: null) => { props: ComponentProps<"button"> };
  }).render;
  return render(props, null).props;
}

function event(button = 0, detail = 1) {
  return {
    button, detail, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  } as unknown as MouseEvent<HTMLButtonElement>;
}

test("ordinary button actions fire once on left mouse down and support keyboard clicks", () => {
  let calls = 0;
  const button = handlers({ onClick: () => calls++ });
  button.onMouseDown?.(event());
  expect(calls).toBe(1);
  button.onClick?.(event());
  expect(calls).toBe(1);
  button.onClick?.(event(0, 0));
  expect(calls).toBe(2);
  button.onMouseDown?.(event(2));
  expect(calls).toBe(2);
});

test("filter buttons wait for click and disabled buttons never activate", () => {
  let calls = 0;
  const filter = handlers({ activation: "click", onClick: () => calls++ });
  expect(filter.onMouseDown).toBeUndefined();
  filter.onClick?.(event());
  expect(calls).toBe(1);
  const disabled = handlers({ disabled: true, onClick: () => calls++ });
  disabled.onMouseDown?.(event());
  disabled.onClick?.(event(0, 0));
  expect(calls).toBe(1);
});

test("links and submit buttons activate their native click once at mouse down", () => {
  for (const props of [{ asChild: true }, { type: "submit" as const }]) {
    let calls = 0;
    const button = handlers({ ...props, onClick: () => calls++ });
    const target = { closest: () => null, getAttribute: () => null, click: () => button.onClick?.(Object.assign(event(0, 0), { currentTarget: target })) };
    button.onMouseDown?.(Object.assign(event(), { currentTarget: target }));
    expect(calls).toBe(1);
    button.onClick?.(Object.assign(event(), { currentTarget: target }));
    expect(calls).toBe(1);
  }
});

test("propagation handlers compose with the action instead of disabling press activation", () => {
  const calls: string[] = [];
  const button = handlers({ onMouseDown: () => calls.push("guard"), onClick: () => calls.push("action") });
  button.onMouseDown?.(event());
  button.onClick?.(event());
  expect(calls).toEqual(["guard", "action"]);
});

test("nested filter controls wait for click through their shared container", () => {
  let calls = 0;
  const button = handlers({ onClick: () => calls++ });
  const target = { closest: () => ({}) };
  button.onMouseDown?.(Object.assign(event(), { currentTarget: target }));
  expect(calls).toBe(0);
  button.onClick?.(Object.assign(event(), { currentTarget: target }));
  expect(calls).toBe(1);
});

test("modifier clicks keep native navigation and do not navigate at mouse down", () => {
  let calls = 0;
  const button = handlers({ asChild: true, onClick: () => calls++ });
  const target = { closest: () => null, getAttribute: () => null, click: () => { throw new Error("must wait for modified click"); } };
  button.onMouseDown?.(Object.assign(event(), { currentTarget: target, ctrlKey: true }));
  expect(calls).toBe(0);
  const click = Object.assign(event(), { currentTarget: target, ctrlKey: true });
  button.onClick?.(click);
  expect(calls).toBe(1);
  expect(click.defaultPrevented).toBe(false);
});

test("touch activation waits for click so scrolling does not activate actions", () => {
  let calls = 0;
  const touch = createAdaptivePressHandlers({ preferClick: true, onClick: () => calls++ });
  expect(touch).not.toHaveProperty("onMouseDown");
  touch.onClick?.(event());
  expect(calls).toBe(1);
});


test("mobile widths wait for click regardless of pointer type", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const queries: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    matchMedia: (query: string) => { queries.push(query); return { matches: query.includes("max-width") }; },
  } });
  try {
    let calls = 0;
    const button = handlers({ onClick: () => calls++ });
    expect(button.onMouseDown).toBeUndefined();
    expect(calls).toBe(0);
    button.onClick?.(event());
    expect(calls).toBe(1);
    expect(queries.some(query => query.includes("max-width"))).toBe(true);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});


test("Radix toggles receive one native activation on press and still support the keyboard", () => {
  for (const [name, symbol] of [["switch", "Switch"], ["checkbox", "Checkbox"]]) {
    type Render = (props: object, ref?: null) => { props: ComponentProps<"button"> };
    const component = loadUI(name)[symbol] as Render | { render: Render };
    const control = (typeof component === "function" ? component : component.render)({}, null).props;
    let toggles = 0;
    const target = {
      closest: () => null, getAttribute: () => null,
      click: () => {
        const click = Object.assign(event(0, 0), { currentTarget: target });
        control.onClick?.(click);
        if (!click.defaultPrevented) toggles++;
      },
    };
    control.onMouseDown?.(Object.assign(event(), { currentTarget: target }));
    expect(toggles).toBe(1);
    const release = Object.assign(event(), { currentTarget: target });
    control.onClick?.(release);
    expect(release.defaultPrevented).toBe(true);
    target.click();
    expect(toggles).toBe(2);
  }
});

test("popover filters retain native click while ordinary disclosures toggle on press only once", () => {
  let opens = 0;
  const disclosure = { open: false, setOpen: () => { opens++; } };
  const { PopoverTrigger } = loadUI("popover", disclosure) as unknown as typeof import("../src/shared/ui/popover");
  type Render = (props: ComponentProps<typeof PopoverTrigger>) => { props: ComponentProps<"button"> };
  const render = PopoverTrigger as unknown as Render;
  const ordinary = render({}).props;
  ordinary.onMouseDown?.(event());
  expect(opens).toBe(1);
  ordinary.onClick?.(event());
  expect(opens).toBe(1);
  const filter = render({ asChild: true, children: require("react").createElement(Button, { activation: "click" }) }).props;
  expect(filter.onMouseDown).toBeUndefined();
  expect(filter.onClick).toBeUndefined();
});
