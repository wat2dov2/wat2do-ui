import { Section, Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";
import { ShowcaseBlock } from "./ShowcaseBlock";

const COLOR_FAMILIES = [
  {
    label: "Surface",
    swatches: [
      { name: "surface", className: "bg-surface" },
      { name: "surface-hover", className: "bg-surface-hover" },
      { name: "surface-active", className: "bg-surface-active" },
      { name: "surface-elevated", className: "bg-surface-elevated" },
    ],
  },
  {
    label: "Primary",
    swatches: [
      { name: "primary", className: "bg-primary" },
      { name: "primary-hover", className: "bg-primary-hover" },
      { name: "primary-active", className: "bg-primary-active" },
    ],
  },
  {
    label: "Secondary",
    swatches: [
      { name: "secondary", className: "bg-secondary" },
      { name: "secondary-hover", className: "bg-secondary-hover" },
      { name: "secondary-active", className: "bg-secondary-active" },
    ],
  },
  {
    label: "Destructive",
    swatches: [
      { name: "destructive", className: "bg-destructive" },
      { name: "destructive-hover", className: "bg-destructive-hover" },
      { name: "destructive-active", className: "bg-destructive-active" },
    ],
  },
  {
    label: "Border / muted",
    swatches: [
      { name: "border", className: "bg-border" },
      { name: "border-hover", className: "bg-border-hover" },
      { name: "muted", className: "bg-muted" },
      { name: "muted-hover", className: "bg-muted-hover" },
    ],
  },
] as const;

function ColorSwatch({
  name,
  className,
}: {
  name: string;
  className: string;
}) {
  return (
    <div className="space-y-2">
      <div
        className={cn(
          "h-16 rounded-xl border border-border",
          className,
        )}
      />
      <p className="font-mono text-xs text-muted-foreground">{name}</p>
    </div>
  );
}

export function ColorsSection() {
  return (
    <Section
      id="colors"
      title="Colors / Tokens"
      description="OKLCH semantic tokens. Hover/active keep hue and chroma; only lightness shifts."
      variant="surface"
    >
      {COLOR_FAMILIES.map((family) => (
        <ShowcaseBlock key={family.label} label={family.label}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {family.swatches.map((swatch) => (
              <ColorSwatch
                key={swatch.name}
                name={swatch.name}
                className={swatch.className}
              />
            ))}
          </div>
        </ShowcaseBlock>
      ))}

      <ShowcaseBlock label="Text on surfaces">
        <Stack gap={2}>
          <div className="rounded-xl bg-surface p-4">
            <p className="text-foreground">text-foreground on bg-surface</p>
            <p className="text-muted-foreground">text-muted-foreground</p>
          </div>
          <div className="rounded-xl bg-primary p-4">
            <p className="text-primary-foreground">text-primary-foreground on bg-primary</p>
          </div>
        </Stack>
      </ShowcaseBlock>
    </Section>
  );
}
