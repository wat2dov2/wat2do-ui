import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// The motion rules in styles/motion.css and DESIGN_SYSTEM.md, exercised on the
// real modules without a browser.

type JsxElement = { type: unknown; props: Record<string, unknown>; key?: unknown };

/** Compiles one source file and runs it with `require` answered by `modules`. */
function load<T>(path: string, modules: Record<string, unknown>, globals: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const loaded = { exports: {} as T };
  runInNewContext(outputText, {
    ...globals,
    exports: loaded.exports,
    require: (id: string) => {
      if (id in modules) return modules[id];
      throw new Error(`unexpected import ${id}`);
    },
  });
  return loaded.exports;
}

/** The automatic JSX runtime, building plain elements to inspect. */
const jsxRuntime = {
  jsx: (type: unknown, props: Record<string, unknown>, key?: unknown): JsxElement => ({ type, props, key }),
  jsxs: (type: unknown, props: Record<string, unknown>, key?: unknown): JsxElement => ({ type, props, key }),
};

/** The first element of `type` in a tree. */
function find(node: unknown, type: unknown): JsxElement | undefined {
  if (!node || typeof node !== "object") return undefined;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, type);
      if (found) return found;
    }
    return undefined;
  }
  const element = node as JsxElement;
  if (element.type === type) return element;
  return find(element.props?.children, type);
}

/** React's hooks for one component or hook called by hand: state and refs keep their slots between calls. */
function hookRuntime() {
  const slots: unknown[] = [];
  let index = 0;
  let setDuringCall = false;
  const react = {
    useState: (initial: unknown) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[slot], (next: unknown) => {
        slots[slot] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[slot]) : next;
        setDuringCall = true;
      }];
    },
    useRef: (initial: unknown) => {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useCallback: (callback: unknown) => callback,
    useLayoutEffect: () => {},
    useEffect: () => {},
  };
  /** Calls `body` the way React renders: again at once when it set state while rendering. */
  function call<R>(body: () => R): R {
    for (;;) {
      index = 0;
      setDuringCall = false;
      const result = body();
      if (!setDuringCall) return result;
    }
  }
  return { react, call };
}

test.describe("a row dragged past its end", () => {
  type DragProps = {
    onPointerDown: (event: unknown) => void;
    onPointerMove: (event: unknown) => void;
    onPointerUp: (event: unknown) => void;
  };

  function setup({ reducedMotion = false, scrollWidth = 1000, clientWidth = 400, scrollLeft = 0 } = {}) {
    const { react, call } = hookRuntime();
    const { useHorizontalScrollFade } = load<typeof import("../src/shared/hooks/useHorizontalScrollFade")>(
      "shared/hooks/useHorizontalScrollFade.ts",
      { react },
      { window: { matchMedia: () => ({ matches: reducedMotion }), setTimeout: () => 0 } },
    );
    const springs: { frames: { translate: string }[]; duration: number }[] = [];
    let left = scrollLeft;
    const row = {
      scrollWidth,
      clientWidth,
      get scrollLeft() { return left; },
      // Like a browser, the row stops at its ends.
      set scrollLeft(value: number) { left = Math.min(Math.max(value, 0), scrollWidth - clientWidth); },
      style: { translate: "" },
      setPointerCapture() {},
      hasPointerCapture: () => true,
      releasePointerCapture() {},
      animate(frames: { translate: string }[], timing: { duration: number }) {
        springs.push({ frames, duration: timing.duration });
        return { cancel() {} };
      },
    };
    const drag = call(() => useHorizontalScrollFade()).dragScrollProps as unknown as DragProps;
    const pointer = (clientX: number, timeStamp: number) => ({
      pointerType: "mouse", button: 0, pointerId: 1, clientX, timeStamp, currentTarget: row, preventDefault() {},
    });
    return { row, springs, drag, pointer };
  }

  const shift = (translate: string) => (translate ? parseFloat(translate) : 0);

  test("stretches toward the pointer by less the further it pulls, never past 64px", () => {
    const { row, drag, pointer } = setup();
    drag.onPointerDown(pointer(500, 0));
    const stretches = [10, 112, 300, 1000, 5000].map((pull, step) => {
      drag.onPointerMove(pointer(500 + pull, 16 * (step + 1)));
      return shift(row.style.translate);
    });
    // The first 12px of a pull give nothing; then 64 * over / (over + 150).
    expect(stretches[0]).toBe(0);
    expect(stretches[1]).toBeCloseTo(64 * (100 / 250));
    for (let step = 1; step < stretches.length; step += 1) expect(stretches[step]).toBeGreaterThan(stretches[step - 1]);
    expect(stretches[stretches.length - 1]).toBeLessThan(64);
  });

  test("stretches the other way past the far end, and not at all within the row", () => {
    const atEnd = setup({ scrollLeft: 600 });
    atEnd.drag.onPointerDown(atEnd.pointer(500, 0));
    atEnd.drag.onPointerMove(atEnd.pointer(388, 16));
    expect(shift(atEnd.row.style.translate)).toBeCloseTo(-64 * (100 / 250));

    const midway = setup({ scrollLeft: 300 });
    midway.drag.onPointerDown(midway.pointer(500, 0));
    midway.drag.onPointerMove(midway.pointer(700, 16));
    expect(midway.row.scrollLeft).toBe(100);
    expect(midway.row.style.translate).toBe("");
  });

  test("never stretches with reduced motion or when the row has nothing to scroll", () => {
    for (const options of [{ reducedMotion: true }, { scrollWidth: 400 }]) {
      const { row, drag, pointer } = setup(options);
      drag.onPointerDown(pointer(500, 0));
      drag.onPointerMove(pointer(900, 16));
      drag.onPointerUp(pointer(900, 20));
      expect(row.style.translate).toBe("");
    }
  });

  test("springs back to rest from where it was let go, carrying the speed it was let go at", () => {
    const flung = setup();
    flung.drag.onPointerDown(flung.pointer(500, 0));
    flung.drag.onPointerMove(flung.pointer(700, 1000));
    flung.drag.onPointerMove(flung.pointer(800, 1016));
    const letGoAt = shift(flung.row.style.translate);
    flung.drag.onPointerUp(flung.pointer(800, 1020));
    const [spring] = flung.springs;
    expect(flung.row.style.translate).toBe("");
    expect(shift(spring.frames[0].translate)).toBeCloseTo(letGoAt);
    expect(spring.frames[spring.frames.length - 1].translate).toBe("0px 0");
    // Still moving outward when let go, so it carries on outward before turning back.
    expect(shift(spring.frames[1].translate)).toBeGreaterThan(letGoAt);
    // Critically damped: it settles without crossing back past rest, in well under a second.
    expect(spring.frames.every(({ translate }) => shift(translate) >= 0)).toBe(true);
    expect(spring.duration).toBeLessThan(1000);

    const held = setup();
    held.drag.onPointerDown(held.pointer(500, 0));
    held.drag.onPointerMove(held.pointer(800, 1000));
    // Held still for a while before letting go: it turns back at once.
    held.drag.onPointerUp(held.pointer(800, 1500));
    const [rest] = held.springs;
    expect(shift(rest.frames[1].translate)).toBeLessThan(shift(rest.frames[0].translate));
  });
});

