import { Container, PageHeader, Stack } from "@/shared/layout";
import { BadgesSection } from "../components/BadgesSection";
import { ButtonsSection } from "../components/ButtonsSection";
import { CardsSection } from "../components/CardsSection";
import { ColorsSection } from "../components/ColorsSection";
import { FeedbackSection } from "../components/FeedbackSection";
import { FormControlsSection } from "../components/FormControlsSection";
import { FormLayoutSection } from "../components/FormLayoutSection";
import { LayoutSection } from "../components/LayoutSection";
import { OverlaysSection } from "../components/OverlaysSection";
import { TypographySection } from "../components/TypographySection";

export function DesignSystemPage() {
  return (
    <main className="min-h-screen bg-background py-8 sm:py-12">
      <Container>
        <Stack gap={12}>
          <PageHeader
            title="Design System"
            description="UI primitives, semantic tokens, and layout building blocks for Wat2Do."
          />

          <nav className="flex flex-wrap gap-2">
            {[
              "Typography",
              "Colors",
              "Buttons",
              "Form Controls",
              "Form Layout",
              "Cards",
              "Badges",
              "Feedback",
              "Overlays",
              "Layout",
            ].map((item) => (
              <a
                key={item}
                href={`#${item.toLowerCase().replace(/\s+/g, "-")}`}
                className="rounded-xl bg-surface px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {item}
              </a>
            ))}
          </nav>

          <TypographySection />
          <ColorsSection />
          <ButtonsSection />
          <FormControlsSection />
          <FormLayoutSection />
          <CardsSection />
          <BadgesSection />
          <FeedbackSection />
          <OverlaysSection />
          <LayoutSection />
        </Stack>
      </Container>
    </main>
  );
}
