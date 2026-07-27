import { Container, FormActions, FormGrid, FormSection, PageHeader, Section, Stack } from "@/shared/layout";
import { ShowcaseBlock } from "./ShowcaseBlock";

const STACK_GAPS = [1, 2, 4, 6, 8, 12] as const;

export function LayoutSection() {
  return (
    <Section
      id="layout"
      title="Layout"
      description="Container, Stack, PageHeader, Section, and form layout primitives."
    >
      <Stack gap={6}>
        <ShowcaseBlock label="Container sizes">
          <Stack gap={2}>
            {(["sm", "md", "lg"] as const).map((size) => (
              <Container
                key={size}
                size={size}
                className="rounded-xl border border-border bg-surface py-3 text-center text-sm text-muted-foreground"
              >
                Container / {size}
              </Container>
            ))}
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="Stack gaps">
          <Stack direction="horizontal" gap={4} wrap>
            {STACK_GAPS.map((gap) => (
              <Stack key={gap} gap={gap} className="rounded-xl border border-border bg-surface p-3">
                <div className="h-3 w-12 rounded-lg bg-primary" />
                <div className="h-3 w-12 rounded-lg bg-secondary" />
                <p className="text-xs text-muted-foreground">gap-{gap}</p>
              </Stack>
            ))}
          </Stack>
        </ShowcaseBlock>

        <ShowcaseBlock label="PageHeader">
          <div className="rounded-xl border border-border bg-surface p-6">
            <PageHeader
              back={{ label: "Back to examples", onClick: () => undefined }}
              title="Example page"
              description="PageHeader owns top-left page navigation, the heading, and optional actions."
              actions={
                <span className="rounded-xl bg-secondary px-3 py-1.5 text-xs text-secondary-foreground">
                  Action slot
                </span>
              }
            />
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Form layout primitives">
          <div className="rounded-xl border border-border bg-surface p-6">
            <FormSection
              title="Example section"
              description="FormSection, FormGrid, and FormActions compose every form."
            >
              <FormGrid>
                <div className="h-10 rounded-xl bg-secondary" />
                <div className="h-10 rounded-xl bg-secondary" />
              </FormGrid>
              <FormGrid columns={4} className="mt-5">
                {Array.from({ length: 4 }, (_, index) => (
                  <div
                    key={index}
                    className="h-10 rounded-xl bg-secondary"
                  />
                ))}
              </FormGrid>
            </FormSection>
            <FormActions className="mt-5 border-t-0 pt-0">
              <div className="h-9 w-20 rounded-xl bg-secondary" />
              <div className="h-9 w-24 rounded-xl bg-primary" />
            </FormActions>
          </div>
        </ShowcaseBlock>

        <ShowcaseBlock label="Section variants">
          <Stack gap={4}>
            <Section title="Plain section" description="Default section without a surface wrapper.">
              <p className="text-sm text-muted-foreground">
                Used for top-level page sections with a heading block.
              </p>
            </Section>
            <Section
              title="Surface section"
              description="Section with bg-surface, border, and padding."
              variant="surface"
            >
              <p className="text-sm text-muted-foreground">
                Useful for grouped showcase content.
              </p>
            </Section>
          </Stack>
        </ShowcaseBlock>
      </Stack>
    </Section>
  );
}