test.describe("a refused sign-in", () => {
  class ApiError extends Error {
    constructor(public status: number) {
      super(`Request failed with status ${status}`);
    }
  }

  function setup({ sendStatus, verifyStatus }: { sendStatus?: number; verifyStatus?: number }) {
    const { react, call } = hookRuntime();
    const { useEmailOtpFlow } = load<typeof import("../src/features/auth/hooks/useEmailOtpFlow")>(
      "features/auth/hooks/useEmailOtpFlow.ts",
      {
        react,
        "react-i18next": { useTranslation: () => ({ t: (key: string) => key }) },
        "@/features/auth/api/auth.api": {
          sendOtpAPI: async () => { if (sendStatus) throw new ApiError(sendStatus); },
          verifyOtpAPI: async () => { if (verifyStatus) throw new ApiError(verifyStatus); return {}; },
        },
        "@/shared/services/apiClient": { ApiError, isApiError: (error: unknown) => error instanceof ApiError },
      },
      { console: { error() {} } },
    );
    return () => call(() => useEmailOtpFlow());
  }

  test("marks the code field when the code is wrong, until it is edited", async () => {
    const render = setup({ verifyStatus: 401 });
    render().onEmailChange("student@uwaterloo.ca");
    await render().onSubmit();
    expect(render().emailSent).toBe(true);
    render().onOtpChange("123456");
    await render().onSubmit();
    expect(render().error).toBe("auth.invalidOtp");
    expect(render().isRefused).toBe(true);
    render().onOtpChange("12345");
    expect(render().isRefused).toBe(false);
    expect(render().error).toBeNull();
  });

  test("marks the email field when the school will not sign that email in", async () => {
    const render = setup({ sendStatus: 403 });
    render().onEmailChange("student@gmail.com");
    await render().onSubmit();
    expect(render().emailSent).toBe(false);
    expect(render().isRefused).toBe(true);
  });

  test("shows a failure that is not about what was typed without marking the field", async () => {
    const render = setup({ verifyStatus: 500 });
    render().onEmailChange("student@uwaterloo.ca");
    await render().onSubmit();
    render().onOtpChange("123456");
    await render().onSubmit();
    expect(render().error).toBe("Request failed with status 500");
    expect(render().isRefused).toBe(false);
  });
});

