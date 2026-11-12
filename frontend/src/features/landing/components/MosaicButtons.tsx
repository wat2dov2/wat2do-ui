"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import NextLink from "next/link";
import { ArrowRight } from "lucide-react";
import type { MosaicButton, MosaicButtonLayout } from "@/features/landing/lib/eventPixelMosaic";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

export interface MosaicAction {
  href: string;
  label: string;
}

/** The arrow a hovered button's label slides aside for. */
const ARROW = " →";

/** Same rects in the same places, so a repeated layout never re-renders the page. */
function sameLayout(a: MosaicButtonLayout | null | undefined, b: MosaicButtonLayout | null | undefined) {
  if (!a || !b) return a === b;
  return a.height === b.height && a.rects.length === b.rects.length && a.rects.every((rect, index) => {
    const other = b.rects[index];
    return rect.left === other.left && rect.top === other.top && rect.width === other.width && rect.height === other.height;
  });
}

interface MosaicButtonsState {
  region: RefObject<HTMLDivElement | null>;
  /** Where the mosaic spelled the buttons; undefined until it has laid them out, null when they do not fit. */
  layout: MosaicButtonLayout | null | undefined;
  setHover: (update: (current: number | null) => number | null) => void;
}

/**
 * Buttons spelled in a card's mosaic: `mosaic` is the card's `EventPixelMosaic`
 * `buttons`, and `region` goes to the `MosaicButtonRegion` that marks where they sit.
 */
export function useMosaicButtons(actions: readonly MosaicAction[]) {
  const region = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<MosaicButtonLayout | null | undefined>(undefined);
  const [hover, setHover] = useState<number | null>(null);
  const onLayout = useCallback(
    (next: MosaicButtonLayout | null) => setLayout((current) => (sameLayout(current, next) ? current : next)),
    [],
  );
  const items: MosaicButton[] = actions.map(({ label }) => ({ label, hoverLabel: `${label}${ARROW}` }));
  return {
    mosaic: { items, region, hover, onLayout },
    region: { region, layout, setHover } satisfies MosaicButtonsState,
  };
}

/**
 * Where the mosaic spells the buttons, each label in a border of squares. The
 * links lie over them, so they are real links to every pointer, keyboard and
 * screen reader. Until the mosaic has spelled them they hold their room unseen
 * (still links), and where they do not fit they are ordinary buttons.
 */
export function MosaicButtonRegion({
  actions,
  state: { region, layout, setHover },
  className,
}: {
  actions: readonly MosaicAction[];
  state: MosaicButtonsState;
  className?: string;
}) {
  const leave = (index: number) => setHover((current) => (current === index ? null : current));
  return (
    <div ref={region} className={cn("relative", className)} style={layout ? { height: layout.height } : undefined}>
      {layout ? (
        actions.map((action, index) => {
          const rect = layout.rects[index];
          return (
            <NextLink
              key={action.href}
              href={action.href}
              aria-label={action.label}
              className="absolute rounded-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              onPointerEnter={() => setHover(() => index)}
              onPointerLeave={() => leave(index)}
              onFocus={() => setHover(() => index)}
              onBlur={() => leave(index)}
            />
          );
        })
      ) : layout === undefined ? (
        <Stack direction="horizontal" gap={3} wrap justify="center">
          {actions.map((action, index) => (
            <NextLink
              key={action.href}
              href={action.href}
              aria-label={action.label}
              className={cn("h-11 rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50", index === 0 ? "w-44" : "w-32")}
            />
          ))}
        </Stack>
      ) : (
        <Stack direction="horizontal" gap={3} wrap justify="center">
          {actions.map((action, index) => (
            <Button key={action.href} size="lg" variant={index === 0 ? "primary" : "outline"} asChild>
              <NextLink href={action.href}>
                {action.label}
                {index === 0 ? <ArrowRight aria-hidden="true" /> : null}
              </NextLink>
            </Button>
          ))}
        </Stack>
      )}
    </div>
  );
}
