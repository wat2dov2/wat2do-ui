import type { ReactNode } from "react";
import { Stack } from "@/shared/layout";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import type { LucideIcon } from "@/shared/ui/doodle-icons";
import { cn } from "@/shared/lib/utils";

interface LandingHeadingProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** The hero owns the page's only h1; every other band is an h2. */
  as?: "h1" | "h2";
  align?: "start" | "center";
}

/** Small all-caps label that names what a band or feature is about. */
export function LandingEyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="text-sm font-bold uppercase tracking-[0.16em] text-muted-foreground">
      {children}
    </p>
  );
}

/** The landing page's one type scale: eyebrow, headline, and lead paragraph. */
export function LandingHeading({
  eyebrow,
  title,
  description,
  as: Heading = "h2",
  align = "center",
}: LandingHeadingProps) {
  return (
    <Stack
      gap={4}
      align={align}
      className={cn(align === "center" && "mx-auto max-w-3xl text-center")}
    >
      {eyebrow ? <LandingEyebrow>{eyebrow}</LandingEyebrow> : null}
      <Heading
        className={cn(
          "font-bold tracking-tight text-balance text-foreground",
          Heading === "h1"
            ? "text-4xl leading-[1.05] sm:text-6xl sm:leading-[1.02]"
            : "text-3xl leading-[1.1] sm:text-5xl sm:leading-[1.05]",
        )}
      >
        {title}
      </Heading>
      {description ? (
        <p className="max-w-2xl text-lg text-pretty text-muted-foreground sm:text-xl">
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
    <Stack as="section" id={id} gap={12} className="scroll-mt-24">
      <LandingHeading {...heading} />
      {children}
    </Stack>
  );
}

/** The square icon tile that leads problem cards and steps. */
export function LandingIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
      <Icon aria-hidden="true" className="size-5" />
    </span>
  );
}

/** Framed stage that holds one product illustration beside its feature copy. */
export function LandingStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-72 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface p-6 sm:p-8">
      {children}
    </div>
  );
}

interface LandingCardProps {
  title: ReactNode;
  description: ReactNode;
  /** Optional row above the title, such as an icon tile or a step number. */
  header?: ReactNode;
  /** Optional link below the description. */
  action?: ReactNode;
}

/** The card shape shared by pain points, use cases, steps, and questions. */
export function LandingCard({ title, description, header, action }: LandingCardProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <Stack gap={3}>
          {header}
          <CardTitle className="text-lg leading-tight">
            <h3>{title}</h3>
          </CardTitle>
          <CardDescription className="text-base">
            <p>{description}</p>
          </CardDescription>
          {action}
        </Stack>
      </CardHeader>
    </Card>
  );
}