test("switching theme turns transitions off until two frames after the last switch", () => {
  const classes = new Set<string>();
  let frames: (() => void)[] = [];
  const nextFrame = () => {
    const due = frames;
    frames = [];
    due.forEach((callback) => callback());
  };
  const { useDarkMode } = load<typeof import("../src/shared/hooks/useDarkMode")>(
    "shared/hooks/useDarkMode.ts",
    {
      react: {
        useCallback: (callback: unknown) => callback,
        useSyncExternalStore: (_subscribe: unknown, snapshot: () => boolean) => snapshot(),
      },
      "@/shared/services/preferencesStorage": { saveTheme() {} },
    },
    {
      document: {
        documentElement: {
          classList: {
            add: (name: string) => classes.add(name),
            remove: (name: string) => classes.delete(name),
            contains: (name: string) => classes.has(name),
            toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
          },
        },
      },
      requestAnimationFrame: (callback: () => void) => frames.push(callback),
      cancelAnimationFrame: (id: number) => { frames[id - 1] = () => {}; },
    },
  );
  const { setDarkMode } = useDarkMode();

  setDarkMode(true);
  expect([...classes].sort()).toEqual(["dark", "no-transitions"]);
  nextFrame();
  expect(classes.has("no-transitions")).toBe(true);
  // Switched back before transitions returned: they stay off for this switch too.
  setDarkMode(false);
  nextFrame();
  expect(classes.has("no-transitions")).toBe(true);
  nextFrame();
  expect([...classes]).toEqual([]);
});

test("a stepper slides each step in from the side it is heading, on the reading side", () => {
  const { react, call } = hookRuntime();
  const page = { documentElement: { dir: "ltr" } };
  const { StepTransition } = load<typeof import("../src/shared/ui/step-transition")>(
    "shared/ui/step-transition.tsx",
    {
      react,
      "react/jsx-runtime": jsxRuntime,
      "framer-motion": { AnimatePresence: "AnimatePresence", MotionConfig: "MotionConfig", m: { div: "m.div" } },
      "@/shared/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
    },
    { document: page },
  );
  const render = (step: number) => call(() => StepTransition({ step, children: `step ${step}` }));
  const travel = (step: number) => find(render(step), "AnimatePresence")?.props.custom;
  const clipsSides = (step: number) => String(find(render(step), "div")?.props.className).includes("overflow-x-clip");

  expect(find(render(0), "MotionConfig")?.props.reducedMotion).toBe("user");
  // At rest nothing past the step's sides is clipped (a panel may bleed out a little).
  expect(clipsSides(0)).toBe(false);
  expect(travel(1)).toBe(1);
  expect(travel(2)).toBe(1);
  expect(travel(1)).toBe(-1);
  // Rendering again on the same step keeps the way it was going.
  expect(travel(1)).toBe(-1);
  // The sliding steps are clipped at the sides until the old one has gone.
  expect(clipsSides(1)).toBe(true);
  const presence = find(render(1), "AnimatePresence");
  (presence?.props.onExitComplete as () => void)();
  expect(clipsSides(1)).toBe(false);

  const step = find(render(1), "m.div");
  expect(step?.key).toBe(1);
  const variants = step?.props.variants as Record<"enter" | "exit", (travel: number) => { x: string }>;
  expect(variants.enter(1).x).toBe("100%");
  expect(variants.exit(1).x).toBe("-100%");
  expect(variants.enter(-1).x).toBe("-100%");
  page.documentElement.dir = "rtl";
  expect(variants.enter(1).x).toBe("-100%");
  expect(variants.exit(-1).x).toBe("-100%");
});

test("only the first tooltip waits", () => {
  const { TooltipProvider } = load<typeof import("../src/shared/ui/tooltip")>("shared/ui/tooltip.tsx", {
    react: { forwardRef: (render: unknown) => render },
    "react/jsx-runtime": jsxRuntime,
    "@radix-ui/react-tooltip": { Provider: "Provider", Root: "Root", Trigger: "Trigger", Content: "Content", Portal: "Portal" },
    "@/shared/lib/utils": { cn: (...values: unknown[]) => values.filter(Boolean).join(" ") },
  });
  const provider = TooltipProvider({ children: "triggers" }) as unknown as JsxElement;
  expect(provider.type).toBe("Provider");
  expect(provider.props).toMatchObject({ delayDuration: 600, skipDelayDuration: 300, children: "triggers" });
});

test("things that appear grow from 0.97 of their size, set once in motion.css", () => {
  const motion = readFileSync(new URL("../src/styles/motion.css", import.meta.url), "utf8");
  expect(motion).toContain("--motion-enter-scale: 0.97;");
  expect(motion).toMatch(/\[data-slot="dialog-content"\]\s*\)\s*\{\s*--tw-enter-scale: var\(--motion-enter-scale\);\s*--tw-exit-scale: var\(--motion-enter-scale\);/);
  // No surface picks its own entrance scale.
  const source = fileURLToPath(new URL("../src", import.meta.url));
  const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(tsx?|css)$/.test(name) ? [path] : [];
  });
  const ownScales = files(source).filter((path) => /zoom-(in|out)-\d/.test(readFileSync(path, "utf8")));
  expect(ownScales).toEqual([]);
});
