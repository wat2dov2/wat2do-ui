import type { ReactNode } from "react";
import { Stack } from "@/shared/layout";

interface LandingHeadingProps {
  title: ReactNode;
  description?: ReactNode;
}

/**
 * The landing page's one type scale. Display sizes run large and medium-weight
 * with tight tracking, so the headlines carry the page without boxes or labels.
 */
export function LandingHeading({ title, description }: LandingHeadingProps) {
  return (
    // Bands read down a left edge; the hero's and the closing's lines are spelled in their mosaics.
    <Stack gap={6} align="start">
      <h2 className="max-w-4xl text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1.02] font-medium tracking-[-0.035em] text-balance text-foreground">
        {title}
      </h2>
      {description ? (
        <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl">
          {description}
        </p>
      ) : null}
    </Stack>
  );
}

interface LandingSectionProps extends LandingHeadingProps {
  /** In-page anchor target, offset so the sticky navigation does not cover it. */
  id?: string;
  children?: ReactNode;
}

/** One landing-page band: its heading above its content, at the page's band rhythm. */
export function LandingSection({ id, children, ...heading }: LandingSectionProps) {
  return (
    <Stack as="section" id={id} gap={12} className="scroll-mt-24 sm:gap-16">
      <LandingHeading {...heading} />
      {children}
    </Stack>
  );
}
