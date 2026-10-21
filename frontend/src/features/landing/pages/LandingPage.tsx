"use client";

import { useRequestSchool } from "@/app/client-providers";
import type { LandingSnapshot } from "@/features/landing/api/landing.server";
import { LandingClosing } from "@/features/landing/components/LandingClosing";
import { LandingDifferent } from "@/features/landing/components/LandingDifferent";
import { LandingFaq } from "@/features/landing/components/LandingFaq";
import { LandingHero } from "@/features/landing/components/LandingHero";
import { LandingProblem } from "@/features/landing/components/LandingProblem";
import { LandingSolution } from "@/features/landing/components/LandingSolution";
import { LandingUseCases } from "@/features/landing/components/LandingUseCases";
import { useSchoolDirectory } from "@/shared/hooks/useSchoolDirectory";
import { Container, Stack } from "@/shared/layout";

interface LandingPageProps {
  /** The school's live feeds; null while the route is still loading them. */
  snapshot: LandingSnapshot | null;
}

/** Problem first, then the fix: why students miss events and how Wat2Do ends that. */
export function LandingPage({ snapshot }: LandingPageProps) {
  const { getSchoolName } = useSchoolDirectory();
  const schoolName = getSchoolName(useRequestSchool());

  return (
    <Container size="lg">
      <Stack gap={12} className="pb-12 sm:gap-40 sm:pb-24">
        <LandingHero schoolName={schoolName} events={snapshot?.events ?? []} isLoading={!snapshot} />
        <LandingProblem schoolName={schoolName} />
        <LandingSolution schoolName={schoolName} snapshot={snapshot} />
        <LandingDifferent />
        <LandingUseCases schoolName={schoolName} />
        <LandingFaq />
        <LandingClosing schoolName={schoolName} />
      </Stack>
    </Container>
  );
}
