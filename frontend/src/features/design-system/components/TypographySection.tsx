import { Section, Stack } from "@/shared/layout";
import { Label } from "@/shared/ui/label";
import { ShowcaseBlock } from "./ShowcaseBlock";

export function TypographySection() {
  return (
    <Section
      id="typography"
      title="Typography"
      description="Heading hierarchy, body copy, and label styles."
    >
      <Stack gap={8}>
        <ShowcaseBlock label="Headings">
          <Stack gap={2}>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground">
              Heading 1
            </h1>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">
              Heading 2
            </h2>
            <h3 className="text-2xl font-semibold tracking-tight text-foreground">
              Heading 3
            </h3>
            <h4 className="text-xl font-semibold tracking-tight text-foreground">
              Heading 4
            </h4>
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Body">
          <Stack gap={2}>
            <p className="text-base text-foreground">
              Body text for primary content. Wat2Do uses semantic tokens for all
              typography colors.
            </p>
            <p className="text-sm text-muted-foreground">
              Muted body text for secondary descriptions and helper copy.
            </p>
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Labels">
          <Stack direction="horizontal" gap={4} align="center">
            <Label htmlFor="typography-label-demo">Form label</Label>
            <span className="text-xs font-medium text-muted-foreground">
              Overline label
            </span>
          </Stack>
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}
