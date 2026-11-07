"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ComponentPropsWithoutRef,
  type ElementRef,
} from "react";

export { useDrawerPortalContainer } from "@/shared/ui/drawer-portal-context";

/*
 * Drawers, loaded on demand.
 *
 * vaul inserts its stylesheet into the document as soon as it is imported, which
 * makes the browser recalculate every style on the page. Pages render drawers
 * that are closed (the navigation menu, event details, more filters), so loading
 * vaul with them cost every visit that work during startup. These components load
 * the drawer the first time one opens, on the first tap or click anywhere, or in
 * idle time after the page settles, whichever comes first; until then a drawer
 * renders only what sits outside its content (such as its trigger button).
 */
type DrawerModule = typeof import("@/shared/ui/drawer-impl");

let loadedModule: DrawerModule | null = null;
let loadingModule: Promise<DrawerModule> | null = null;
/** Drawers waiting for the module, told as soon as it arrives. */
const moduleListeners = new Set<(module: DrawerModule) => void>();

export function preloadDrawer(): Promise<DrawerModule> {
  loadingModule ??= import("@/shared/ui/drawer-impl").then((module) => {
    loadedModule = module;
    moduleListeners.forEach((listener) => listener(module));
    moduleListeners.clear();
    return module;
  });
  return loadingModule;
}

let scheduledPreload = false;

/** Load the drawer before anyone needs it: on the first press, or once the page is idle. */
function schedulePreload(): void {
  if (scheduledPreload || typeof window === "undefined") return;
  scheduledPreload = true;
  const preload = () => {
    window.removeEventListener("pointerdown", preload, true);
    void preloadDrawer();
  };
  window.addEventListener("pointerdown", preload, { capture: true, once: true });
  const idle = () => {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(preload, { timeout: 8000 });
    } else {
      globalThis.setTimeout(preload, 4000);
    }
  };
  if (document.readyState === "complete") idle();
  else window.addEventListener("load", idle, { once: true });
}

const DrawerModuleContext = createContext<DrawerModule | null>(null);

function useDrawerModule(): DrawerModule | null {
  return useContext(DrawerModuleContext);
}

type DrawerProps = ComponentProps<DrawerModule["Drawer"]>;

function Drawer(props: DrawerProps) {
  const [drawerModule, setDrawerModule] = useState<DrawerModule | null>(loadedModule);

  useEffect(() => {
    if (drawerModule) return;
    const adopt = (module: DrawerModule) => setDrawerModule(() => module);
    if (loadedModule) {
      adopt(loadedModule);
      return;
    }
    moduleListeners.add(adopt);
    if (props.open) void preloadDrawer();
    else schedulePreload();
    return () => {
      moduleListeners.delete(adopt);
    };
  }, [drawerModule, props.open]);

  if (!drawerModule) {
    return <>{props.children}</>;
  }
  const { Drawer: LoadedDrawer } = drawerModule;
  return (
    <DrawerModuleContext.Provider value={drawerModule}>
      <LoadedDrawer {...props} />
    </DrawerModuleContext.Provider>
  );
}

type ContentElement = ElementRef<DrawerModule["DrawerContent"]>;
type ContentProps = ComponentPropsWithoutRef<DrawerModule["DrawerContent"]>;

const DrawerContent = forwardRef<ContentElement, ContentProps>((props, ref) => {
  const drawerModule = useDrawerModule();
  if (!drawerModule) return null;
  const { DrawerContent: LoadedContent } = drawerModule;
  return <LoadedContent ref={ref} {...props} />;
});
DrawerContent.displayName = "DrawerContent";

function DrawerHeader(props: ComponentProps<DrawerModule["DrawerHeader"]>) {
  const drawerModule = useDrawerModule();
  if (!drawerModule) return null;
  const { DrawerHeader: LoadedHeader } = drawerModule;
  return <LoadedHeader {...props} />;
}

function DrawerFooter(props: ComponentProps<DrawerModule["DrawerFooter"]>) {
  const drawerModule = useDrawerModule();
  if (!drawerModule) return null;
  const { DrawerFooter: LoadedFooter } = drawerModule;
  return <LoadedFooter {...props} />;
}

function DrawerTitle(props: ComponentProps<DrawerModule["DrawerTitle"]>) {
  const drawerModule = useDrawerModule();
  if (!drawerModule) return null;
  const { DrawerTitle: LoadedTitle } = drawerModule;
  return <LoadedTitle {...props} />;
}

function DrawerDescription(props: ComponentProps<DrawerModule["DrawerDescription"]>) {
  const drawerModule = useDrawerModule();
  if (!drawerModule) return null;
  const { DrawerDescription: LoadedDescription } = drawerModule;
  return <LoadedDescription {...props} />;
}

export {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
};
