import { useState } from "react";
import { Section, Stack } from "@/shared/layout";
import { useTurnOnPop } from "@/shared/hooks";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { IconSwap } from "@/shared/ui/icon-swap";
import { Check, Plus } from "lucide-react";
import { ShowcaseBlock } from "./ShowcaseBlock";

const BUTTON_VARIANTS = [
  { label: "Primary", variant: "primary" as const },
  { label: "Outline", variant: "outline" as const },
  { label: "Ghost", variant: "ghost" as const },
  { label: "Warning", variant: "warning" as const },
  { label: "Destructive", variant: "destructive" as const },
];

const BUTTON_SIZES = [
  { label: "Small", size: "sm" as const },
  { label: "Default", size: "default" as const },
  { label: "Large", size: "lg" as const },
];

/** A toggle as the app's Follow and Save buttons behave: one size in both states, and a pop only when turned on. */
function ToggleDemo() {
  const [on, setOn] = useState(false);
  const pop = useTurnOnPop(on);
  return (
    <Button
      variant="outline"
      selected={on}
      selectionIndicator="none"
      onClick={() => {
        pop.press();
        setOn(!on);
      }}
    >
      <IconSwap showAlternate={on} icon={<Plus />} alternate={<Check className={cn(pop.pop && "animate-success-pulse")} />} />
      <IconSwap showAlternate={on} icon="Follow" alternate="Following" />
    </Button>
  );
}

export function ButtonsSection() {
  return (
    <Section
      id="buttons"
      title="Buttons"
      description="Primary actions and controls across the app."
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Inline action">
          <Button variant="link" size="inline">Underlined action</Button>
        </ShowcaseBlock>
        <ShowcaseBlock label="Variants">
          <Stack direction="horizontal" gap={2} align="center" className="flex-wrap">
            {BUTTON_VARIANTS.map(({ label, variant }) => (
              <Button key={variant} variant={variant}>
                {label}
              </Button>
            ))}
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Sizes">
          <Stack direction="horizontal" gap={2} align="center" className="flex-wrap">
            {BUTTON_SIZES.map(({ label, size }) => (
              <Button key={size} size={size}>
                {label}
              </Button>
            ))}
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Icon buttons (a 44px press on touch screens)">
          <Stack direction="horizontal" gap={2} align="center">
            <Button size="icon-sm" variant="outline" aria-label="Add item">
              <Plus />
            </Button>
            <Button size="icon" variant="primary" aria-label="Add item">
              <Plus />
            </Button>
            <Button size="icon-lg" variant="ghost" aria-label="Add item">
              <Plus />
            </Button>
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="States">
          <Stack direction="horizontal" gap={2} align="center" className="flex-wrap">
            <Button>Enabled</Button>
            <Button variant="outline" selected>
              Selected
            </Button>
            <Button disabled>Disabled</Button>
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Toggle (changes at once, pops when turned on)">
          <ToggleDemo />
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}
