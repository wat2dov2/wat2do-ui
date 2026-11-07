import type { ReactNode } from "react";
import { Stack } from "@/shared/layout";
import { cn } from "@/shared/lib/utils";

interface LandingHeadingProps {
  title: ReactNode;
  description?: ReactNode;
  /** The hero owns the page's only h1; every other band is an h2. */
  as?: "h1" | "h2";
  /** Bands read down a left edge; the hero and the closing sit on the centre line. */
  align?: "start" | "center";
}

/**
 * The landing page's one type scale. Display sizes run large and medium-weight
 * with tight tracking, so the headlines carry the page without boxes or labels.
 */
export function LandingHeading({
  title,
  description,
  as: Heading = "h2",
  align = "start",
}: LandingHeadingProps) {
  return (
    <Stack
      gap={6}
      align={align}
      className={cn(align === "center" && "mx-auto max-w-4xl text-center")}
    >
      <Heading
        className={cn(
          "font-medium text-balance text-foreground",
          Heading === "h1"
            ? "text-[clamp(2rem,7.4vw,5.75rem)] leading-[0.98] tracking-[-0.04em]"
            : "max-w-4xl text-[clamp(2.25rem,4.6vw,3.75rem)] leading-[1.02] tracking-[-0.035em]",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className="max-w-xl text-lg leading-relaxed text-pretty text-muted-foreground sm:text-xl">
          {description}
        </p>
      ) : null}
    </Stack>
  );
}

interface LandingSectionProps extends Omit<LandingHeadingProps, "as"> {
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
